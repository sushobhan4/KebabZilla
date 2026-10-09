import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setAccessToken, type Account } from './api'

type AuthContextValue = {
  account: Account | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<Account>
  register: (name: string, email: string, phone: string, password: string) => Promise<Account>
  googleSignIn: (credential: string) => Promise<Account>
  signOut: () => void
  updateAccount: (account: Account) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(() => {
    try {
      const saved = localStorage.getItem('kz_account') || sessionStorage.getItem('kz_account')
      return saved ? (JSON.parse(saved) as Account) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Validate active 30-day session with backend (HttpOnly cookie is attached automatically)
    api<Account>('/auth/me')
      .then((next) => {
        setAccount(next)
        localStorage.setItem('kz_account', JSON.stringify(next))
      })
      .catch(() => {
        setAccessToken(null)
        localStorage.removeItem('kz_account')
        sessionStorage.removeItem('kz_account')
        sessionStorage.removeItem('kz_access_token')
        setAccount(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const accept = useCallback((result: { access_token?: string; account: Account }) => {
    if (result.access_token) setAccessToken(result.access_token)
    setAccount(result.account)
    localStorage.setItem('kz_account', JSON.stringify(result.account))
    return result.account
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api<{ access_token?: string; account: Account }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    })
    return accept(result)
  }, [accept])

  const register = useCallback(async (name: string, email: string, phone: string, password: string) => {
    const result = await api<{ access_token?: string; account: Account }>('/auth/register', {
      method: 'POST', body: JSON.stringify({ name, email, phone: phone || null, password }),
    })
    return accept(result)
  }, [accept])

  const googleSignIn = useCallback(async (credential: string) => {
    const result = await api<{ access_token?: string; account: Account }>('/auth/google', {
      method: 'POST', body: JSON.stringify({ credential }),
    })
    return accept(result)
  }, [accept])

  const signOut = useCallback(() => {
    api('/auth/logout', { method: 'POST' }).catch(() => {})
    setAccessToken(null)
    localStorage.removeItem('kz_account')
    sessionStorage.removeItem('kz_account')
    sessionStorage.removeItem('kz_access_token')
    setAccount(null)
  }, [])

  const updateAccount = useCallback((next: Account) => {
    setAccount(next)
    localStorage.setItem('kz_account', JSON.stringify(next))
  }, [])

  const value = useMemo(() => ({ account, loading, signIn, register, googleSignIn, signOut, updateAccount }), [account, loading, signIn, register, googleSignIn, signOut, updateAccount])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
