"""Responsive, classy HTML/CSS email templates for KebabZilla notifications.

Design language inspired by bold flame-grill aesthetic:
- Whole-container food background image with low-opacity dark overlay for maximum readability
- Restaurant Name: 'Serambhi Ramadhan', serif (#fdfbf7)
- Tagline: 'Meat, Fire, Glory' in 'Slopes', cursive (#e05334)
- High-contrast, bold typography and sleek buttons
- Clickable copy action linking to https://kebabzilla.in/copy-otp?code=...
- Minimal footer: "If you need any support, mail us at support@kebabzilla.in"
"""

import html
from app.config import settings
from app.image_utils import get_blurred_image_url

DEFAULT_KEBAB_BG = "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80"
DEFAULT_FEAST_BG = "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80"
DEFAULT_TANDOOR_BG = "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=1200&q=80"


def _email_scaffold(
    *,
    preview_text: str,
    body_content: str,
    background_image_url: str | None = None,
    accent_color: str = "#c34226",
    background_opacity: float = 0.35,
    outer_blur: int = 70,
    invert_logo: bool = False,
) -> str:
    """Wraps body content in a bold, classy container with full-coverage background imagery and dark overlay."""
    clean_preview = html.escape(preview_text)
    raw_bg = (background_image_url or "").strip()
    backend_base = (getattr(settings, "public_backend_url", None) or "https://api.kebabzilla.in").rstrip("/")
    bg = ""
    if raw_bg.startswith("/"):
        bg = f"{backend_base}{raw_bg}"
    elif "kebabzilla.in/api/v1/public/email-images/" in raw_bg:
        filename = raw_bg.split("/api/v1/public/email-images/")[-1]
        bg = f"{backend_base}/api/v1/public/email-images/{filename}"
    elif raw_bg:
        bg = raw_bg

    if invert_logo:
        logo_url = f"{backend_base}/api/v1/public/email-images/kebabzilla-email-logo-dark.png"
        logo_fallback_color = "#12151a"
    else:
        logo_url = f"{backend_base}/api/v1/public/email-images/kebabzilla-email-logo.png"
        logo_fallback_color = "#fdfbf7"

    # Clamp background opacity between 0.05 and 1.0
    bg_op = max(0.05, min(1.0, float(background_opacity)))
    # Dark overlay alpha for the card: higher bg_op means lower overlay alpha (more vivid image)
    card_alpha = round(max(0.15, min(0.96, 1.0 - (bg_op * 0.72))), 2)
    card_alpha_mid = round(min(0.98, card_alpha + 0.06), 2)
    card_alpha_end = round(min(0.99, card_alpha + 0.10), 2)

    # Outside the container: customizable outer ambient blur and lower opacity than the container
    outer_alpha = round(min(0.80, max(0.48, 1.0 - (bg_op * 0.55))), 2)
    outer_blur_safe = max(0, min(150, int(outer_blur)))
    outer_bg = get_blurred_image_url(bg, outer_blur_safe) if bg and outer_blur_safe > 0 else bg

    if bg:
        safe_bg = bg.replace('"', "%22").replace("'", "%27")
        safe_outer_bg = (outer_bg or bg).replace('"', "%22").replace("'", "%27")
        outer_table_attrs = f'background="{safe_outer_bg}"'
        outer_table_style = f"background-color: #07080a; background-image: url('{safe_outer_bg}'); background-size: cover; background-position: center; width: 100%;"
        outer_td_style = f"padding: 42px 14px; background-color: rgba(6, 8, 10, {outer_alpha}); background: linear-gradient(180deg, rgba(6, 8, 10, {outer_alpha}) 0%, rgba(8, 9, 12, {outer_alpha}) 100%); backdrop-filter: blur({outer_blur_safe}px) saturate(160%); -webkit-backdrop-filter: blur({outer_blur_safe}px) saturate(160%);"

        bg_table_attrs = f'background="{safe_bg}"'
        bg_table_style = f"background-color: #111318; background-image: url('{safe_bg}'); background-size: cover; background-position: center;"
        td_overlay_style = f"background-color: rgba(12, 14, 18, {card_alpha}); background: linear-gradient(180deg, rgba(10, 12, 16, {card_alpha}) 0%, rgba(13, 15, 20, {card_alpha_mid}) 50%, rgba(10, 12, 16, {card_alpha_end}) 100%);"
    else:
        outer_table_attrs = ""
        outer_table_style = "background-color: #0b0d10; width: 100%;"
        outer_td_style = "padding: 24px 12px;"
        bg_table_attrs = ""
        bg_table_style = "background-color: #111318;"
        td_overlay_style = "background: linear-gradient(180deg, #13161c 0%, #0d0f14 100%);"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>KebabZilla</title>
  <style>
    @font-face {{
      font-family: 'Serambhi Ramadhan';
      src: url('https://kebabzilla.in/fonts/SerambiRamadhan.ttf') format('truetype');
      font-display: swap;
    }}
    @font-face {{
      font-family: 'Slopes';
      src: url('https://kebabzilla.in/fonts/Slopes.ttf') format('truetype');
      font-display: swap;
    }}
    body, table, td, a {{ -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }}
    table, td {{ mso-table-lspace: 0pt; mso-table-rspace: 0pt; }}
    img {{ -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }}
    body {{ margin: 0; padding: 0; width: 100% !important; background-color: #0b0d10; color: #f3f4f6; font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }}
    @media only screen and (max-width: 620px) {{
      .email-container {{ width: 100% !important; max-width: 100% !important; border-radius: 0 !important; border-left: none !important; border-right: none !important; }}
      .otp-display {{ font-size: 30px !important; letter-spacing: 8px !important; text-indent: 8px !important; padding: 14px 10px !important; }}
      .brand-title {{ font-size: 38px !important; }}
      .email-content-pad {{ padding: 18px 16px !important; }}
    }}
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0d10; color: #f3f4f6; -webkit-font-smoothing: antialiased;">
  <!-- Preheader preview text -->
  <div style="display: none; font-size: 1px; color: #0b0d10; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    {clean_preview}
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" {outer_table_attrs} style="{outer_table_style}">
    <tr>
      <td align="center" style="{outer_td_style}">
        
        <!-- Main Card Container -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" {bg_table_attrs} style="width: 600px; max-width: 600px; {bg_table_style} border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 18px; overflow: hidden; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);">
          <tr>
            <!-- Card Overlay & Content -->
            <td style="{td_overlay_style} padding: 0;">
              
              <!-- Storefront Brand Header -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding: 24px 20px 10px; text-align: center; line-height: 1;">
                    <a href="https://kebabzilla.in" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img
                        src="{logo_url}"
                        alt="KebabZilla - Meat, Fire, Glory"
                        width="180"
                        style="display: block; margin: 0 auto; width: 180px; max-width: 100%; height: auto; border: 0; outline: none; text-decoration: none; font-family: 'Serambhi Ramadhan', Georgia, 'Times New Roman', serif; font-size: 28px; color: {logo_fallback_color}; font-weight: bold;"
                      />
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Dynamic Body Content -->
              <div style="padding: 0;">
                {body_content}
              </div>

              <!-- Minimal Clean Footer: Only support email -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
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
</html>"""


def render_otp_email(
    *,
    otp: str,
    name: str = "there",
    purpose: str = "password_reset",
    expiry_minutes: int = 10,
    bg_image_url: str | None = None,
    email: str = "",
    outer_blur: int = 200,
) -> str:
    """Renders bold, classy OTP email with whole-container background and low-opacity dark overlay."""
    clean_otp = html.escape(otp.strip())
    clean_name = html.escape(name.strip() or "there")
    clean_email = html.escape(email.strip())
    bg = bg_image_url or DEFAULT_KEBAB_BG

    if purpose == "staff_2fa":
        title = "Staff 2-Step Verification"
        tagline = "WORKSPACE SECURITY"
        intro = f"Hi {clean_name}, use your security code below to access your staff workspace."
        action_note = "Do not share this code with anyone. Staff security requires one-time verification."
    elif purpose == "delivery_otp":
        title = "Your Delivery Confirmation Code"
        tagline = "DELIVERY CODE"
        intro = f"Hi {clean_name}, your KebabZilla feast is arriving! Share this code with your delivery partner."
        action_note = "Only provide this code once you have physically received your food."
    else:
        title = "Password Reset Code"
        tagline = "ACCOUNT VERIFICATION"
        intro = f"Hi {clean_name}, use the verification code below to reset your KebabZilla account password."
        action_note = "If you did not request a password reset, you can safely ignore this email."

    body = f"""
    <!-- Main OTP Section -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-content-pad" style="padding: 38px 32px 30px; text-align: center;">
      <tr>
        <td align="center">
          <div style="display: inline-block; padding: 5px 16px; background: rgba(224, 83, 52, 0.22); border: 1px solid rgba(224, 83, 52, 0.6); border-radius: 20px; margin-bottom: 14px;">
            <span style="font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #ffedd5; text-transform: uppercase;">
              {tagline}
            </span>
          </div>

          <h1 style="margin: 0 0 12px 0; font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px; line-height: 1.25;">
            {title}
          </h1>

          <p style="margin: 0 auto 28px; font-size: 15px; color: #e5e7eb; line-height: 1.6; max-width: 480px;">
            {intro}
          </p>

          <!-- Code Requested Container (Continuous Single Box) -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto 28px; background-color: rgba(20, 24, 32, 0.82); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 14px; padding: 22px 24px; max-width: 440px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <tr>
              <td align="left" style="padding-bottom: 14px; font-size: 13px; font-weight: 700; color: #9ca3af; letter-spacing: 0.5px;">
                Code Requested
              </td>
            </tr>
            <tr>
              <td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto; width: 100%; max-width: 320px;">
                  <tr>
                    <td align="center" class="otp-display" style="background-color: #ffffff; color: #111827; border-radius: 10px; padding: 16px 20px; font-size: 34px; font-weight: 800; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Courier New', monospace; letter-spacing: 12px; text-indent: 12px; text-align: center; box-shadow: 0 4px 14px rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.3); user-select: all; -webkit-user-select: all; cursor: pointer;">
                      {clean_otp}
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
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto; max-width: 480px; width: 100%; background-color: rgba(20, 24, 32, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;">
            <tr>
              <td style="padding: 16px 20px; text-align: left;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td width="28" valign="top" style="font-size: 18px; line-height: 1;">⏳</td>
                    <td style="padding-left: 8px; font-size: 13px; color: #f3f4f6; line-height: 1.5;">
                      <strong>Expires in {expiry_minutes} minutes.</strong> Single-use only.
                    </td>
                  </tr>
                  <tr>
                    <td width="28" valign="top" style="font-size: 18px; line-height: 1; padding-top: 8px;">🛡️</td>
                    <td style="padding-left: 8px; padding-top: 8px; font-size: 12px; color: #9ca3af; line-height: 1.5;">
                      {action_note}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
    """

    return _email_scaffold(
        preview_text=f"Your KebabZilla verification code is {clean_otp}. Valid for {expiry_minutes} minutes.",
        body_content=body,
        background_image_url=bg,
        accent_color="#c34226",
        outer_blur=outer_blur,
    )


def render_offer_email(
    *,
    subject: str,
    message: str,
    headline: str | None = None,
    subheading: str | None = None,
    promo_code: str | None = None,
    discount_highlight: str | None = None,
    cta_text: str | None = None,
    cta_url: str | None = None,
    background_image_url: str | None = None,
    theme_color: str | None = None,
    background_opacity: float = 0.35,
    outer_blur: int = 70,
    invert_logo: bool = False,
) -> str:
    """Renders bold, classy offer email with full-coverage kebab imagery and dark low-opacity overlay."""
    clean_subject = html.escape(subject.strip() or "Special Offer from KebabZilla")
    clean_headline = html.escape(headline.strip() if headline else clean_subject)
    clean_subheading = html.escape(subheading.strip()) if subheading else "Fresh from the charcoal grill straight to your table"
    raw_bg = (background_image_url or "").strip()
    backend_base = (getattr(settings, "public_backend_url", None) or "https://api.kebabzilla.in").rstrip("/")
    if raw_bg.startswith("/"):
        bg = f"{backend_base}{raw_bg}"
    elif "kebabzilla.in/api/v1/public/email-images/" in raw_bg:
        filename = raw_bg.split("/api/v1/public/email-images/")[-1]
        bg = f"{backend_base}/api/v1/public/email-images/{filename}"
    elif raw_bg:
        bg = raw_bg
    else:
        bg = DEFAULT_FEAST_BG
    safe_bg = bg.replace('"', "%22").replace("'", "%27")
    theme = theme_color or "#c34226"
    cta_label = html.escape(cta_text.strip()) if cta_text else "Order Your Feast Now"
    cta_link = html.escape(cta_url.strip()) if cta_url else "https://kebabzilla.in/#menu"

    paragraphs = [p.strip() for p in message.split("\n\n") if p.strip()] or [message.strip()]
    formatted_paragraphs = "".join(
        f'<p style="margin: 0 0 14px 0; font-size: 15px; color: #e5e7eb; line-height: 1.7; text-align: center;">{html.escape(p)}</p>'
        for p in paragraphs
    )

    discount_badge_html = ""
    if discount_highlight and discount_highlight.strip():
        clean_discount = html.escape(discount_highlight.strip())
        discount_badge_html = f"""
        <div style="display: inline-block; padding: 6px 18px; background-color: {theme}; color: #ffffff; font-weight: 800; font-size: 13px; border-radius: 20px; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);">
          ⭐ {clean_discount}
        </div>
        """

    promo_box_html = ""
    if promo_code and promo_code.strip():
        clean_code = html.escape(promo_code.strip().upper())
        promo_copy_url = f"https://kebabzilla.in/#menu?promo={clean_code}"
        promo_box_html = f"""
        <div style="background-color: rgba(20, 24, 32, 0.75); border: 2px dashed {theme}; border-radius: 12px; padding: 20px 24px; margin: 24px auto; max-width: 400px; text-align: center;">
          <div style="font-size: 11px; font-weight: 800; color: #9ca3af; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px;">
            USE PROMO CODE AT CHECKOUT
          </div>
          <div style="font-family: 'Courier New', Consolas, monospace; font-size: 30px; font-weight: 900; letter-spacing: 4px; color: #fbbf24; margin-bottom: 14px; user-select: all; -webkit-user-select: all;">
            {clean_code}
          </div>
          <a
            href="{promo_copy_url}"
            target="_blank"
            style="display: inline-block; background-color: {theme}; color: #ffffff; text-decoration: none; padding: 9px 24px; font-size: 13px; font-weight: 700; border-radius: 6px;"
          >
            📋 Apply &amp; Order
          </a>
        </div>
        """

    body = f"""
    <!-- Main Offer Body -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-content-pad" style="padding: 10px 28px 32px; text-align: center;">
      <tr>
        <td align="center">

          {discount_badge_html}
          <h1 style="margin: 0 0 12px 0; font-size: 32px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px; line-height: 1.2;">
            {clean_headline}
          </h1>
          <p style="margin: 0 auto 24px; font-size: 16px; color: #d1d5db; line-height: 1.5; max-width: 480px;">
            {clean_subheading}
          </p>

          <div style="max-width: 500px; margin: 0 auto 24px; text-align: center;">
            {formatted_paragraphs}
          </div>

          {promo_box_html}

          <!-- Primary Action Button -->
          <div style="text-align: center; margin: 28px 0 14px 0;">
            <a
              href="{cta_link}"
              target="_blank"
              style="display: inline-block; background-color: {theme}; color: #ffffff; text-decoration: none; padding: 16px 42px; font-size: 15px; font-weight: 800; border-radius: 10px; letter-spacing: 0.5px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); text-transform: uppercase;"
            >
              {cta_label} &rarr;
            </a>
            <div style="margin-top: 10px; font-size: 12px; color: #9ca3af;">
              Order direct for the fastest delivery &bull; Best price guarantee
            </div>
          </div>

        </td>
      </tr>
    </table>
    """

    return _email_scaffold(
        preview_text=f"{clean_headline} — {clean_subheading}",
        body_content=body,
        background_image_url=bg,
        accent_color=theme,
        background_opacity=background_opacity,
        outer_blur=outer_blur,
        invert_logo=invert_logo,
    )


def render_account_created_email(
    *,
    name: str,
    email: str,
    role: str,
    login_url: str = "https://kebabzilla.in/login",
) -> str:
    """Renders storefront-themed welcome email for new staff/user accounts."""
    clean_name = html.escape(name.strip())
    clean_email = html.escape(email.strip())
    clean_role = html.escape(role.upper())

    body = f"""
    <!-- Details Card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-content-pad" style="padding: 38px 32px 30px; text-align: center;">
      <tr>
        <td align="center">
          <div style="display: inline-block; padding: 5px 16px; background: rgba(224, 83, 52, 0.22); border: 1px solid rgba(224, 83, 52, 0.6); border-radius: 20px; margin-bottom: 14px;">
            <span style="font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #ffedd5; text-transform: uppercase;">
              ACCOUNT READY
            </span>
          </div>
          <h1 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 800; color: #ffffff;">
            Welcome, {clean_name}!
          </h1>
          <p style="margin: 0 auto 26px; font-size: 15px; color: #e5e7eb; line-height: 1.5; max-width: 480px;">
            Your KebabZilla {clean_role.lower()} account has been created.
          </p>

          <div style="max-width: 480px; margin: 0 auto; text-align: left;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: rgba(20, 24, 32, 0.75); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 18px; margin-bottom: 22px;">
              <tr>
                <td style="padding: 8px 14px;">
                  <div style="font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Role</div>
                  <div style="font-size: 15px; font-weight: 700; color: #e05334; margin-top: 2px;">{clean_role}</div>
                </td>
                <td style="padding: 8px 14px;">
                  <div style="font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Email</div>
                  <div style="font-size: 15px; font-weight: 700; color: #ffffff; margin-top: 2px;">{clean_email}</div>
                </td>
              </tr>
            </table>

            <h3 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 700; color: #ffffff;">To access your account:</h3>
            <ol style="margin: 0 0 24px 0; padding-left: 20px; font-size: 14px; color: #d1d5db; line-height: 1.7;">
              <li>Visit the sign-in page using the link below.</li>
              <li>Click <strong>'Forgot password?'</strong> to set your custom password via secure OTP code.</li>
              <li>Or sign in directly using <strong>Google</strong> if your email matches.</li>
            </ol>

            <div style="text-align: center; margin: 26px 0 16px 0;">
              <a
                href="{login_url}"
                target="_blank"
                style="display: inline-block; background-color: #c34226; color: #ffffff; text-decoration: none; padding: 15px 36px; font-size: 15px; font-weight: 800; border-radius: 10px; box-shadow: 0 4px 18px rgba(195, 66, 38, 0.45);"
              >
                Sign In to Workspace &rarr;
              </a>
            </div>
          </div>
        </td>
      </tr>
    </table>
    """

    return _email_scaffold(
        preview_text=f"Welcome {clean_name}! Your KebabZilla {clean_role.lower()} account is ready.",
        body_content=body,
        background_image_url=DEFAULT_TANDOOR_BG,
        accent_color="#c34226",
    )


def render_temporary_password_email(
    *,
    name: str,
    email: str,
    role: str,
    temporary_password: str,
    login_url: str = "https://kebabzilla.in/login",
) -> str:
    """Renders temporary credentials notice with storefront aesthetics."""
    clean_name = html.escape(name.strip())
    clean_role = html.escape(role.upper())
    clean_temp_pass = html.escape(temporary_password.strip())

    body = f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-content-pad" style="padding: 38px 32px 30px; text-align: center;">
      <tr>
        <td align="center">
          <div style="display: inline-block; padding: 5px 16px; background: rgba(224, 83, 52, 0.22); border: 1px solid rgba(224, 83, 52, 0.6); border-radius: 20px; margin-bottom: 14px;">
            <span style="font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #ffedd5; text-transform: uppercase;">
              TEMPORARY CREDENTIALS
            </span>
          </div>
          <h1 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 800; color: #ffffff;">
            Your KebabZilla Account is Ready
          </h1>
          <p style="margin: 0 auto 26px; font-size: 15px; color: #e5e7eb; line-height: 1.5; max-width: 480px;">
            Hi {clean_name}, your temporary login details for the {clean_role.lower()} role are below.
          </p>

          <div style="max-width: 460px; margin: 0 auto; text-align: center;">
            <p style="margin: 0 0 10px 0; font-size: 12px; font-weight: 800; color: #9ca3af; text-transform: uppercase; letter-spacing: 1.5px;">
              TEMPORARY PASSWORD
            </p>

            <div style="background-color: rgba(20, 24, 32, 0.85); border: 2px solid #e05334; border-radius: 12px; padding: 18px 24px; margin: 0 auto 24px;">
              <div style="font-family: 'Courier New', Consolas, monospace; font-size: 24px; font-weight: 800; letter-spacing: 3px; color: #fbf1df; user-select: all; -webkit-user-select: all;">
                {clean_temp_pass}
              </div>
            </div>

            <div style="background-color: rgba(20, 24, 32, 0.65); border-left: 4px solid #e05334; padding: 14px 16px; margin-bottom: 24px; text-align: left; border-radius: 4px;">
              <div style="font-size: 13px; font-weight: 700; color: #ffedd5; margin-bottom: 3px;">
                Action Required
              </div>
              <div style="font-size: 12px; color: #d1d5db; line-height: 1.5;">
                For your security, sign in and change this temporary password immediately.
              </div>
            </div>

            <div style="text-align: center;">
              <a
                href="{login_url}"
                target="_blank"
                style="display: inline-block; background-color: #1e2926; color: #ffffff; text-decoration: none; padding: 14px 34px; font-size: 15px; font-weight: 700; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.15);"
              >
                Sign In &amp; Change Password &rarr;
              </a>
            </div>
          </div>
        </td>
      </tr>
    </table>
    """

    return _email_scaffold(
        preview_text=f"Your temporary password for KebabZilla is {clean_temp_pass}.",
        body_content=body,
        background_image_url=DEFAULT_TANDOOR_BG,
        accent_color="#c34226",
    )
