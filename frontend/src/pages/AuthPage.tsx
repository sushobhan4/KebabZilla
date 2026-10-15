import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CircleAlert, Eye, EyeOff, Flame, LockKeyhole, Mail, Phone, UserRound, WifiOff } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { useAuth, useRestaurant } from '../state'
import { Brand, EmptyState, PhoneInput } from '../components'
import { api, confirmPasswordReset, requestPasswordReset } from '../api'

export default function AuthPage({ mode }: { mode: 'login' | 'register' | 'recovery' }) {
  const { signIn, register, googleSignIn, verify2fa } = useAuth()
  const { restaurant } = useRestaurant()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tokenParam = searchParams.get('token') || ''
  const emailParam = searchParams.get('email') || ''
  const hasInviteToken = Boolean(tokenParam && mode === 'recovery')

  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || restaurant?.google_client_id || '').trim()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('+91')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [serverDown, setServerDown] = useState(false)
  const [twoFactor, setTwoFactor] = useState<{ temp_token: string; email: string; role?: string } | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const isRegister = mode === 'register'
  const isRecovery = mode === 'recovery'

  useEffect(() => {
    api('/restaurant')
      .then(() => setServerDown(false))
      .catch((err) => {
        const msg = err instanceof Error ? err.message.toLowerCase() : ''
        if (msg.includes('server') || msg.includes('down') || msg.includes('unavailable') || msg.includes('reach')) {
          setServerDown(true)
        }
      })
  }, [])

  useEffect(() => {
    if (emailParam) setEmail(emailParam)
    if (tokenParam) setOtp(tokenParam)
  }, [emailParam, tokenParam])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      if (isRecovery) {
        if (hasInviteToken) {
          if (password !== confirmPassword) {
            setError('Passwords do not match.')
            setBusy(false)
            return
          }
          if (password.length < 10) {
            setError('Password must be at least 10 characters long.')
            setBusy(false)
            return
          }
          await confirmPasswordReset(email.trim(), tokenParam, password)
          setSuccess('Your password has been set. Signing you in…')
          try {
            const loginRes = await signIn(email.trim(), password)
            if (loginRes.requires_2fa && loginRes.temp_token && loginRes.email) {
              setTwoFactor({ temp_token: loginRes.temp_token, email: loginRes.email, role: loginRes.role })
              setSuccess(`A 6-digit verification code has been sent to ${loginRes.email}`)
              return
            }
            navigate('/workspace', { replace: true })
          } catch {
            navigate('/login', { replace: true })
          }
          return
        }

        if (!otpSent) {
          await requestPasswordReset(email.trim())
          setOtpSent(true)
          setSuccess('If an active account uses that email, a 6-digit reset code has been sent.')
        } else {
          await confirmPasswordReset(email.trim(), otp.trim(), password)
          setSuccess('Your password has been reset. You can now sign in.')
          setOtpSent(false)
          setOtp('')
          setPassword('')
        }
        return
      }
      if (isRegister) {
        const phoneDigits = phone.replace(/^\+91/, '').replace(/\D/g, '')
        if (phoneDigits.length > 0 && phoneDigits.length !== 10) {
          setError('Please enter a valid 10-digit mobile number.')
          return
        }
        const phoneToSubmit = phoneDigits.length === 10 ? `+91${phoneDigits}` : ''
        await register(name.trim(), email.trim(), phoneToSubmit, password)
        navigate('/', { replace: true })
      } else {
        const res = await signIn(email.trim(), password)
        if (res.requires_2fa && res.temp_token && res.email) {
          setTwoFactor({ temp_token: res.temp_token, email: res.email, role: res.role })
          setSuccess(`A 6-digit verification code has been sent to ${res.email}`)
          return
        }
        navigate('/workspace', { replace: true })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      const lower = msg.toLowerCase()
      if (lower.includes('server') || lower.includes('down') || lower.includes('unavailable') || lower.includes('reach')) {
        setServerDown(true)
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onGoogleSuccess(credentialResponse: CredentialResponse) {
    if (!credentialResponse.credential) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      const res = await googleSignIn(credentialResponse.credential)
      if (res.requires_2fa && res.temp_token && res.email) {
        setTwoFactor({ temp_token: res.temp_token, email: res.email, role: res.role })
        setSuccess(`A 6-digit verification code has been sent to ${res.email}`)
        return
      }
      navigate(isRegister ? '/' : '/workspace', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in was unsuccessful.'
      const lower = msg.toLowerCase()
      if (lower.includes('server') || lower.includes('down') || lower.includes('unavailable') || lower.includes('reach')) {
        setServerDown(true)
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  async function submit2fa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!twoFactor) return
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      await verify2fa(twoFactor.temp_token, twoFactorCode.trim())
      navigate('/workspace', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid verification code. Please try again.'
      const lower = msg.toLowerCase()
      if (lower.includes('server') || lower.includes('down') || lower.includes('unavailable') || lower.includes('reach')) {
        setServerDown(true)
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-visual">
      <Link className="auth-back" to="/"><ArrowLeft size={16} /> Back to the menu</Link>
      <div className="auth-visual-copy"><span className="auth-emblem"><Flame size={29} /></span><div className="eyebrow light-eyebrow">SLOW FIRE. BIG FLAVOR.</div><h2>Some things are<br />worth getting<br /><em>your hands on.</em></h2><p>Smoky kebabs, fresh-off-the-grill and right on your doorstep.</p><div className="auth-proof"><span className="proof-avatars"><i>✦</i></span><span>Hot off the grill, ready for your doorstep.</span></div></div>
      <div className="auth-art"><span className="auth-art-ring" /><span className="auth-art-spark">✳</span><span className="auth-art-food">🥙</span><span className="auth-art-leaf">✦</span><span className="auth-art-label">FIRE · FLAVOR · FEAST</span></div>
      <div className="auth-visual-footer">© KebabZilla · Made fresh, served with care</div>
    </section>
    <section className="auth-form-side"><div className="auth-mobile-brand"><Brand /></div><div className="auth-card">
      {serverDown ? (
        <div className="auth-server-down">
          <div className="auth-heading">
            <div className="eyebrow">TEMPORARILY UNAVAILABLE</div>
            <h1>Servers are currently down</h1>
            <p>Our servers are taking a quick break or undergoing maintenance. We’ll be right back.</p>
          </div>
          <div style={{ padding: '1rem 0' }}>
            <EmptyState
              icon={<WifiOff size={24} />}
              title="Our servers are currently down"
              description="We’re having trouble connecting to our servers right now. Please check back in a few minutes or try again shortly."
              action={
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="button button-dark"
                    onClick={() => {
                      setServerDown(false)
                      setError('')
                      api('/restaurant').catch(() => setServerDown(true))
                    }}
                  >
                    Try again
                  </button>
                  <Link className="button button-outline" to="/">
                    Back to the menu
                  </Link>
                </div>
              }
            />
          </div>
        </div>
      ) : twoFactor ? (
        <>
          <div className="auth-heading">
            <div className="eyebrow">STAFF SECURITY VERIFICATION</div>
            <h1>Two-Step Verification</h1>
            <p>
              A 6-digit security code was dispatched to <strong>{twoFactor.email}</strong>. Enter it below to complete sign-in to your staff workspace.
            </p>
          </div>
          {error && (
            <div className="auth-inline-error" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c2410c', fontSize: '0.875rem', margin: '8px 0 16px', fontWeight: 500 }}>
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}
          {success && <div className="notice notice-success">{success}</div>}
          <form className="auth-form" onSubmit={submit2fa}>
            <label className="field-label">
              Verification Code
              <div className="input-wrap">
                <LockKeyhole size={17} />
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="6-digit verification code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
            </label>
            <button className="button button-dark auth-submit" type="submit" disabled={busy || twoFactorCode.length < 6}>
              {busy ? 'Verifying…' : 'Verify & Sign in'}
              <ArrowRight size={17} />
            </button>
            <button
              type="button"
              className="button button-ghost"
              style={{ width: '100%', marginTop: '0.5rem' }}
              onClick={() => {
                setTwoFactor(null)
                setTwoFactorCode('')
                setError('')
                setSuccess('')
              }}
            >
              Cancel & back to sign in
            </button>
          </form>
          <div className="auth-secure"><LockKeyhole size={14} /> Staff accounts require 2-step verification.</div>
        </>
      ) : (
        <>
          <div className="auth-heading"><div className="eyebrow">{hasInviteToken ? 'ACCOUNT ACTIVATION' : isRecovery ? 'WE CAN HELP' : isRegister ? 'GOOD TASTE STARTS HERE' : 'WELCOME BACK'}</div><h1>{hasInviteToken ? 'Set up your password' : isRecovery ? 'Reset your password' : isRegister ? 'Create your account' : 'Come on in.'}</h1><p>{hasInviteToken ? 'Choose a strong password or continue with Google to access your workspace.' : isRecovery ? 'Enter the email for your customer, admin, employee, or delivery account. Your restaurant administrator can help restore access.' : isRegister ? 'Get your favorites to your door in a few taps.' : 'The grill’s hot and your favorites are waiting.'}</p></div>
          {error && (
            <div className="auth-inline-error" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c2410c', fontSize: '0.875rem', margin: '8px 0 16px', fontWeight: 500 }}>
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}
          {success && <div className="notice notice-success">{success}</div>}

          {hasInviteToken && Boolean(googleClientId) && (
            <>
              <div className="google-auth-wrap">
                <GoogleOAuthProvider clientId={googleClientId}>
                  <GoogleLogin
                    onSuccess={onGoogleSuccess}
                    onError={() => setError('Google sign-in was unsuccessful.')}
                    shape="pill"
                    size="large"
                    text="signin_with"
                    width="360"
                  />
                </GoogleOAuthProvider>
              </div>
              <div className="auth-divider"><span>or set a password</span></div>
            </>
          )}

          <form className="auth-form" onSubmit={submit}>
            {isRegister && <label className="field-label">Your name<div className="input-wrap"><UserRound size={17} /><input autoComplete="name" required minLength={2} maxLength={120} placeholder="What should we call you?" value={name} onChange={(event) => setName(event.target.value)} /></div></label>}
            <label className="field-label">Email address<div className="input-wrap"><Mail size={17} /><input type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} readOnly={hasInviteToken} /></div></label>
            {isRegister && <label className="field-label">Phone number <span className="field-optional">optional</span><div className="input-wrap"><Phone size={17} /><PhoneInput placeholder="+91" value={phone} onChange={(val) => setPhone(val)} /></div></label>}

            {hasInviteToken && (
              <>
                <label className="field-label">New password<div className="input-wrap"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={10} maxLength={128} placeholder="At least 10 characters" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="input-trailing" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
                <label className="field-label">Confirm password<div className="input-wrap"><LockKeyhole size={17} /><input type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={10} maxLength={128} placeholder="Re-enter your password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><button className="input-trailing" type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>{showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
              </>
            )}

            {!isRecovery && <><label className="field-label">Password<div className="input-wrap"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 10 : 1} maxLength={128} placeholder={isRegister ? 'At least 10 characters' : 'Your password'} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="input-trailing" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>{!isRegister && <Link className="forgot-password-link" to="/forgot-password">Forgot password?</Link>}</>}
            {isRecovery && !hasInviteToken && otpSent && <><label className="field-label">One-time code<div className="input-wrap"><LockKeyhole size={17} /><input inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} placeholder="6-digit code from your email" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></div></label><label className="field-label">New password<div className="input-wrap"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={10} maxLength={128} placeholder="At least 10 characters" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="input-trailing" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label></>}
            {isRecovery ? <button className="button button-dark auth-submit" type="submit" disabled={busy}>{busy ? 'One moment…' : hasInviteToken ? 'Set password & continue' : otpSent ? 'Verify code & reset password' : 'Send OTP'}<ArrowRight size={17} /></button> : <button className="button button-dark auth-submit" type="submit" disabled={busy}>{busy ? 'One moment…' : isRegister ? 'Create my account' : 'Sign in'}<ArrowRight size={17} /></button>}
          </form>
          {!isRecovery && Boolean(googleClientId) && <>
            <div className="auth-divider"><span>or continue with</span></div>
            <div className="google-auth-wrap">
              <GoogleOAuthProvider clientId={googleClientId}>
                <GoogleLogin
                  onSuccess={onGoogleSuccess}
                  onError={() => setError('Google sign-in was unsuccessful.')}
                  shape="pill"
                  size="large"
                  text={isRegister ? 'signup_with' : 'signin_with'}
                  width="360"
                />
              </GoogleOAuthProvider>
            </div>
          </>}
          <div className="auth-switch">{isRecovery ? 'Remembered it?' : isRegister ? 'Already have an account?' : 'New around here?'} <Link to={isRecovery || isRegister ? '/login' : '/register'}>{isRecovery || isRegister ? 'Sign in' : 'Create an account'}</Link></div>
          <div className="auth-secure"><LockKeyhole size={14} /> Your account is secured with encrypted sign-in.</div>
        </>
      )}
    </div></section>
  </main>
}
