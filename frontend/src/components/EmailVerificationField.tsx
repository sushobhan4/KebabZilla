import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, LoaderCircle, Mail, ShieldCheck } from 'lucide-react'
import { api } from '../api'

interface EmailVerificationFieldProps {
  email: string
  onChangeEmail: (email: string) => void
  isVerified: boolean
  onVerifiedChange: (verified: boolean) => void
  purpose: 'REGISTER' | 'UPDATE_PROFILE' | 'STAFF_PROVISION'
  excludeId?: number
  disabled?: boolean
  required?: boolean
  id?: string
  name?: string
  autoComplete?: string
  placeholder?: string
  icon?: ReactNode
  initialVerifiedEmail?: string
}

export function EmailVerificationField({
  email,
  onChangeEmail,
  isVerified,
  onVerifiedChange,
  purpose,
  excludeId,
  disabled = false,
  required = true,
  id = 'email',
  name = 'email',
  autoComplete = 'email',
  placeholder = 'you@example.com',
  icon = <Mail size={17} />,
  initialVerifiedEmail,
}: EmailVerificationFieldProps) {
  const [checking, setChecking] = useState(false)
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [availabilityMessage, setAvailabilityMessage] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [sendingOtp, setSendingOtp] = useState(false)
  const [verifyingOtp, setVerifyingOtp] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [otpNotice, setOtpNotice] = useState('')
  const verifiedEmailRef = useRef<string | null>(initialVerifiedEmail || null)

  const trimmedEmail = email.trim().toLowerCase()
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)

  // Check email availability when email changes
  useEffect(() => {
    if (initialVerifiedEmail && trimmedEmail === initialVerifiedEmail.toLowerCase()) {
      onVerifiedChange(true)
      setIsAvailable(true)
      setAvailabilityMessage('')
      setOtpSent(false)
      setOtp('')
      return
    }

    if (verifiedEmailRef.current && trimmedEmail === verifiedEmailRef.current.toLowerCase()) {
      onVerifiedChange(true)
      setIsAvailable(true)
      setAvailabilityMessage('')
      setOtpSent(false)
      setOtp('')
      return
    }

    // Email changed from verified state
    if (isVerified) {
      onVerifiedChange(false)
    }

    if (!isValidEmail) {
      setIsAvailable(null)
      setAvailabilityMessage('')
      return
    }

    let cancelled = false
    setChecking(true)
    setAvailabilityMessage('')

    const timer = setTimeout(async () => {
      try {
        const queryParams = new URLSearchParams({ email: trimmedEmail })
        if (excludeId) queryParams.set('exclude_id', String(excludeId))
        const res = await api<{ exists: boolean; available: boolean }>(`/auth/check-email?${queryParams.toString()}`)
        if (!cancelled) {
          setIsAvailable(res.available)
          if (!res.available) {
            setAvailabilityMessage('An account with this email already exists.')
          } else {
            setAvailabilityMessage('')
          }
        }
      } catch {
        if (!cancelled) {
          setIsAvailable(null)
        }
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmedEmail, isValidEmail, excludeId, initialVerifiedEmail])

  async function handleSendOtp() {
    if (!isValidEmail || !isAvailable || sendingOtp || isVerified) return
    setSendingOtp(true)
    setOtpError('')
    setOtpNotice('')
    try {
      const res = await api<{ message: string }>('/auth/send-verification-otp', {
        method: 'POST',
        body: JSON.stringify({ email: trimmedEmail, purpose }),
      })
      setOtpSent(true)
      setOtp('')
      setOtpNotice(res.message || `Verification code sent to ${trimmedEmail}`)
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Could not send verification code.')
    } finally {
      setSendingOtp(false)
    }
  }

  async function handleVerifyOtp(codeToVerify?: string) {
    const code = (codeToVerify ?? otp).trim()
    if (code.length !== 6 || verifyingOtp) return
    setVerifyingOtp(true)
    setOtpError('')
    try {
      const res = await api<{ success: boolean; message: string }>('/auth/verify-email-otp', {
        method: 'POST',
        body: JSON.stringify({ email: trimmedEmail, otp: code, purpose }),
      })
      if (res.success) {
        verifiedEmailRef.current = trimmedEmail
        onVerifiedChange(true)
        setOtpSent(false)
        setOtp('')
        setOtpNotice('')
      } else {
        setOtpError(res.message || 'Invalid or expired verification code.')
      }
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Invalid verification code.')
    } finally {
      setVerifyingOtp(false)
    }
  }

  const canVerify = isValidEmail && isAvailable === true && !isVerified && !disabled

  return (
    <div className="email-verification-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      <div
        className="email-input-verify-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
        }}
      >
        <div className="input-wrap" style={{ flex: 1, minWidth: 0, margin: 0 }}>
          {icon}
          <input
            id={id}
            name={name}
            type="email"
            autoComplete={autoComplete}
            required={required}
            disabled={disabled}
            placeholder={placeholder}
            value={email}
            onChange={(e) => {
              onChangeEmail(e.target.value)
              setOtpError('')
              setOtpNotice('')
            }}
            style={{ width: '100%' }}
          />
        </div>

        {isVerified ? (
          <div
            className="email-verified-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '8px 14px',
              background: '#e8f5e9',
              color: '#2e7d32',
              borderRadius: '999px',
              fontSize: '0.82rem',
              fontWeight: 700,
              border: '1px solid #c8e6c9',
              flexShrink: 0,
              height: '42px',
            }}
          >
            <Check size={15} strokeWidth={2.6} />
            <span>Verified</span>
          </div>
        ) : (
          <button
            type="button"
            className="button button-secondary email-verify-btn"
            disabled={!canVerify || sendingOtp || checking}
            onClick={handleSendOtp}
            style={{
              flexShrink: 0,
              height: '42px',
              padding: '0 16px',
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {sendingOtp ? (
              <>
                <LoaderCircle size={15} className="spin" /> Sending…
              </>
            ) : checking ? (
              <>
                <LoaderCircle size={15} className="spin" /> Checking…
              </>
            ) : (
              'Verify'
            )}
          </button>
        )}
      </div>

      {availabilityMessage && !isVerified && (
        <small style={{ color: '#c2410c', fontSize: '0.8rem', fontWeight: 500, marginTop: '2px' }}>
          {availabilityMessage}
        </small>
      )}

      {/* 6-digit integer input below email (shown when OTP is sent and not yet verified) */}
      {otpSent && !isVerified && (
        <div
          className="email-otp-container"
          style={{
            marginTop: '4px',
            padding: '12px 14px',
            background: 'rgba(203, 116, 82, 0.06)',
            border: '1px solid rgba(203, 116, 82, 0.25)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)' }}>
              Enter 6-digit verification code sent to your email:
            </span>
            <button
              type="button"
              className="text-button"
              onClick={handleSendOtp}
              disabled={sendingOtp}
              style={{ fontSize: '0.78rem', color: 'var(--primary, #c34226)', textDecoration: 'underline' }}
            >
              Resend OTP
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="input-wrap" style={{ flex: 1, margin: 0 }}>
              <ShieldCheck size={16} />
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoFocus
                placeholder="6-digit OTP"
                value={otp}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setOtp(cleaned)
                  if (cleaned.length === 6) {
                    void handleVerifyOtp(cleaned)
                  }
                }}
                style={{ letterSpacing: '4px', fontWeight: 700, fontSize: '1rem' }}
              />
            </div>
            <button
              type="button"
              className="button button-dark"
              disabled={otp.length !== 6 || verifyingOtp}
              onClick={() => void handleVerifyOtp()}
              style={{ height: '42px', padding: '0 16px', fontSize: '0.85rem' }}
            >
              {verifyingOtp ? <LoaderCircle size={15} className="spin" /> : 'Confirm'}
            </button>
          </div>

          {otpNotice && (
            <small style={{ color: '#166534', fontSize: '0.78rem', fontWeight: 500 }}>
              {otpNotice}
            </small>
          )}
          {otpError && (
            <small style={{ color: '#c2410c', fontSize: '0.78rem', fontWeight: 600 }}>
              {otpError}
            </small>
          )}
        </div>
      )}
    </div>
  )
}
