import { useEffect, useState } from 'react'
import { ArrowLeft, Monitor, Smartphone, Tablet } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type UserSession } from '../api'
import { useAuth } from '../state'
import { CenterDialog, Loading, PageTitle } from '../components'

function homeForRole(role?: string) {
  if (role === 'ADMIN') return '/admin'
  if (role === 'EMPLOYEE') return '/ops'
  if (role === 'DELIVERY') return '/delivery'
  return '/profile'
}

function formatSessionTime(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = Math.max(0, now.getTime() - date.getTime())
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 2) return 'Just now'
    if (diffMins < 60) return `${diffMins} minutes ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
    if (diffDays === 1) {
      const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      return `yesterday at ${timeStr}`
    }

    const monthDay = date.toLocaleDateString([], { month: 'long', day: 'numeric' })
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return `on ${monthDay} at ${timeStr}`
  } catch {
    return 'recently'
  }
}

function DeviceIcon({ type }: { type?: string }) {
  if (type === 'tablet') return <Tablet size={22} className="session-device-icon" />
  if (type === 'mobile') return <Smartphone size={22} className="session-device-icon" />
  return <Monitor size={22} className="session-device-icon" />
}

export default function Security() {
  const { account, signOut } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<UserSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sessionToRevoke, setSessionToRevoke] = useState<UserSession | null>(null)
  const [confirmRevokeAllOthers, setConfirmRevokeAllOthers] = useState(false)
  const [busy, setBusy] = useState(false)

  async function loadSessions() {
    try {
      setLoading(true)
      const data = await api<UserSession[]>('/auth/sessions')
      setSessions(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions()
  }, [])

  async function revokeSession(session: UserSession) {
    try {
      setBusy(true)
      const res = await api<{ revoked: boolean; is_current: boolean }>(`/auth/sessions/${session.id}/revoke`, {
        method: 'POST',
      })
      if (res.is_current) {
        signOut()
        navigate('/login')
        return
      }
      setNotice(`Logged out of ${session.device_name || 'device'}`)
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, is_revoked: true } : s))
      )
    } catch (err: any) {
      setError(err?.message || 'Failed to revoke session')
    } finally {
      setBusy(false)
      setSessionToRevoke(null)
    }
  }

  async function revokeAllOthers() {
    try {
      setBusy(true)
      const res = await api<{ revoked_count: number }>('/auth/sessions/revoke-others', {
        method: 'POST',
      })
      setNotice(`Successfully logged out of ${res.revoked_count} other device${res.revoked_count === 1 ? '' : 's'}`)
      setSessions((prev) =>
        prev.map((s) => (s.is_current ? s : { ...s, is_revoked: true }))
      )
    } catch (err: any) {
      setError(err?.message || 'Failed to revoke sessions')
    } finally {
      setBusy(false)
      setConfirmRevokeAllOthers(false)
    }
  }

  const currentSession = sessions.find((s) => s.is_current)
  const otherSessions = sessions.filter((s) => !s.is_current)
  const otherActiveSessions = otherSessions.filter((s) => !s.is_revoked)

  if (loading) {
    return (
      <main className="customer-page security-page">
        <Loading label="Loading login activity…" />
      </main>
    )
  }

  return (
    <main className="customer-page security-page">
      <PageTitle
        eyebrow={`${account?.role || 'ACCOUNT'} SECURITY`}
        title="Account login activity"
        description="Review devices currently logged into your account and manage active sessions."
        action={
          <Link className="button button-secondary" to={homeForRole(account?.role)}>
            <ArrowLeft size={15} /> Back
          </Link>
        }
      />

      {error && (
        <CenterDialog
          isOpen={Boolean(error)}
          onClose={() => setError('')}
          tone="danger"
          eyebrow="SECURITY ERROR"
          title="Action failed"
          description={error}
          primaryAction={{
            label: "Dismiss",
            variant: "primary",
            onClick: () => setError(''),
          }}
        />
      )}
      {notice && (
        <CenterDialog
          isOpen={Boolean(notice)}
          onClose={() => setNotice('')}
          tone="success"
          eyebrow="SECURITY NOTICE"
          title="Session updated"
          description={notice}
          primaryAction={{
            label: "Done",
            variant: "primary",
            onClick: () => setNotice(''),
          }}
        />
      )}

      <section className="login-activity-container">
        {/* Section 1: Current Active Device */}
        <div className="login-activity-section">
          <h2 className="login-activity-section-title">You're currently logged in on these devices:</h2>
          {currentSession ? (
            <div className="login-device-card current-device-card">
              <div className="login-device-main">
                <DeviceIcon type={currentSession.device_type} />
                <div className="login-device-info">
                  <div className="login-device-name">{currentSession.device_name || 'This device'}</div>
                  <div className="login-device-sub">
                    <span>{currentSession.location || 'Local network'}</span>
                    <span className="bullet-separator">•</span>
                    <span className="current-device-badge">This device</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="text-button session-logout-button"
                onClick={() => setSessionToRevoke(currentSession)}
                title="Log out of this device"
              >
                Log out
              </button>
            </div>
          ) : (
            <div className="login-device-card current-device-card">
              <div className="login-device-main">
                <Monitor size={22} className="session-device-icon" />
                <div className="login-device-info">
                  <div className="login-device-name">Current device</div>
                  <div className="login-device-sub">
                    <span className="current-device-badge">This device</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 2: Other Devices */}
        <div className="login-activity-section">
          <h2 className="login-activity-section-title">Logins on other devices</h2>
          {otherSessions.length > 0 ? (
            <div className="login-devices-list">
              {otherSessions.map((s) => (
                <div
                  key={s.id}
                  className={`login-device-row ${s.is_revoked ? 'login-device-revoked' : ''}`}
                >
                  <div className="login-device-main">
                    <DeviceIcon type={s.device_type} />
                    <div className="login-device-info">
                      <div className="login-device-name">{s.device_name || 'Device'}</div>
                      <div className="login-device-sub">
                        <span>{s.location || 'Unknown location'}</span>
                        <span className="bullet-separator">•</span>
                        <span>{formatSessionTime(s.last_active_at || s.created_at)}</span>
                        {s.is_revoked && (
                          <>
                            <span className="bullet-separator">•</span>
                            <span className="revoked-badge">Logged out</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="login-device-actions">
                    {!s.is_revoked ? (
                      <button
                        type="button"
                        className="text-button button-danger session-logout-button"
                        onClick={() => setSessionToRevoke(s)}
                      >
                        Log out
                      </button>
                    ) : (
                      <span className="revoked-status-text">Inactive</span>
                    )}
                  </div>
                </div>
              ))}

              {otherActiveSessions.length > 0 && (
                <div className="login-devices-footer">
                  <button
                    type="button"
                    className="select-logout-link"
                    onClick={() => setConfirmRevokeAllOthers(true)}
                  >
                    Select devices to log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="login-devices-empty">
              <p>No other active or previous sessions detected for this account.</p>
            </div>
          )}
        </div>
      </section>

      {/* Confirmation Dialog for Single Session Revoke */}
      {sessionToRevoke && (
        <CenterDialog
          isOpen={Boolean(sessionToRevoke)}
          onClose={() => setSessionToRevoke(null)}
          tone="danger"
          eyebrow="LOG OUT DEVICE"
          title={`Log out of ${sessionToRevoke.device_name || 'this device'}?`}
          description={
            sessionToRevoke.is_current
              ? 'This is your current device. Logging out will end your active session and return you to the login screen.'
              : `Are you sure you want to log out of ${sessionToRevoke.device_name || 'this device'} (${sessionToRevoke.location || 'Unknown location'})? That device will need to log in again.`
          }
          primaryAction={{
            label: busy ? 'Logging out…' : 'Log out',
            variant: 'danger',
            onClick: () => void revokeSession(sessionToRevoke),
          }}
          secondaryAction={{
            label: 'Cancel',
            variant: 'secondary',
            onClick: () => setSessionToRevoke(null),
          }}
        />
      )}

      {/* Confirmation Dialog for Revoking All Other Devices */}
      {confirmRevokeAllOthers && (
        <CenterDialog
          isOpen={confirmRevokeAllOthers}
          onClose={() => setConfirmRevokeAllOthers(false)}
          tone="danger"
          eyebrow="LOG OUT OTHER DEVICES"
          title="Log out of all other devices?"
          description={`You will be logged out of all ${otherActiveSessions.length} other active device(s). Only this device will remain logged in.`}
          primaryAction={{
            label: busy ? 'Logging out…' : 'Log out of all other devices',
            variant: 'danger',
            onClick: () => void revokeAllOthers(),
          }}
          secondaryAction={{
            label: 'Cancel',
            variant: 'secondary',
            onClick: () => setConfirmRevokeAllOthers(false),
          }}
        />
      )}
    </main>
  )
}
