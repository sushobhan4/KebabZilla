import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, Flame, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { GoogleOAuthProvider, GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { useAuth } from '../state'
import { Brand, Notice } from '../components'
import { confirmPasswordReset, requestPasswordReset } from '../api'

export default function AuthPage({ mode }: { mode: 'login' | 'register' | 'recovery' }) {
  const { signIn, register, googleSignIn } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tokenParam = searchParams.get('token') || ''
  const emailParam = searchParams.get('email') || ''
  const hasInviteToken = Boolean(tokenParam && mode === 'recovery')

  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isRegister = mode === 'register'
  const isRecovery = mode === 'recovery'

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
            await signIn(email.trim(), password)
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
      if (isRegister) await register(name.trim(), email.trim(), phone.trim(), password)
      else await signIn(email.trim(), password)
      navigate(isRegister ? '/' : '/workspace', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
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
      await googleSignIn(credentialResponse.credential)
      navigate(isRegister ? '/' : '/workspace', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in was unsuccessful.')
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
      <div className="auth-heading"><div className="eyebrow">{hasInviteToken ? 'ACCOUNT ACTIVATION' : isRecovery ? 'WE CAN HELP' : isRegister ? 'GOOD TASTE STARTS HERE' : 'WELCOME BACK'}</div><h1>{hasInviteToken ? 'Set up your password' : isRecovery ? 'Reset your password' : isRegister ? 'Create your account' : 'Come on in.'}</h1><p>{hasInviteToken ? 'Choose a strong password or continue with Google to access your workspace.' : isRecovery ? 'Enter the email for your customer, admin, employee, or delivery account. Your restaurant administrator can help restore access.' : isRegister ? 'Get your favorites to your door in a few taps.' : 'The grill’s hot and your favorites are waiting.'}</p></div>
      {error && <Notice>{error}</Notice>}
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
        {isRegister && <label className="field-label">Phone number <span className="field-optional">optional</span><div className="input-wrap"><Phone size={17} /><input type="tel" autoComplete="tel" maxLength={32} placeholder="+91 98765 43210" value={phone} onChange={(event) => setPhone(event.target.value)} /></div></label>}

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
    </div></section>
  </main>
}
