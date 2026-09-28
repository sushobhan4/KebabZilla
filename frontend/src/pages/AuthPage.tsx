import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, Flame, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../state'
import { Notice } from '../components'

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { signIn, register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isRegister = mode === 'register'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (isRegister) await register(name.trim(), email.trim(), phone.trim(), password)
      else await signIn(email.trim(), password)
      navigate(isRegister ? '/' : '/workspace', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
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
    <section className="auth-form-side"><div className="auth-mobile-brand"><img src="/kebabzilla-mark.png" alt="" /><span className="brand-word">Kebab<span>Zilla</span></span></div><div className="auth-card">
      <div className="auth-heading"><div className="eyebrow">{isRegister ? 'GOOD TASTE STARTS HERE' : 'WELCOME BACK'}</div><h1>{isRegister ? 'Create your account' : 'Come on in.'}</h1><p>{isRegister ? 'Get your favorites to your door in a few taps.' : 'The grill’s hot and your favorites are waiting.'}</p></div>
      {error && <Notice>{error}</Notice>}
      <form className="auth-form" onSubmit={submit}>
        {isRegister && <label className="field-label">Your name<div className="input-wrap"><UserRound size={17} /><input autoComplete="name" required minLength={2} maxLength={120} placeholder="What should we call you?" value={name} onChange={(event) => setName(event.target.value)} /></div></label>}
        <label className="field-label">Email address<div className="input-wrap"><Mail size={17} /><input type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div></label>
        {isRegister && <label className="field-label">Phone number <span className="field-optional">optional</span><div className="input-wrap"><Phone size={17} /><input type="tel" autoComplete="tel" maxLength={32} placeholder="+91 98765 43210" value={phone} onChange={(event) => setPhone(event.target.value)} /></div></label>}
        <label className="field-label">Password<div className="input-wrap"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 10 : 1} maxLength={128} placeholder={isRegister ? 'At least 10 characters' : 'Your password'} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="input-trailing" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <button className="button button-dark auth-submit" type="submit" disabled={busy}>{busy ? 'One moment…' : isRegister ? 'Create my account' : 'Sign in'}<ArrowRight size={17} /></button>
      </form>
      <div className="auth-switch">{isRegister ? 'Already have an account?' : 'New around here?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link></div>
      <div className="auth-secure"><LockKeyhole size={14} /> Your account is secured with encrypted sign-in.</div>
    </div></section>
  </main>
}
