import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setAccessToken, setCsrfToken, type Account, type Role } from './api'
import { getCookieConsent, saveCookieConsent } from './cookies'

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
        setCsrfToken(null)
        localStorage.removeItem('kz_account')
        localStorage.removeItem('kz_access_token')
        localStorage.removeItem('kz_csrf_token')
        sessionStorage.removeItem('kz_account')
        sessionStorage.removeItem('kz_access_token')
        setAccount(null)
      })
      .finally(() => setLoading(false))

    const handleUnauthorized = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string; path?: string }>
      setAccount(null)
      setAccessToken(null)
      setCsrfToken(null)
      try {
        localStorage.removeItem('kz_account')
        localStorage.removeItem('kz_access_token')
        localStorage.removeItem('kz_csrf_token')
        sessionStorage.removeItem('kz_account')
        sessionStorage.removeItem('kz_access_token')
      } catch {
        // ignore
      }
      // ONLY redirect to login if the user is currently on a protected route that requires auth
      const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : ''
      const isProtected =
        pathname.startsWith('/admin') ||
        pathname.startsWith('/ops') ||
        pathname.startsWith('/delivery') ||
        pathname.startsWith('/orders') ||
        pathname.startsWith('/profile') ||
        pathname.startsWith('/security') ||
        pathname.startsWith('/change-password')

      if (isProtected) {
        const msg = custom.detail?.message || 'Your session has expired or device was unrecognized. Please sign in again.'
        const params = new URLSearchParams()
        params.set('reason', msg)
        window.location.assign(`/login?${params.toString()}`)
      }
    }
    window.addEventListener('kz_unauthorized', handleUnauthorized)
    return () => window.removeEventListener('kz_unauthorized', handleUnauthorized)
  }, [])

  const accept = useCallback((result: { access_token?: string; csrf_token?: string; account: Account }) => {
    if (result.access_token) setAccessToken(result.access_token)
    if (result.csrf_token) setCsrfToken(result.csrf_token)
    setAccount(result.account)
    localStorage.setItem('kz_account', JSON.stringify(result.account))

    // Keep client-side cookie consent in sync with account promotional consent
    if (result.account?.promotional_consent !== undefined) {
      const current = getCookieConsent()
      if (current.marketing !== result.account.promotional_consent) {
        saveCookieConsent({ marketing: result.account.promotional_consent })
      }
    }

    return result.account
  }, [])

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResponse> => {
    const result = await api<{ access_token?: string; csrf_token?: string; account?: Account; requires_2fa?: boolean; temp_token?: string; email?: string; role?: Role }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    })
    if (result.requires_2fa) {
      return result
    }
    if (result.account) {
      accept({ access_token: result.access_token, csrf_token: result.csrf_token, account: result.account })
      return { account: result.account }
    }
    return result
  }, [accept])

  const register = useCallback(async (name: string, email: string, phone: string, password: string) => {
    const consent = getCookieConsent()
    const result = await api<{ access_token?: string; csrf_token?: string; account: Account }>('/auth/register', {
      method: 'POST', body: JSON.stringify({
        name,
        email,
        phone: phone || null,
        password,
        promotional_consent: consent.marketing,
      }),
    })
    return accept(result)
  }, [accept])

  const googleSignIn = useCallback(async (credential: string): Promise<AuthResponse> => {
    const result = await api<{ access_token?: string; csrf_token?: string; account?: Account; requires_2fa?: boolean; temp_token?: string; email?: string; role?: Role }>('/auth/google', {
      method: 'POST', body: JSON.stringify({ credential }),
    })
    if (result.requires_2fa) {
      return result
    }
    if (result.account) {
      accept({ access_token: result.access_token, csrf_token: result.csrf_token, account: result.account })
      return { account: result.account }
    }
    return result
  }, [accept])

  const verify2fa = useCallback(async (temp_token: string, code: string): Promise<Account> => {
    const result = await api<{ access_token?: string; csrf_token?: string; account: Account }>('/auth/verify-2fa', {
      method: 'POST', body: JSON.stringify({ temp_token, code }),
    })
    return accept(result)
  }, [accept])

  const signOut = useCallback(() => {
    api('/auth/logout', { method: 'POST' }).catch(() => {})
    setAccessToken(null)
    setCsrfToken(null)
    localStorage.removeItem('kz_account')
    localStorage.removeItem('kz_access_token')
    localStorage.removeItem('kz_csrf_token')
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
