package mailer

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/kebabzilla/go-backend/config"
)

type Mailer struct {
	cfg        *config.Config
	client     *http.Client
	tokenMu    sync.Mutex
	tokenValue string
	tokenExp   time.Time
}

var (
	defaultMailer *Mailer
	once          sync.Once
)

const (
	DefaultKebabBG = "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80"
	DefaultFeastBG = "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80"
)

func InitMailer(cfg *config.Config) *Mailer {
	once.Do(func() {
		defaultMailer = &Mailer{
			cfg:    cfg,
			client: &http.Client{Timeout: 15 * time.Second},
		}
	})
	return defaultMailer
}

func GetMailer() *Mailer {
	return defaultMailer
}

func (m *Mailer) IsConfigured() bool {
	if m == nil || m.cfg == nil {
		return false
	}
	return m.cfg.GmailRefreshToken != "" && m.cfg.GmailClientID != "" && m.cfg.GmailClientSecret != ""
}

func (m *Mailer) getAccessToken() (string, error) {
	m.tokenMu.Lock()
	defer m.tokenMu.Unlock()

	if m.tokenValue != "" && time.Now().Before(m.tokenExp) {
		return m.tokenValue, nil
	}

	data := url.Values{}
	data.Set("client_id", m.cfg.GmailClientID)
	data.Set("client_secret", m.cfg.GmailClientSecret)
	data.Set("refresh_token", m.cfg.GmailRefreshToken)
	data.Set("grant_type", "refresh_token")

	resp, err := m.client.PostForm("https://oauth2.googleapis.com/token", data)
	if err != nil {
		return "", fmt.Errorf("oauth token request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("oauth token response error: status %d", resp.StatusCode)
	}

	var res struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", fmt.Errorf("decode oauth response: %w", err)
	}

	m.tokenValue = res.AccessToken
	// Buffer 60 seconds before expiration
	m.tokenExp = time.Now().Add(time.Duration(res.ExpiresIn-60) * time.Second)
	return m.tokenValue, nil
}

func (m *Mailer) Send2FACode(name, email, code string) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("⚠️ [Mailer Panic] %v", r)
			}
		}()

		cleanName := strings.TrimSpace(name)
		if cleanName == "" {
			cleanName = "there"
		}
		subject := "Your KebabZilla 2-Step Verification Code"
		plainText := fmt.Sprintf(" KebabZilla\nYour KebabZilla verification code is %s. Valid for 10 minutes.\n\n[image: KebabZilla - Meat, Fire, Glory] <https://kebabzilla.in>\nWORKSPACE SECURITY\nStaff 2-Step Verification\n\nHi %s, use your security code below to access your staff workspace.\nCode Requested\n%s\nTap code to select • Single-use verification\n⏳ *Expires in 10 minutes.* Single-use only.\n🛡️ Do not share this code with anyone. Staff security requires one-time verification.\n\nIf you need any support, mail us at support@kebabzilla.in", code, cleanName, code)
		htmlBody := renderOTPEmail(code, cleanName, "staff_2fa", 10)

		if !m.IsConfigured() {
			log.Printf("🔑 [SECURITY 2FA CODE] Staff 2-Step verification code for %s: %s", email, code)
			return
		}

		err := m.sendGmail(email, subject, plainText, htmlBody)
		if err != nil {
			log.Printf("⚠️ [Mailer Error] Failed to dispatch 2FA email to %s: %v", email, err)
			log.Printf("🔑 [SECURITY 2FA CODE FALLBACK] Code for %s: %s", email, code)
		} else {
			log.Printf("✅ [Mailer] 2FA email dispatched successfully to %s", email)
		}
	}()
}

func (m *Mailer) SendPasswordReset(name, email, code string) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("⚠️ [Mailer Panic] %v", r)
			}
		}()

		cleanName := strings.TrimSpace(name)
		if cleanName == "" {
			cleanName = "there"
		}
		subject := "Your KebabZilla Password Reset Code"
		plainText := fmt.Sprintf(" KebabZilla\nYour KebabZilla password recovery code is: %s\n\nHi %s,\nUse your verification code to reset your password. This code expires in 15 minutes.\n\nIf you did not request a password reset, you can safely ignore this email.\n\nSupport: support@kebabzilla.in", code, cleanName)
		htmlBody := renderOTPEmail(code, cleanName, "password_reset", 15)

		if !m.IsConfigured() {
			log.Printf("🔑 [PASSWORD RESET OTP] For %s: %s", email, code)
			return
		}

		err := m.sendGmail(email, subject, plainText, htmlBody)
		if err != nil {
			log.Printf("⚠️ [Mailer Error] Failed to dispatch password reset to %s: %v", email, err)
			log.Printf("🔑 [PASSWORD RESET OTP FALLBACK] Code for %s: %s", email, code)
		} else {
			log.Printf("✅ [Mailer] Password reset email dispatched to %s", email)
		}
	}()
}

func (m *Mailer) SendVerificationOTP(email, code, purpose string) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("⚠️ [Mailer Panic] %v", r)
			}
		}()

		subject := "Your KebabZilla Verification Code"
		plainText := fmt.Sprintf(" KebabZilla\nYour KebabZilla verification code is: %s\n\nValid for 10 minutes.\n\nIf you did not request this verification code, you can safely ignore this email.\n\nSupport: support@kebabzilla.in", code)
		htmlBody := renderOTPEmail(code, "there", purpose, 10)

		if !m.IsConfigured() {
			log.Printf("📧 [EMAIL VERIFICATION OTP] For %s (%s): %s", email, purpose, code)
			return
		}

		err := m.sendGmail(email, subject, plainText, htmlBody)
		if err != nil {
			log.Printf("⚠️ [Mailer Error] Failed to dispatch verification email to %s: %v", email, err)
			log.Printf("📧 [EMAIL VERIFICATION OTP FALLBACK] Code for %s (%s): %s", email, purpose, code)
		} else {
			log.Printf("✅ [Mailer] Verification email dispatched to %s", email)
		}
	}()
}

func (m *Mailer) SendDeliveryOTP(name, email, code, orderNumber string) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("⚠️ [Mailer Panic] %v", r)
			}
		}()

		cleanName := strings.TrimSpace(name)
		if cleanName == "" {
			cleanName = "there"
		}
		cleanEmail := strings.TrimSpace(email)
		if cleanEmail == "" {
			return
		}

		subject := fmt.Sprintf("%s is your KebabZilla delivery code for Order #%s", code, orderNumber)
		plainText := fmt.Sprintf("Hi %s,\n\nYour KebabZilla delivery code for order %s is: %s\n\nShare this code with your delivery partner to confirm delivery.\n\nKebabZilla", cleanName, orderNumber, code)
		htmlBody := renderOTPEmail(code, cleanName, "delivery_otp", 60)

		if !m.IsConfigured() {
			log.Printf("🚚 [DELIVERY OTP] Order #%s for %s (%s): %s", orderNumber, cleanName, cleanEmail, code)
			return
		}

		err := m.sendGmail(cleanEmail, subject, plainText, htmlBody)
		if err != nil {
			log.Printf("⚠️ [Mailer Error] Failed to dispatch delivery OTP email to %s: %v", cleanEmail, err)
			log.Printf("🚚 [DELIVERY OTP FALLBACK] Order #%s for %s: %s", orderNumber, cleanEmail, code)
		} else {
			log.Printf("✅ [Mailer] Delivery OTP email dispatched to %s for Order #%s", cleanEmail, orderNumber)
		}
	}()
}

func (m *Mailer) sendGmail(to, subject, plainText, htmlBody string) error {
	token, err := m.getAccessToken()
	if err != nil {
		return err
	}

	fromName := m.cfg.EmailFromName
	if fromName == "" {
		fromName = "KebabZilla"
	}
	fromEmail := m.cfg.EmailFromAddress
	if fromEmail == "" {
		fromEmail = "support@kebabzilla.in"
	}

	boundary := fmt.Sprintf("boundary_%d", time.Now().UnixNano())
	var rawMsg bytes.Buffer
	rawMsg.WriteString(fmt.Sprintf("From: %s <%s>\r\n", fromName, fromEmail))
	rawMsg.WriteString(fmt.Sprintf("To: %s\r\n", to))
	rawMsg.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	rawMsg.WriteString("MIME-Version: 1.0\r\n")
	rawMsg.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n\r\n", boundary))

	// Plain text alternative
	rawMsg.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	rawMsg.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	rawMsg.WriteString("Content-Transfer-Encoding: 7bit\r\n\r\n")
	rawMsg.WriteString(plainText)
	rawMsg.WriteString("\r\n\r\n")

	// HTML alternative
	rawMsg.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	rawMsg.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	rawMsg.WriteString("Content-Transfer-Encoding: 7bit\r\n\r\n")
	rawMsg.WriteString(htmlBody)
	rawMsg.WriteString("\r\n\r\n")

	rawMsg.WriteString(fmt.Sprintf("--%s--\r\n", boundary))

	encoded := base64.URLEncoding.EncodeToString(rawMsg.Bytes())
	payload := map[string]string{"raw": encoded}
	jsonBody, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", bytes.NewBuffer(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	res, err := m.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		return fmt.Errorf("gmail api error status: %d", res.StatusCode)
	}

	return nil
}

func renderOTPEmail(otp, name, purpose string, expiryMinutes int) string {
	cleanOTP := html.EscapeString(strings.TrimSpace(otp))
	cleanName := html.EscapeString(strings.TrimSpace(name))
	if cleanName == "" {
		cleanName = "there"
	}

	var title, tagline, intro, actionNote string
	if purpose == "staff_2fa" || purpose == "2fa" {
		title = "Staff 2-Step Verification"
		tagline = "WORKSPACE SECURITY"
		intro = fmt.Sprintf("Hi %s, use your security code below to access your staff workspace.", cleanName)
		actionNote = "Do not share this code with anyone. Staff security requires one-time verification."
	} else if purpose == "delivery_otp" {
		title = "Your Delivery Confirmation Code"
		tagline = "DELIVERY CODE"
		intro = fmt.Sprintf("Hi %s, your KebabZilla feast is arriving! Share this code with your delivery partner.", cleanName)
		actionNote = "Only provide this code once you have physically received your food."
	} else {
		title = "Password Reset Code"
		tagline = "ACCOUNT VERIFICATION"
		intro = fmt.Sprintf("Hi %s, use the verification code below to reset your KebabZilla account password.", cleanName)
		actionNote = "If you did not request a password reset, you can safely ignore this email."
	}

	previewText := fmt.Sprintf("Your KebabZilla verification code is %s. Valid for %d minutes.", cleanOTP, expiryMinutes)
	bg := DefaultKebabBG
	outerBg := "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80&blur=150"
	logoURL := "https://api.kebabzilla.in/api/v1/public/email-images/kebabzilla-email-logo.png"

	body := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>KebabZilla</title>
  <style>
    @font-face {
      font-family: 'Serambhi Ramadhan';
      src: url('https://kebabzilla.in/fonts/SerambiRamadhan.ttf') format('truetype');
      font-display: swap;
    }
    @font-face {
      font-family: 'Slopes';
      src: url('https://kebabzilla.in/fonts/Slopes.ttf') format('truetype');
      font-display: swap;
    }
    body, table, td, a { -webkit-text-size-adjust: 100%%; -ms-text-size-adjust: 100%%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100%% !important; background-color: #0b0d10; color: #f3f4f6; font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100%% !important; max-width: 100%% !important; border-radius: 0 !important; border-left: none !important; border-right: none !important; }
      .otp-display { font-size: 30px !important; letter-spacing: 8px !important; text-indent: 8px !important; padding: 14px 10px !important; }
      .brand-title { font-size: 38px !important; }
      .email-content-pad { padding: 18px 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0d10; color: #f3f4f6; -webkit-font-smoothing: antialiased;">
  <!-- Preheader preview text -->
  <div style="display: none; font-size: 1px; color: #0b0d10; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    %s
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" background="%s" style="background-color: #07080a; background-image: url('%s'); background-size: cover; background-position: center; width: 100%%;">
    <tr>
      <td align="center" style="padding: 42px 14px; background-color: rgba(6, 8, 10, 0.8); background: linear-gradient(180deg, rgba(6, 8, 10, 0.8) 0%%, rgba(8, 9, 12, 0.8) 100%%);">
        
        <!-- Main Card Container -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" background="%s" style="width: 600px; max-width: 600px; background-color: #111318; background-image: url('%s'); background-size: cover; background-position: center; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 18px; overflow: hidden; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);">
          <tr>
            <!-- Card Overlay & Content -->
            <td style="background-color: rgba(12, 14, 18, 0.75); background: linear-gradient(180deg, rgba(10, 12, 16, 0.75) 0%%, rgba(13, 15, 20, 0.81) 50%%, rgba(10, 12, 16, 0.85) 100%%); padding: 0;">
              
              <!-- Storefront Brand Header -->
              <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding: 24px 20px 10px; text-align: center; line-height: 1;">
                    <a href="https://kebabzilla.in" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img
                        src="%s"
                        alt="KebabZilla - Meat, Fire, Glory"
                        width="180"
                        style="display: block; margin: 0 auto; width: 180px; max-width: 100%%; height: auto; border: 0; outline: none; text-decoration: none; font-family: 'Serambhi Ramadhan', Georgia, 'Times New Roman', serif; font-size: 28px; color: #fdfbf7; font-weight: bold;"
                      />
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Dynamic Body Content -->
              <div style="padding: 0;">
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" class="email-content-pad" style="padding: 38px 32px 30px; text-align: center;">
                  <tr>
                    <td align="center">
                      <div style="display: inline-block; padding: 5px 16px; background: rgba(224, 83, 52, 0.22); border: 1px solid rgba(224, 83, 52, 0.6); border-radius: 20px; margin-bottom: 14px;">
                        <span style="font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #ffedd5; text-transform: uppercase;">
                          %s
                        </span>
                      </div>

                      <h1 style="margin: 0 0 12px 0; font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px; line-height: 1.25;">
                        %s
                      </h1>

                      <p style="margin: 0 auto 28px; font-size: 15px; color: #e5e7eb; line-height: 1.6; max-width: 480px;">
                        %s
                      </p>

                      <!-- Code Requested Container (Continuous Single Box) -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto 28px; background-color: rgba(20, 24, 32, 0.82); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 14px; padding: 22px 24px; max-width: 440px; width: 100%%; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                        <tr>
                          <td align="left" style="padding-bottom: 14px; font-size: 13px; font-weight: 700; color: #9ca3af; letter-spacing: 0.5px;">
                            Code Requested
                          </td>
                        </tr>
                        <tr>
                          <td align="center">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto; width: 100%%; max-width: 320px;">
                              <tr>
                                <td align="center" class="otp-display" style="background-color: #ffffff; color: #111827; border-radius: 10px; padding: 16px 20px; font-size: 34px; font-weight: 800; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Courier New', monospace; letter-spacing: 12px; text-indent: 12px; text-align: center; box-shadow: 0 4px 14px rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.3); user-select: all; -webkit-user-select: all; cursor: pointer;">
                                  %s
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td align="center" style="padding-top: 14px; font-size: 12px; color: #9ca3af;">
                            Tap code to select &bull; Single-use verification
                          </td>
                        </tr>
                      </table>

                      <!-- Validity & Security Badges -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto; max-width: 480px; width: 100%%; background-color: rgba(20, 24, 32, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;">
                        <tr>
                          <td style="padding: 16px 20px; text-align: left;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%">
                              <tr>
                                <td width="28" valign="top" style="font-size: 18px; line-height: 1;">⏳</td>
                                <td style="padding-left: 8px; font-size: 13px; color: #f3f4f6; line-height: 1.5;">
                                  <strong>Expires in %d minutes.</strong> Single-use only.
                                </td>
                              </tr>
                              <tr>
                                <td width="28" valign="top" style="font-size: 18px; line-height: 1; padding-top: 8px;">🛡️</td>
                                <td style="padding-left: 8px; padding-top: 8px; font-size: 12px; color: #9ca3af; line-height: 1.5;">
                                  %s
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                    </td>
                  </tr>
                </table>
              </div>

              <!-- Minimal Clean Footer: Only support email -->
              <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding: 22px 20px; border-top: 1px solid rgba(255, 255, 255, 0.08); background-color: rgba(10, 12, 16, 0.5);">
                    <p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                      If you need any support, mail us at <a href="mailto:support@kebabzilla.in" style="color: #e05334; text-decoration: none; font-weight: 600;">support@kebabzilla.in</a>
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`, previewText, outerBg, outerBg, bg, bg, logoURL, tagline, title, intro, cleanOTP, expiryMinutes, actionNote)

	return body
}
