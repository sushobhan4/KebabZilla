import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setAccessToken, type Account, type Role } from './api'

export type AuthResponse = {
  account?: Account
  requires_2fa?: boolean
  temp_token?: string
  email?: string
  role?: Role
}

type AuthContextValue = {
  account: Account | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<AuthResponse>
  register: (name: string, email: string, phone: string, password: string) => Promise<Account>
  googleSignIn: (credential: string) => Promise<AuthResponse>
  verify2fa: (temp_token: string, code: string) => Promise<Account>
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

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResponse> => {
    const result = await api<{ access_token?: string; account?: Account; requires_2fa?: boolean; temp_token?: string; email?: string; role?: Role }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    })
    if (result.requires_2fa) {
      return result
    }
    if (result.account) {
      accept({ access_token: result.access_token, account: result.account })
      return { account: result.account }
    }
    return result
  }, [accept])

  const register = useCallback(async (name: string, email: string, phone: string, password: string) => {
    const result = await api<{ access_token?: string; account: Account }>('/auth/register', {
      method: 'POST', body: JSON.stringify({ name, email, phone: phone || null, password }),
    })
    return accept(result)
  }, [accept])

  const googleSignIn = useCallback(async (credential: string): Promise<AuthResponse> => {
    const result = await api<{ access_token?: string; account?: Account; requires_2fa?: boolean; temp_token?: string; email?: string; role?: Role }>('/auth/google', {
      method: 'POST', body: JSON.stringify({ credential }),
    })
    if (result.requires_2fa) {
      return result
    }
    if (result.account) {
      accept({ access_token: result.access_token, account: result.account })
      return { account: result.account }
    }
    return result
  }, [accept])

  const verify2fa = useCallback(async (temp_token: string, code: string): Promise<Account> => {
    const result = await api<{ access_token?: string; account: Account }>('/auth/verify-2fa', {
      method: 'POST', body: JSON.stringify({ temp_token, code }),
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

  const value = useMemo(() => ({ account, loading, signIn, register, googleSignIn, verify2fa, signOut, updateAccount }), [account, loading, signIn, register, googleSignIn, verify2fa, signOut, updateAccount])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

type RestaurantContextValue = {
  restaurant: import('./api').Restaurant | null
  reloadRestaurant: () => Promise<void>
}

const RestaurantContext = createContext<RestaurantContextValue>({
  restaurant: null,
  reloadRestaurant: async () => {},
})

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const [restaurant, setRestaurant] = useState<import('./api').Restaurant | null>(() => {
    try {
      const saved = localStorage.getItem('kz_restaurant')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const reloadRestaurant = useCallback(async () => {
    try {
      const data = await api<import('./api').Restaurant>('/restaurant')
      setRestaurant(data)
      localStorage.setItem('kz_restaurant', JSON.stringify(data))
    } catch {
      // Keep existing or null
    }
  }, [])

  useEffect(() => {
    reloadRestaurant()
  }, [reloadRestaurant])

  const value = useMemo(() => ({ restaurant, reloadRestaurant }), [restaurant, reloadRestaurant])

  return <RestaurantContext.Provider value={value}>{children}</RestaurantContext.Provider>
}

export function useRestaurant() {
  return useContext(RestaurantContext)
}
