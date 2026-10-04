import { useState, type FormEvent } from 'react'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Notice } from '../components'
import { useAuth } from '../state'

export default function ForcedPasswordChange() {
  const { account, updateAccount } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) })
      if (account) updateAccount({ ...account, must_change_password: false })
      navigate('/workspace', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your password.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page"><section className="auth-form-side"><div className="auth-card"><div className="auth-heading"><div className="eyebrow">ONE QUICK SECURITY STEP</div><h1>Set your password</h1><p>Before you can continue, replace the temporary password provided by your administrator.</p></div>{error && <Notice>{error}</Notice>}<form className="auth-form" onSubmit={submit}><label className="field-label">Temporary password<div className="input-wrap"><LockKeyhole size={17} /><input autoFocus type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div></label><label className="field-label">New password<div className="input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div></label><label className="field-label">Confirm new password<div className="input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div></label><button className="button button-dark auth-submit" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Save password'} <ArrowRight size={17} /></button></form></div></section></main>
}
