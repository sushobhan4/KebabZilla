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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          color: 'var(--foreground)',
          width: '100%',
          maxWidth: '560px',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
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

        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 20px 0' }}>
          You can customize your cookie preferences at any time. Essential cookies are required to keep you signed in securely and process orders.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }}>
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
              Essential for authentication, secure sessions (<code style={{ fontSize: '0.8rem' }}>kz_session</code>), shopping cart management, and fraud protection.
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
              <strong style={{ fontSize: '0.95rem' }}>Functional &amp; UI Preferences</strong>
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
              Stores your active Admin sorting tabs, selected filter options, custom quick-access navigation tabs, and driver view states across sessions.
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
              <strong style={{ fontSize: '0.95rem' }}>Performance &amp; Analytics</strong>
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
              Collects anonymous interaction metrics to help us optimize map loading and dispatch routing clustering response times.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
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
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 32px)',
        maxWidth: '860px',
        zIndex: 99998,
        background: 'rgba(25, 29, 26, 0.96)',
        backdropFilter: 'blur(12px)',
        color: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.12)',
        padding: '20px 24px',
        animation: 'slideUpCookie 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: '#b83b26',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            color: '#fff',
          }}
        >
          <Cookie size={24} />
        </div>

        <div style={{ flex: '1 1 340px' }}>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '1.02rem', fontWeight: 700, letterSpacing: '-0.2px', color: '#fff' }}>
            We value your privacy &amp; experience
          </h4>
          <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5, color: '#d1d5db' }}>
            We use <strong>strictly necessary session cookies</strong> to keep you signed in securely. With your permission, we also use <strong>functional preference cookies</strong> to remember your selected tabs, table sorting, and quick-access views across your workspace.{' '}
            <button
              type="button"
              onClick={onOpenPolicy}
              style={{
                background: 'none',
                border: 'none',
                color: '#fbbf24',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
                fontSize: '0.88rem',
                fontWeight: 600,
              }}
            >
              Read our Cookie Policy
            </button>
            .
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
            alignSelf: 'center',
            marginLeft: 'auto',
          }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={onOpenCustomize}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#fff',
              borderColor: 'rgba(255, 255, 255, 0.2)',
              fontSize: '0.85rem',
              padding: '8px 14px',
            }}
          >
            <Settings size={15} style={{ marginRight: '6px' }} />
            Customize
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleRejectOptional}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fff',
              borderColor: 'transparent',
              fontSize: '0.85rem',
              padding: '8px 16px',
            }}
          >
            Reject Optional
          </Button>
          <Button
            type="button"
            onClick={handleAcceptAll}
            style={{
              background: '#22c55e',
              color: '#fff',
              borderColor: '#22c55e',
              fontSize: '0.85rem',
              fontWeight: 700,
              padding: '8px 20px',
            }}
          >
            <Check size={16} style={{ marginRight: '6px' }} strokeWidth={2.5} />
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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '20px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          color: 'var(--foreground)',
          width: '100%',
          maxWidth: '740px',
          borderRadius: '18px',
          padding: '28px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
          maxHeight: '88vh',
          overflowY: 'auto',
          lineHeight: 1.6,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <div>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#b83b26', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
              LEGAL &amp; PRIVACY TRANSPARENCY
            </span>
            <h2 style={{ margin: '4px 0 0 0', fontSize: '1.45rem', fontWeight: 700 }}>
              KebabZilla Cookie Policy
            </h2>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close cookie policy">
            <X size={22} />
          </button>
        </div>

        <section style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>1. What Are Cookies?</h3>
          <p style={{ margin: 0, color: '#444', fontSize: '0.92rem' }}>
            Cookies are small text files placed on your computer or mobile device when you visit our website. They enable the website to remember your actions, login sessions, and preferences over a period of time, ensuring a smooth, personalized browsing experience.
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
                These cookies are essential for you to navigate the website and use its features securely. Without them, authenticated services, cart preservation, and order checkout cannot function.
              </p>
              <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #ddd', color: '#666' }}>
                    <th style={{ padding: '4px 8px' }}>Cookie</th>
                    <th style={{ padding: '4px 8px' }}>Purpose</th>
                    <th style={{ padding: '4px 8px' }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_session</td>
                    <td style={{ padding: '6px 8px' }}>Encrypted user authentication session</td>
                    <td style={{ padding: '6px 8px' }}>Active Session / 30 Days</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_cookie_consent</td>
                    <td style={{ padding: '6px 8px' }}>Stores your cookie privacy choices</td>
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
                These cookies allow the site to remember your UI choices (such as active Admin sorting tabs, customized quick-access top navigation tabs, selected filters, and driver duty preferences) so you don&apos;t have to reset them every time.
              </p>
              <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #ddd', color: '#666' }}>
                    <th style={{ padding: '4px 8px' }}>Cookie Prefix</th>
                    <th style={{ padding: '4px 8px' }}>Purpose</th>
                    <th style={{ padding: '4px 8px' }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_quick_*</td>
                    <td style={{ padding: '6px 8px' }}>Customized quick access tabs for Admin &amp; Staff</td>
                    <td style={{ padding: '6px 8px' }}>Active Session</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_pref_admin_orders_filter</td>
                    <td style={{ padding: '6px 8px' }}>Remembers active order status filter tab</td>
                    <td style={{ padding: '6px 8px' }}>Active Session</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_pref_admin_team_role</td>
                    <td style={{ padding: '6px 8px' }}>Remembers active team role filter</td>
                    <td style={{ padding: '6px 8px' }}>Active Session</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>kz_pref_delivery_tab</td>
                    <td style={{ padding: '6px 8px' }}>Remembers active delivery queue view tab</td>
                    <td style={{ padding: '6px 8px' }}>Active Session</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ padding: '14px', borderRadius: '10px', background: '#f9f9f7', border: '1px solid var(--border)' }}>
              <strong style={{ display: 'block', fontSize: '0.95rem', color: '#111' }}>
                C. Performance &amp; Analytics Cookies (Optional)
              </strong>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#555' }}>
                Used anonymously to gauge application performance, such as Google Maps rendering speed and delivery dispatch clustering response times. No personally identifiable advertising trackers are used.
              </p>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>3. Managing Your Choices</h3>
          <p style={{ margin: '0 0 12px 0', color: '#444', fontSize: '0.92rem' }}>
            You can change or revoke your cookie choices at any time using our Cookie Preferences manager or directly through your web browser&apos;s settings. If optional cookies are disabled, all UI features will continue to work normally with default views.
          </p>
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
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
          <Button type="button" onClick={onClose}>
            Close Policy
          </Button>
        </div>
      </div>
    </div>
  );
}
