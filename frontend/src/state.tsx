import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setAccessToken, type Account } from './api'

type AuthContextValue = {
  account: Account | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<Account>
  register: (name: string, email: string, phone: string, password: string) => Promise<Account>
  signOut: () => void
  updateAccount: (account: Account) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(() => {
    const saved = sessionStorage.getItem('kz_account')
    return saved ? JSON.parse(saved) as Account : null
  })
  const [loading, setLoading] = useState(Boolean(sessionStorage.getItem('kz_access_token')))

  useEffect(() => {
    if (!sessionStorage.getItem('kz_access_token')) return
    api<Account>('/auth/me').then((next) => {
      setAccount(next)
      sessionStorage.setItem('kz_account', JSON.stringify(next))
    }).catch(() => {
      setAccessToken(null)
      sessionStorage.removeItem('kz_account')
      setAccount(null)
    }).finally(() => setLoading(false))
  }, [])

  const accept = useCallback((result: { access_token: string; account: Account }) => {
    setAccessToken(result.access_token)
    setAccount(result.account)
    sessionStorage.setItem('kz_account', JSON.stringify(result.account))
    return result.account
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api<{ access_token: string; account: Account }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    })
    return accept(result)
  }, [accept])

  const register = useCallback(async (name: string, email: string, phone: string, password: string) => {
    const result = await api<{ access_token: string; account: Account }>('/auth/register', {
      method: 'POST', body: JSON.stringify({ name, email, phone: phone || null, password }),
    })
    return accept(result)
  }, [accept])

  const signOut = useCallback(() => {
    setAccessToken(null)
    sessionStorage.removeItem('kz_account')
    setAccount(null)
  }, [])

  const updateAccount = useCallback((next: Account) => {
    setAccount(next)
    sessionStorage.setItem('kz_account', JSON.stringify(next))
  }, [])

  const value = useMemo(() => ({ account, loading, signIn, register, signOut, updateAccount }), [account, loading, signIn, register, signOut, updateAccount])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
