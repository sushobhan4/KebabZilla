import { useState, useEffect } from 'react';
import { ShieldCheck, Cookie, Settings, Check, X } from 'lucide-react';
import { getCookieConsent, saveCookieConsent, type CookieConsentState } from '../cookies';
import { Button } from '../components';

export function CookiePreferencesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [consent, setConsent] = useState<CookieConsentState>(() => getCookieConsent());
  const [prefToggled, setPrefToggled] = useState(() => consent.preferences);
  const [analyticsToggled, setAnalyticsToggled] = useState(() => consent.analytics);

  useEffect(() => {
    if (open) {
      const c = getCookieConsent();
      setConsent(c);
      setPrefToggled(c.preferences);
      setAnalyticsToggled(c.analytics);
    }
  }, [open]);

  if (!open) return null;

  function handleSave() {
    saveCookieConsent({ preferences: prefToggled, analytics: analyticsToggled, decided: true });
    onClose();
  }

  function handleAcceptAll() {
    saveCookieConsent({ preferences: true, analytics: true, decided: true });
    setPrefToggled(true);
    setAnalyticsToggled(true);
    onClose();
  }

  function handleRejectAll() {
    saveCookieConsent({ preferences: false, analytics: false, decided: true });
    setPrefToggled(false);
    setAnalyticsToggled(false);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="policy-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="policy-modal-card preferences-card">
        <div className="policy-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Cookie size={22} color="#b83b26" />
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Cookie Preferences Manager</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-button"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="policy-modal-body">
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 20px 0' }}>
            You can customize your cookie preferences at any time. Essential cookies are required to keep you signed in securely and process orders.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Category: Essential */}
            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: '#f9f9f7',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={18} color="#2b7a4b" />
                  <strong style={{ fontSize: '0.95rem' }}>Strictly Necessary Cookies</strong>
                </div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2b7a4b', background: '#dcfce7', padding: '2px 8px', borderRadius: '4px' }}>
                  ALWAYS ON
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.84rem', color: '#666', lineHeight: 1.45 }}>
                Essential for keeping items saved in your food cart as you browse, maintaining your secure customer sign-in session (<code style={{ fontSize: '0.8rem' }}>kz_session</code>), and protecting checkout transactions.
              </p>
            </div>

            {/* Category: Preferences */}
            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: '#ffffff',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <strong style={{ fontSize: '0.95rem' }}>Functional &amp; Ordering Preferences</strong>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={prefToggled}
                    onChange={(e) => setPrefToggled(e.target.checked)}
                  />
                  <span />
                </label>
              </div>
              <p style={{ margin: 0, fontSize: '0.84rem', color: '#666', lineHeight: 1.45 }}>
                Remembers your chosen dietary filters (such as Vegetarian vs Non-Veg), favorite menu categories, and saved delivery address selection so you enjoy faster re-ordering.
              </p>
            </div>

            {/* Category: Analytics */}
            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: '#ffffff',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <strong style={{ fontSize: '0.95rem' }}>Performance &amp; Experience</strong>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={analyticsToggled}
                    onChange={(e) => setAnalyticsToggled(e.target.checked)}
                  />
                  <span />
                </label>
              </div>
              <p style={{ margin: 0, fontSize: '0.84rem', color: '#666', lineHeight: 1.45 }}>
                Collects anonymous performance data to ensure delicious kebab photos, interactive menus, and real-time delivery tracking maps load quickly on your phone or computer. Zero ad networks.
              </p>
            </div>
          </div>
        </div>

        <div className="policy-modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button type="button" variant="ghost" onClick={handleRejectAll} style={{ fontSize: '0.85rem' }}>
              Reject Optional
            </Button>
            <Button type="button" variant="secondary" onClick={handleAcceptAll} style={{ fontSize: '0.85rem' }}>
              Accept All
            </Button>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave}>
              Save My Preferences
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CookieConsentBanner({
  onOpenPolicy,
  onOpenCustomize,
}: {
  onOpenPolicy: () => void;
  onOpenCustomize: () => void;
}) {
  const [consent, setConsent] = useState<CookieConsentState>(() => getCookieConsent());
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show banner if user hasn't made a choice yet
    if (!consent.decided) {
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, [consent.decided]);

  useEffect(() => {
    function handleConsentUpdate(e: Event) {
      const custom = e as CustomEvent<CookieConsentState>;
      setConsent(custom.detail);
      if (custom.detail.decided) {
        setVisible(false);
      }
    }
    window.addEventListener('kz_cookie_consent_changed', handleConsentUpdate);
    return () => window.removeEventListener('kz_cookie_consent_changed', handleConsentUpdate);
  }, []);

  function handleAcceptAll() {
    saveCookieConsent({ preferences: true, analytics: true, decided: true });
    setVisible(false);
  }

  function handleRejectOptional() {
    saveCookieConsent({ preferences: false, analytics: false, decided: true });
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie consent banner"
      className="cookie-bottom-bar"
    >
      <div className="cookie-bar-container">
        <div className="cookie-bar-content">
          <div className="cookie-bar-icon">
            <Cookie size={18} />
          </div>
          <p className="cookie-bar-text">
            <strong>We value your privacy:</strong> We use strictly necessary cookies to keep your cart intact and keep you signed in securely, and preference cookies to remember your dietary filters and delivery address.{' '}
            <button
              type="button"
              onClick={onOpenPolicy}
              className="cookie-bar-link"
            >
              Read our Cookie Policy
            </button>
            .
          </p>
        </div>

        <div className="cookie-bar-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={onOpenCustomize}
            className="cookie-bar-btn cookie-bar-btn-customize"
          >
            <Settings size={14} style={{ marginRight: '5px' }} />
            Customize
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleRejectOptional}
            className="cookie-bar-btn cookie-bar-btn-reject"
          >
            Reject Optional
          </Button>
          <Button
            type="button"
            onClick={handleAcceptAll}
            className="cookie-bar-btn cookie-bar-btn-accept"
          >
            <Check size={15} style={{ marginRight: '5px' }} strokeWidth={2.5} />
            Accept All
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CookiePolicyModal({
  open,
  onClose,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="policy-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="policy-modal-card">
        <div className="policy-modal-header">
          <div>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#b83b26', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
              TRANSPARENCY &amp; PRIVACY
            </span>
            <h2 style={{ margin: '4px 0 0 0', fontSize: '1.45rem', fontWeight: 700 }}>
              KebabZilla Cookie Policy
            </h2>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close cookie policy">
            <X size={22} />
          </button>
        </div>

        <div className="policy-modal-body">
          <section style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>1. What Are Cookies?</h3>
            <p style={{ margin: 0, color: '#444', fontSize: '0.92rem' }}>
              Cookies are small text files stored on your browser when you visit KebabZilla. They make your food ordering experience seamless by keeping your cart preserved while you browse delicious dishes, remembering your delivery address, and keeping you signed in securely.
            </p>
          </section>

          <section style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>2. Categories of Cookies We Use</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '10px' }}>
              <div style={{ padding: '14px', borderRadius: '10px', background: '#f9f9f7', border: '1px solid var(--border)' }}>
                <strong style={{ display: 'block', fontSize: '0.95rem', color: '#111' }}>
                  A. Strictly Necessary &amp; Session Cookies
                </strong>
                <p style={{ margin: '4px 0 10px 0', fontSize: '0.88rem', color: '#555' }}>
                  Essential for customer authentication, protecting payment checkout with CSRF security tokens, and ensuring items added to your cart remain safe as you browse.
                </p>
                <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #ddd', color: '#666' }}>
                      <th style={{ padding: '4px 8px' }}>Cookie</th>
                      <th style={{ padding: '4px 8px' }}>Purpose for Customer</th>
                      <th style={{ padding: '4px 8px' }}>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_session</td>
                      <td style={{ padding: '6px 8px' }}>Keeps your customer account securely signed in</td>
                      <td style={{ padding: '6px 8px' }}>Active Session / 30 Days</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_csrf_token</td>
                      <td style={{ padding: '6px 8px' }}>Anti-tampering security token safeguarding orders &amp; payments</td>
                      <td style={{ padding: '6px 8px' }}>Session</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_cookie_consent</td>
                      <td style={{ padding: '6px 8px' }}>Stores your cookie privacy &amp; consent preferences</td>
                      <td style={{ padding: '6px 8px' }}>1 Year</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ padding: '14px', borderRadius: '10px', background: '#f9f9f7', border: '1px solid var(--border)' }}>
                <strong style={{ display: 'block', fontSize: '0.95rem', color: '#111' }}>
                  B. Functional &amp; Preference Cookies (Optional)
                </strong>
                <p style={{ margin: '4px 0 10px 0', fontSize: '0.88rem', color: '#555' }}>
                  Remember your customized ordering habits so you don&apos;t have to re-configure them on every visit.
                </p>
                <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #ddd', color: '#666' }}>
                      <th style={{ padding: '4px 8px' }}>Cookie Example</th>
                      <th style={{ padding: '4px 8px' }}>Ordering Benefit</th>
                      <th style={{ padding: '4px 8px' }}>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_pref_veg_filter</td>
                      <td style={{ padding: '6px 8px' }}>Remembers your Vegetarian / Non-Veg menu browsing filter</td>
                      <td style={{ padding: '6px 8px' }}>Active Session</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_pref_selected_address</td>
                      <td style={{ padding: '6px 8px' }}>Remembers your default delivery address for 1-click checkout</td>
                      <td style={{ padding: '6px 8px' }}>Active Session</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_pref_category</td>
                      <td style={{ padding: '6px 8px' }}>Remembers your favorite menu category (e.g. Signature Kebabs, Platters)</td>
                      <td style={{ padding: '6px 8px' }}>Active Session</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_pref_recent_search</td>
                      <td style={{ padding: '6px 8px' }}>Remembers recent dish searches for quicker re-ordering</td>
                      <td style={{ padding: '6px 8px' }}>Active Session</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ padding: '14px', borderRadius: '10px', background: '#f9f9f7', border: '1px solid var(--border)' }}>
                <strong style={{ display: 'block', fontSize: '0.95rem', color: '#111' }}>
                  C. Performance &amp; Experience Cookies (Optional)
                </strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#555' }}>
                  Used anonymously to ensure menu pages, high-resolution food photos, and live order tracking maps load at top speed on your mobile or desktop device. Zero third-party ad networks, zero selling of customer habits.
                </p>
              </div>
            </div>
          </section>

          <section style={{ marginBottom: '10px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>3. Managing Your Choices</h3>
            <p style={{ margin: 0, color: '#444', fontSize: '0.92rem' }}>
              You can change or revoke your cookie choices at any time directly through the Cookie Preferences Manager below or via your web browser&apos;s settings. If optional cookies are disabled, all core ordering and checkout features continue to function seamlessly.
            </p>
          </section>
        </div>

        <div className="policy-modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
          >
            <Settings size={16} style={{ marginRight: '6px' }} />
            Open Cookie Preferences Manager
          </Button>
          <Button type="button" onClick={onClose}>
            Close Policy
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyPolicyModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="policy-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="policy-modal-card">
        <div className="policy-modal-header">
          <div>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#b83b26', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
              CUSTOMER DATA PRIVACY
            </span>
            <h2 style={{ margin: '4px 0 0 0', fontSize: '1.45rem', fontWeight: 700 }}>
              KebabZilla Privacy Policy
            </h2>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close privacy policy">
            <X size={22} />
          </button>
        </div>

        <div className="policy-modal-body">
          <section style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>1. Information We Collect</h3>
            <p style={{ margin: '0 0 10px 0', color: '#444', fontSize: '0.92rem' }}>
              When you browse, create an account, or order from KebabZilla, we collect only the information necessary to prepare and deliver your meal safely:
            </p>
            <ul style={{ margin: 0, paddingLeft: '20px', color: '#444', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li><strong>Personal &amp; Contact Details:</strong> Name, email address, and mobile number (used for delivery communication, OTP verification, and order status updates).</li>
              <li><strong>Delivery Addresses:</strong> Saved house number, street, area, landmark, and delivery coordinates to route drivers to your location accurately.</li>
              <li><strong>Order History:</strong> Dishes ordered, customization notes, timestamps, and order receipts.</li>
              <li><strong>Payment Information:</strong> Payments are processed via RBI-compliant, PCI-DSS certified payment gateways (such as Razorpay). KebabZilla <em>never</em> stores your raw card numbers, CVVs, or bank passwords on our servers.</li>
            </ul>
          </section>

          <section style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>2. How We Use Your Information</h3>
            <ul style={{ margin: 0, paddingLeft: '20px', color: '#444', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li>To accept, prepare, and deliver your fresh food orders promptly.</li>
              <li>To provide live order tracking, delivery notifications, and billing receipts.</li>
              <li>To safeguard your account with secure tokenized sessions and rate-limited fraud prevention.</li>
              <li>To provide customer support and handle any refund requests.</li>
            </ul>
          </section>

          <section style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>3. Data Protection &amp; Security</h3>
            <p style={{ margin: 0, color: '#444', fontSize: '0.92rem' }}>
              All communication with KebabZilla is encrypted in transit using industry-standard TLS/HTTPS. Passwords are cryptographically hashed using Argon2id. We strictly maintain a zero-sale policy: we do not sell, rent, or trade your personal data to any third-party marketing brokers.
            </p>
          </section>

          <section style={{ marginBottom: '10px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>4. Your Rights &amp; Control</h3>
            <p style={{ margin: 0, color: '#444', fontSize: '0.92rem' }}>
              You have full control over your information. You can edit your saved addresses, update your contact details, or request full account closure and data deletion at any time by accessing your Profile or contacting restaurant support.
            </p>
          </section>
        </div>

        <div className="policy-modal-footer">
          <Button type="button" onClick={onClose}>
            Close Privacy Policy
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DataPolicyModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="policy-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="policy-modal-card">
        <div className="policy-modal-header">
          <div>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#b83b26', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
              DATA GOVERNANCE &amp; SECURITY
            </span>
            <h2 style={{ margin: '4px 0 0 0', fontSize: '1.45rem', fontWeight: 700 }}>
              KebabZilla Data Policy
            </h2>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close data policy">
            <X size={22} />
          </button>
        </div>

        <div className="policy-modal-body">
          <section style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>1. Data Storage &amp; Encryption</h3>
            <p style={{ margin: 0, color: '#444', fontSize: '0.92rem' }}>
              Customer information and order records are stored in secure, hardened databases with encryption at rest and in transit. Session tokens are generated using cryptographically secure pseudorandom number generators (<code style={{ fontSize: '0.82rem' }}>secrets</code>) and verified against strict server-side revocation tables.
            </p>
          </section>

          <section style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>2. Third-Party Service Providers</h3>
            <p style={{ margin: '0 0 10px 0', color: '#444', fontSize: '0.92rem' }}>
              We integrate with trusted enterprise services strictly to provide core ordering functionality:
            </p>
            <ul style={{ margin: 0, paddingLeft: '20px', color: '#444', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li><strong>Google Identity Services:</strong> Provides optional, instant Google One-Tap sign-in. Only your verified email and display name are received.</li>
              <li><strong>Google Maps Platform:</strong> Used to render maps and calculate delivery distances so drivers can reach you quickly.</li>
              <li><strong>Razorpay:</strong> Handles online payments (UPI, Cards, NetBanking) with PCI-DSS Level 1 compliance.</li>
            </ul>
          </section>

          <section style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>3. Data Retention &amp; Auto-Purge</h3>
            <ul style={{ margin: 0, paddingLeft: '20px', color: '#444', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li><strong>Authentication Sessions:</strong> Active user sessions expire after 30 days or immediately upon manual sign-out.</li>
              <li><strong>Temporary Invite &amp; Reset Tokens:</strong> Password setup tokens expire automatically within the administrator-configured duration (minimum 30 minutes) and are immediately revoked upon use or delivery failure.</li>
              <li><strong>Order &amp; Tax Records:</strong> Completed order records and invoices are retained as required by Indian commercial tax and accounting regulations.</li>
            </ul>
          </section>

          <section style={{ marginBottom: '10px' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>4. Security Audits &amp; Abuse Prevention</h3>
            <p style={{ margin: 0, color: '#444', fontSize: '0.92rem' }}>
              KebabZilla maintains strict rate-limiting policies on all authentication and ordering routes. Failed authentication attempts trigger temporary IP and fingerprint throttles to protect accounts against credential stuffing or brute-force attacks.
            </p>
          </section>
        </div>

        <div className="policy-modal-footer">
          <Button type="button" onClick={onClose}>
            Close Data Policy
          </Button>
        </div>
      </div>
    </div>
  );
}
