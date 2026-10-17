import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Copy, ArrowRight } from 'lucide-react'

export default function CopyOtpPage() {
  const [searchParams] = useSearchParams()
  const code = (searchParams.get('code') || searchParams.get('otp') || '').trim()
  const email = (searchParams.get('email') || '').trim()
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    if (!code) return
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2600)
      }).catch(() => {
        setCopied(true)
      })
    }
  }

  useEffect(() => {
    if (code) {
      copyToClipboard()
    }
  }, [code])

  const continueUrl = email
    ? `/forgot-password?email=${encodeURIComponent(email)}&otp=${encodeURIComponent(code)}`
    : '/login'

  return (
    <div style={{
      minHeight: '85vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      backgroundColor: '#0b0d10',
    }}>
      <div style={{
        maxWidth: 480,
        width: '100%',
        backgroundColor: '#111318',
        backgroundImage: "url('https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        border: '1px solid #282c37',
        borderRadius: 18,
        overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
        textAlign: 'center',
      }}>
        {/* Dark Translucent Overlay */}
        <div style={{
          background: 'linear-gradient(180deg, rgba(10, 12, 16, 0.85) 0%, rgba(13, 15, 20, 0.92) 50%, rgba(10, 12, 16, 0.96) 100%)',
        }}>
          {/* Storefront Brand Header */}
          <div style={{
            padding: '30px 20px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            lineHeight: 1,
          }}>
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', position: 'relative', lineHeight: 1 }}>
              <span style={{
                fontFamily: "'Serambhi Ramadhan', serif",
                fontSize: 40,
                lineHeight: 0.9,
                color: '#fdfbf7',
                letterSpacing: '-0.2px',
                display: 'block',
                textShadow: '0 2px 10px rgba(0,0,0,0.7)',
              }}>
                KebabZilla
              </span>
              <span style={{
                fontFamily: "'Slopes', cursive, sans-serif",
                fontSize: 11,
                lineHeight: 0.85,
                color: '#e05334',
                marginTop: -6,
                letterSpacing: '0.3px',
                display: 'block',
                whiteSpace: 'nowrap',
                textShadow: '0 1px 4px rgba(0,0,0,0.5)',
              }}>
                Meat, Fire, Glory
              </span>
            </div>
          </div>

          {/* Content */}
          <div style={{ padding: '36px 28px 30px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 18,
              backgroundColor: copied ? 'rgba(16, 185, 129, 0.18)' : 'rgba(224, 83, 52, 0.18)',
              color: copied ? '#34d399' : '#ffedd5',
              border: `1px solid ${copied ? 'rgba(16, 185, 129, 0.4)' : 'rgba(224, 83, 52, 0.4)'}`,
              transition: 'all 0.2s ease',
            }}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied to clipboard!' : 'Single-tap or click below to copy'}
            </div>

            <div
              onClick={copyToClipboard}
              title="Click to copy code"
              style={{
                backgroundColor: 'rgba(20, 24, 32, 0.85)',
                border: '2px solid #e05334',
                borderRadius: 14,
                padding: '20px 24px',
                margin: '0 auto 16px',
                cursor: 'pointer',
                userSelect: 'all',
                WebkitUserSelect: 'all',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div style={{
                fontFamily: "'Courier New', Consolas, Monaco, monospace",
                fontSize: 44,
                fontWeight: 800,
                letterSpacing: 10,
                color: '#fbf1df',
                lineHeight: 1,
              }}>
                {code || '------'}
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 24 }}>
              Single-tap the code above or use the button below to copy to clipboard
            </div>

            <button
              type="button"
              onClick={copyToClipboard}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                backgroundColor: copied ? '#059669' : '#c34226',
                color: '#ffffff',
                padding: '15px 24px',
                fontSize: 15,
                fontWeight: 800,
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 18px rgba(195, 66, 38, 0.45)',
                transition: 'background-color 0.15s ease',
              }}
            >
              {copied ? <Check size={17} /> : <Copy size={17} />}
              {copied ? 'Code Copied!' : 'Copy Code to Clipboard'}
            </button>

            <Link
              to={continueUrl}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                width: '100%',
                marginTop: 12,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#f3f4f6',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '13px 20px',
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 10,
                textDecoration: 'none',
                boxSizing: 'border-box',
              }}
            >
              Continue to KebabZilla <ArrowRight size={15} />
            </Link>
          </div>

          {/* Minimal Clean Footer */}
          <div style={{
            padding: '20px 16px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            fontSize: 13,
            color: '#9ca3af',
          }}>
            If you need any support, mail us at <a href="mailto:support@kebabzilla.in" style={{ color: '#e05334', textDecoration: 'none', fontWeight: 600 }}>support@kebabzilla.in</a>
          </div>
        </div>
      </div>
    </div>
  )
}
