import { getExactDeviceName, getStableDeviceFingerprint } from './device'

const rawBase = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
export const API_BASE = rawBase.endsWith('/api/v1') ? rawBase : `${rawBase}/api/v1`

let memoryCsrfToken: string | null = null
try {
  memoryCsrfToken = localStorage.getItem('kz_csrf_token')
} catch {}

type CacheEntry = {
  data: unknown
  timestamp: number
  epoch: number
}

const apiGetCache = new Map<string, CacheEntry>()
const apiInFlight = new Map<string, Promise<unknown>>()

let currentMutationEpoch = 0

// Patterns that MUST NOT be cached across seconds because they represent live, transactional operational state
const DYNAMIC_REALTIME_PATTERNS = [
  '/delivery',
  '/staff',
  '/admin',
  '/orders',
  '/cart',
  '/auth',
]

function isDynamicPath(path: string): boolean {
  return DYNAMIC_REALTIME_PATTERNS.some((pattern) => path.includes(pattern))
}

const STATIC_CACHE_FRESH_MS = 4_000

export function clearApiCache(prefix?: string) {
  currentMutationEpoch++
  if (!prefix) {
    apiGetCache.clear()
    apiInFlight.clear()
  } else {
    for (const key of apiGetCache.keys()) {
      if (key.includes(prefix)) {
        apiGetCache.delete(key)
      }
    }
    for (const key of apiInFlight.keys()) {
      if (key.includes(prefix)) {
        apiInFlight.delete(key)
      }
    }
  }
}

let memoryAccessToken: string | null = null
try {
  memoryAccessToken = localStorage.getItem('kz_access_token') || sessionStorage.getItem('kz_access_token')
} catch {}

let memoryRefreshToken: string | null = null
try {
  memoryRefreshToken = localStorage.getItem('kz_refresh_token') || sessionStorage.getItem('kz_refresh_token')
} catch {}

// Cross-Tab BroadcastChannel for synchronized authentication and coordinated token refresh
const authChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window 
  ? new BroadcastChannel('kz_auth_sync') 
  : null

if (authChannel) {
  authChannel.onmessage = (event) => {
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'AUTH_UPDATED') {
      if (data.accessToken) memoryAccessToken = data.accessToken
      if (data.refreshToken) memoryRefreshToken = data.refreshToken
      if (data.csrfToken) memoryCsrfToken = data.csrfToken
      clearApiCache()
    } else if (data.type === 'AUTH_LOGOUT') {
      memoryAccessToken = null
      memoryRefreshToken = null
      memoryCsrfToken = null
      clearApiCache()
      try {
        localStorage.removeItem('kz_access_token')
        localStorage.removeItem('kz_refresh_token')
        localStorage.removeItem('kz_csrf_token')
        localStorage.removeItem('kz_account')
        sessionStorage.clear()
      } catch {}
    }
  }
}

// Cross-Tab storage event listener fallback for browsers without full BroadcastChannel support
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'kz_access_token') {
      memoryAccessToken = event.newValue
    } else if (event.key === 'kz_refresh_token') {
      memoryRefreshToken = event.newValue
    } else if (event.key === 'kz_csrf_token') {
      memoryCsrfToken = event.newValue
    }
  })
}

export function getAccessToken(): string | null {
  try {
    const stored = localStorage.getItem('kz_access_token') || sessionStorage.getItem('kz_access_token')
    if (stored) memoryAccessToken = stored
  } catch {}
  return memoryAccessToken
}

export function setAccessToken(token: string | null) {
  memoryAccessToken = token
  clearApiCache()
  try {
    if (token) {
      localStorage.setItem('kz_access_token', token)
    } else {
      localStorage.removeItem('kz_access_token')
      sessionStorage.removeItem('kz_access_token')
    }
  } catch {}
}

export function getRefreshToken(): string | null {
  try {
    const stored = localStorage.getItem('kz_refresh_token') || sessionStorage.getItem('kz_refresh_token')
    if (stored) memoryRefreshToken = stored
  } catch {}
  return memoryRefreshToken
}

export function setRefreshToken(token: string | null) {
  memoryRefreshToken = token
  try {
    if (token) {
      localStorage.setItem('kz_refresh_token', token)
    } else {
      localStorage.removeItem('kz_refresh_token')
      sessionStorage.removeItem('kz_refresh_token')
    }
  } catch {}
}

export function setCsrfToken(token: string | null) {
  memoryCsrfToken = token
  try {
    if (token) localStorage.setItem('kz_csrf_token', token)
    else localStorage.removeItem('kz_csrf_token')
  } catch {}
}

function getCsrfToken(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;\s*)kz_csrf_token=([^;]+)/)
    if (match) return decodeURIComponent(match[1])
  } catch {}
  if (!memoryCsrfToken) {
    try {
      memoryCsrfToken = localStorage.getItem('kz_csrf_token')
    } catch {}
  }
  return memoryCsrfToken
}

export type ApiInit = RequestInit & {
  skipCache?: boolean
  _isRetry?: boolean
}

let refreshPromise: Promise<boolean> | null = null

/**
 * Coordinated Cross-Tab Mutex Queue:
 * 1. Coordinates via navigator.locks (Web Locks API) so only 1 tab across the entire browser hits /auth/refresh.
 * 2. If another tab is already refreshing, other tabs await that tab's completion instead of clashing.
 * 3. Broadcasts the refreshed tokens to all other tabs via BroadcastChannel.
 */
async function performActualRefresh(): Promise<boolean> {
  try {
    const [fingerprint, deviceName] = await Promise.all([
      getStableDeviceFingerprint().catch(() => ''),
      getExactDeviceName().catch(() => ''),
    ])
    const headers = new Headers({
      'Content-Type': 'application/json',
    })
    if (fingerprint) headers.set('X-Device-Fingerprint', fingerprint)
    if (deviceName) headers.set('X-Device-Name', deviceName)

    // Always fetch latest refresh token from disk/storage
    const rToken = getRefreshToken()
    if (rToken) headers.set('X-Refresh-Token', rToken)

    const csrf = getCsrfToken()
    if (csrf) headers.set('X-CSRF-Token', csrf)

    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers,
      credentials: 'include',
    })

    const csrfHeader = res.headers.get('x-csrf-token')
    if (csrfHeader) {
      setCsrfToken(csrfHeader)
    }

    if (res.ok) {
      const data = await res.json().catch(() => null) as {
        access_token?: string
        refresh_token?: string
        account?: unknown
        csrf_token?: string
      } | null

      if (data?.access_token) {
        setAccessToken(data.access_token)
      }
      if (data?.refresh_token) {
        setRefreshToken(data.refresh_token)
      }
      if (data?.csrf_token) {
        setCsrfToken(data.csrf_token)
      }
      if (data?.account) {
        try {
          localStorage.setItem('kz_account', JSON.stringify(data.account))
        } catch {}
      }

      // Broadcast fresh credentials to all sibling tabs immediately
      if (authChannel) {
        try {
          authChannel.postMessage({
            type: 'AUTH_UPDATED',
            accessToken: data?.access_token,
            refreshToken: data?.refresh_token,
            csrfToken: data?.csrf_token,
          })
        } catch {}
      }

      return true
    } else {
      if (res.status === 401 || res.status === 403) {
        setAccessToken(null)
        setRefreshToken(null)
        setCsrfToken(null)
        try {
          localStorage.removeItem('kz_account')
          sessionStorage.removeItem('kz_account')
        } catch {}
        if (authChannel) {
          try {
            authChannel.postMessage({ type: 'AUTH_LOGOUT' })
          } catch {}
        }
      }
      return false
    }
  } catch {
    return false
  }
}

async function silentRefresh(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    const tokenBefore = getAccessToken()
    const rTokenBefore = getRefreshToken()

    // If Web Locks API is available, coordinate cleanly across all browser tabs:
    // Only 1 tab executes /auth/refresh while all other tabs queue and wait.
    if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks.request) {
      try {
        return await navigator.locks.request('kz_auth_refresh_lock', async () => {
          // Double-check: While this tab was waiting for the lock, did the leader tab already finish refreshing?
          const tokenAfterLock = getAccessToken()
          const rTokenAfterLock = getRefreshToken()
          if (
            (tokenAfterLock && tokenAfterLock !== tokenBefore) ||
            (rTokenAfterLock && rTokenAfterLock !== rTokenBefore)
          ) {
            // Sibling tab already rotated credentials and shared them via BroadcastChannel/storage!
            return true
          }
          return await performActualRefresh()
        })
      } catch {
        // Fallback to direct refresh if lock request fails
        return await performActualRefresh()
      } finally {
        refreshPromise = null
      }
    }

    // Direct tab execution fallback
    try {
      return await performActualRefresh()
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase()
  const isGet = method === 'GET'

  if (!isGet) {
    clearApiCache()
  } else if (!init.skipCache && !isDynamicPath(path)) {
    const cached = apiGetCache.get(path)
    if (cached && (Date.now() - cached.timestamp < STATIC_CACHE_FRESH_MS) && cached.epoch === currentMutationEpoch) {
      return cached.data as T
    }
  }

  if (isGet && !init.skipCache) {
    const inFlight = apiInFlight.get(path)
    if (inFlight) {
      return inFlight as Promise<T>
    }
  }

  const startEpoch = currentMutationEpoch

  const executeRequest = async (): Promise<T> => {
    const headers = new Headers(init.headers)
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    
    // Attach Bearer token if present (immune to cross-subdomain/cross-port cookie blocking)
    const token = getAccessToken()
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrf = getCsrfToken()
      if (csrf && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrf)
    }

    // Attach silicon hardware fingerprint and exact device name on auth endpoints
    if (['/auth/login', '/auth/verify-2fa', '/auth/google', '/auth/refresh'].some((p) => path.startsWith(p))) {
      const [fingerprint, deviceName] = await Promise.all([
        getStableDeviceFingerprint().catch(() => ''),
        getExactDeviceName().catch(() => ''),
      ])
      if (fingerprint && !headers.has('X-Device-Fingerprint')) headers.set('X-Device-Fingerprint', fingerprint)
      if (deviceName && !headers.has('X-Device-Name')) headers.set('X-Device-Name', deviceName)
    }

    let response: Response
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      })
    } catch {
      throw new Error('Our servers are currently down. Please check back in a few minutes.')
    }
    const responseCsrf = response.headers.get('x-csrf-token')
    if (responseCsrf) {
      setCsrfToken(responseCsrf)
    }

    if (!response.ok) {
      const isAuthPath =
        path.startsWith('/auth/login') ||
        path.startsWith('/auth/refresh') ||
        path.startsWith('/auth/register') ||
        path.startsWith('/auth/verify-2fa')

      // Transparent 401 Silent Refresh Queue: Retry once after rotating tokens
      if (response.status === 401 && !isAuthPath && !init._isRetry) {
        const refreshed = await silentRefresh()
        if (refreshed) {
          return api<T>(path, { ...init, _isRetry: true })
        }
      }

      const problem = await response.json().catch(() => null) as { detail?: unknown; message?: unknown } | null
      const detail = problem?.detail
      const validationMessages = Array.isArray(detail)
        ? detail.map((item) => item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string' ? item.msg : '').filter(Boolean).join('; ')
        : ''
      const message = typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
          ? detail.message
          : validationMessages || (typeof problem?.message === 'string' ? problem.message : '')

      // Auto-cleanup stale auth tokens when rejected by server with 401 Unauthorized
      if (
        response.status === 401 &&
        !path.startsWith('/auth/login') &&
        !path.startsWith('/auth/register') &&
        !path.startsWith('/auth/verify-2fa')
      ) {
        setAccessToken(null)
        setRefreshToken(null)
        setCsrfToken(null)
        try {
          localStorage.removeItem('kz_access_token')
          localStorage.removeItem('kz_refresh_token')
          localStorage.removeItem('kz_csrf_token')
          localStorage.removeItem('kz_account')
          sessionStorage.removeItem('kz_access_token')
          sessionStorage.removeItem('kz_refresh_token')
          sessionStorage.removeItem('kz_account')
        } catch {
          // Ignore storage restrictions in private tabs
        }
        // Do not dispatch global kick-out event for initial background /auth/me probe
        if (typeof window !== 'undefined' && !path.startsWith('/auth/me')) {
          window.dispatchEvent(
            new CustomEvent('kz_unauthorized', {
              detail: {
                message: message || 'Session expired. Please sign in again.',
                status: 401,
                path,
              },
            })
          )
        }
      }

      if (message) {
        throw new Error(message)
      }
      if (response.status >= 500) {
        throw new Error('A server error occurred. Please try again.')
      }
      throw new Error(`The request failed (${response.status}). Please try again.`)
    }
    if (response.status === 204) return undefined as T
    const result = await response.json() as T
    if (isGet && !init.skipCache && !isDynamicPath(path) && startEpoch === currentMutationEpoch) {
      apiGetCache.set(path, { data: result, timestamp: Date.now(), epoch: startEpoch })
    }
    return result
  }

  if (isGet && !init.skipCache) {
    const p = executeRequest()
    apiInFlight.set(path, p)
    p.finally(() => {
      if (apiInFlight.get(path) === p) {
        apiInFlight.delete(path)
      }
    })
    return p
  }

  return executeRequest()
}

export type Role = 'ADMIN' | 'EMPLOYEE' | 'DELIVERY' | 'USER'
export type Account = {
  id: number
  name: string
  email: string
  phone: string | null
  addresses: SavedAddress[]
  role: Role
  must_change_password: boolean
  is_accepting_deliveries?: boolean
  promotional_consent?: boolean
  created_at: string
}

export type ProvisionedAccount = Account & {
  temporary_password: string | null
  notification_status: 'EMAIL_SENT' | 'EMAIL_FAILED' | 'NOT_CONFIGURED'
}
export type UserSession = {
  id: number
  device_name: string
  device_type: 'desktop' | 'mobile' | 'tablet' | string
  country: string
  region: string
  city: string
  location: string
  ip_address: string
  created_at: string
  last_active_at: string
  is_current: boolean
  is_revoked: boolean
}

export type SavedAddress = {
  id: string; label: string; house_number?: string; area?: string; road?: string
  landmark?: string; city?: string; pincode?: string; postal_code?: string; latitude?: number | null; longitude?: number | null; is_default?: boolean
  distance_meters?: number | null
}
export type MenuItemVariation = {
  name: string
  price_paise: number
}
export type MenuItem = {
  id: number
  name: string
  description: string
  category: string
  category_id: number | null
  categories?: string[]
  category_ids?: number[]
  price_paise: number
  base_price_paise?: number
  discount_percent: number
  discounted_price_paise: number | null
  image_url: string | null
  image_urls: string[]
  is_vegetarian: boolean
  is_available: boolean
  is_paused?: boolean
  is_featured: boolean
  variations?: MenuItemVariation[]
  is_custom?: boolean
  custom_menu_item_id?: number
  custom_sections?: CustomMenuSection[]
  discount_campaign_name: string | null
  popularity_count: number
}
export type CustomMenuSectionOption = {
  name: string
  extra_paise: number
}
export type CustomMenuSection = {
  id?: number
  name: string
  position?: number
  required?: boolean
  options: CustomMenuSectionOption[]
}
export type CustomMenuItem = {
  id: number
  name: string
  description: string
  category: string
  category_id: number | null
  categories?: string[]
  category_ids?: number[]
  base_price_paise: number
  lowest_price_paise?: number
  image_url: string | null
  image_urls: string[]
  is_vegetarian: boolean
  is_available: boolean
  is_paused?: boolean
  is_featured: boolean
  sections: CustomMenuSection[]
}

export function getCustomItemLowestPrice(item: CustomMenuItem): number {
  if (item.lowest_price_paise != null && item.lowest_price_paise > 0) {
    return item.lowest_price_paise
  }
  let total = item.base_price_paise
  for (const sec of item.sections || []) {
    if (sec.required !== false && sec.options && sec.options.length > 0) {
      const minExtra = Math.min(...sec.options.map((o) => o.extra_paise || 0))
      total += minExtra
    }
  }
  return total
}

export function getMenuItemLowestPrice(item: MenuItem): number {
  if (item.is_custom) {
    if (item.custom_sections && item.custom_sections.length > 0) {
      let total = item.base_price_paise ?? item.price_paise
      for (const sec of item.custom_sections) {
        if (sec.required !== false && sec.options && sec.options.length > 0) {
          const minExtra = Math.min(...sec.options.map((o) => o.extra_paise || 0))
          total += minExtra
        }
      }
      return total
    }
    return item.price_paise
  }
  if (item.variations && item.variations.length > 0) {
    return Math.min(...item.variations.map((v) => v.price_paise))
  }
  return item.price_paise
}

export function getItemDiscountedLowestPrice(item: MenuItem, lowestOriginalPrice?: number): number {
  const original = lowestOriginalPrice ?? getMenuItemLowestPrice(item)
  if (item.discount_percent && item.discount_percent > 0) {
    return Math.max(1, Math.round((original * (100 - item.discount_percent)) / 100))
  }
  if (item.discounted_price_paise != null && item.discounted_price_paise < original) {
    return item.discounted_price_paise
  }
  return original
}
export type SavedCartItem = {
  id?: number
  menu_id?: number | null
  menu_item_id?: number | null
  variation_name?: string | null
  quantity: number
  unit_price_paise?: number
  customizations?: CustomMenuSectionOption[]
}
export type Order = {
  order_id: string
  customer_id: number | null
  customer_name: string
  customer_phone: string | null
  status: string
  order_type: string
  payment_method?: string | null
  payment_status?: string | null
  subtotal_paise: number
  delivery_fee_paise: number
  total_paise: number
  address?: string
  latitude?: number | null
  longitude?: number | null
  notes: string
  assigned_delivery_id: number | null
  scheduled_for?: string | null
  delivery_name?: string | null
  delivery_phone?: string | null
  created_at: string
  items: { menu_item_id: number | null; name: string; quantity: number; price_paise: number; line_total_paise: number; customizations?: CustomMenuSectionOption[]; image_url?: string | null; image_urls?: string[] }[]
  checkout?: { gateway_order_id: string; amount: number; currency: string; key_id: string; name: string; description: string; prefill: { name: string; email: string; contact: string } }
  delivery_otp?: string | null
}
export type TodaySchedule = {
  day: string
  open: boolean
  opens: string
  closes: string
}

export type Restaurant = {
  restaurant_name: string
  tagline: string
  phone: string
  phones?: string[]
  email?: string
  address: string
  latitude: number | null
  longitude: number | null
  today_schedule?: TodaySchedule | null
  weekly_schedule?: Record<string, any>
  can_schedule_order?: boolean
  minimum_order_paise: number
  delivery_radius_km: number
  free_delivery_radius_km: number
  free_delivery_threshold_paise?: number
  delivery_fee_per_km_paise: number
  charge_from_zero_beyond_free_radius?: boolean
  accepting_orders?: boolean
  is_restaurant_open?: boolean
  is_delivery_open?: boolean
  delivery_paused_reason?: string | null
  order_cutoff_minutes_before_closing?: number
  delivery_status?: 'OPEN' | 'CLOSING_SOON' | 'DELIVERY_CUTOFF' | 'DELIVERY_PAUSED' | 'RESTAURANT_CLOSED'
  delivery_status_heading?: string
  delivery_status_message?: string
  closing_in_minutes?: number | null
  cutoff_in_minutes?: number | null
  closing_time?: string | null
  admin_override_open?: boolean
  admin_override_state?: boolean | null
  admin_override_until?: string | null
  is_currently_scheduled_open?: boolean
  schedule_status?: string
  next_schedule_refresh?: string | null
  enforce_driver_geofence?: boolean
  driver_geofence_meters?: number
  haversine_routing_factor?: number
  average_delivery_speed_kmh?: number
  customer_sla_minutes?: number
  alns_max_iterations_mode?: 'AUTO' | 'MANUAL'
  alns_max_iterations?: number
  max_orders_per_driver?: number
  available_drivers_ready?: number
  google_client_id?: string | null
  google_maps_api_key?: string | null
}

export type DriverDutyStatus = {
  is_accepting_deliveries: boolean
  is_restaurant_open: boolean
  schedule_status: string
  enforce_geofence: boolean
  geofence_meters: number
  restaurant_latitude: number | null
  restaurant_longitude: number | null
  active_riders: number
}

export type RecommendedBatchesResponse = {
  is_accepting_deliveries: boolean
  active_riders: number
  is_restaurant_open: boolean
  schedule_status: string
  single_order: boolean
  order: (Order & { round_trip_km?: number; round_trip_time_minutes?: number }) | null
  round_trip_km?: number
  round_trip_time_minutes?: number
  clusters: {
    id: string
    route_label: string
    orders: Order[]
    round_trip_km?: number
    round_trip_time_minutes?: number
    legs?: any[]
  }[]
  restaurant_latitude: number | null
  restaurant_longitude: number | null
}

export const formatINR = (paise: number) => {
  const inr = (paise || 0) / 100
  const hasDecimals = Math.abs(inr - Math.round(inr)) > 0.001
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(inr)
}

export function formatSavedAddress(saved: SavedAddress) {
  const parts = [saved.house_number, saved.road, saved.area, saved.city, saved.pincode || saved.postal_code].map((part) => part?.trim()).filter(Boolean)
  return parts.join(', ')
}

export function friendlyDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function formatStatus(value?: string | null) {
  if (!value) return ''
  if (value === 'PLACED') return 'Waiting'
  if (value === 'ACCEPTED' || value === 'PREPARING') return 'Preparing'
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export async function requestPasswordReset(email: string) {
  return api<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function confirmPasswordReset(email: string, otp: string, newPassword: string) {
  return api<void>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, otp, new_password: newPassword }),
  })
}

export type UploadImageResult = {
  url: string
  gcs_uri: string
  filename: string
  content_type: string
  size_bytes: number
  public_url?: string
}

export async function uploadMenuImage(file: File): Promise<UploadImageResult> {
  const formData = new FormData()
  formData.append('file', file)
  return api<UploadImageResult>('/menu/images/upload', {
    method: 'POST',
    body: formData,
  })
}

export type EmailImageItem = {
  filename: string
  url: string
  public_url: string
  size_bytes: number
  created_at?: string | null
}

export async function uploadEmailImage(file: File): Promise<UploadImageResult> {
  const formData = new FormData()
  formData.append('file', file)
  return api<UploadImageResult>('/admin/email-images/upload', {
    method: 'POST',
    body: formData,
  })
}

export async function listEmailImages(): Promise<EmailImageItem[]> {
  return api<EmailImageItem[]>('/admin/email-images')
}

export async function deleteEmailImage(filename: string): Promise<boolean> {
  if (!filename) return false
  const cleanName = filename.startsWith('/api/v1/public/email-images/')
    ? filename.slice('/api/v1/public/email-images/'.length)
    : filename.split('/').pop() || filename
  try {
    await api<{ deleted: boolean }>(`/admin/email-images/${encodeURIComponent(cleanName)}`, {
      method: 'DELETE',
    })
    return true
  } catch (err) {
    console.warn('Could not delete email image from GCS:', err)
    return false
  }
}

export async function deleteMenuImage(urlOrFilename: string): Promise<boolean> {
  if (!urlOrFilename) return false
  const filename = urlOrFilename.startsWith('/menu/images/gcs/')
    ? urlOrFilename.slice('/menu/images/gcs/'.length)
    : urlOrFilename.split('/').pop() || urlOrFilename
  try {
    await api<{ deleted: boolean }>(`/menu/images/gcs/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    })
    return true
  } catch (err) {
    console.warn('Could not delete image from GCS:', err)
    return false
  }
}

export function resolveImageUrl(url: string): string {
  if (!url) return ''
  let trimmed = url.trim()

  // Normalize legacy or shortcut email-images paths to standard public route
  if (trimmed.startsWith('/emailImages/')) {
    trimmed = '/api/v1/public/email-images/' + trimmed.slice('/emailImages/'.length)
  } else if (trimmed.startsWith('/email-images/')) {
    trimmed = '/api/v1/public/email-images/' + trimmed.slice('/email-images/'.length)
  } else if (trimmed.startsWith('/public/email-images/')) {
    trimmed = '/api/v1/public/email-images/' + trimmed.slice('/public/email-images/'.length)
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    try {
      const parsed = new URL(trimmed)
      const fileId = parsed.hostname === 'drive.google.com'
        ? parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get('id')
        : null
      if (fileId) return `${API_BASE}/menu/images/${encodeURIComponent(fileId)}`

      if (
        (parsed.hostname === 'kebabzilla.in' || parsed.hostname === 'api.kebabzilla.in' || parsed.hostname.includes('run.app')) &&
        (parsed.pathname.includes('/public/email-images/') || parsed.pathname.includes('/email-images/') || parsed.pathname.includes('/emailImages/'))
      ) {
        const cleanBase = API_BASE.endsWith('/api/v1') ? API_BASE.slice(0, -'/api/v1'.length) : API_BASE
        const filename = parsed.pathname.split('/').pop() || ''
        const normalizedPath = `/api/v1/public/email-images/${filename}`
        return cleanBase ? `${cleanBase}${normalizedPath}` : normalizedPath
      }

      return trimmed
    } catch {
      return trimmed
    }
  }
  const cleanBase = API_BASE.endsWith('/api/v1') ? API_BASE.slice(0, -'/api/v1'.length) : API_BASE
  if (trimmed.startsWith('/api/v1/')) {
    return cleanBase ? `${cleanBase}${trimmed}` : trimmed
  }
  if (trimmed.startsWith('/')) {
    return `${API_BASE}${trimmed}`
  }
  return trimmed
}

export async function updatePromotionalConsent(promotional_consent: boolean): Promise<Account> {
  return api<Account>('/auth/promotional-consent', {
    method: 'PATCH',
    body: JSON.stringify({ promotional_consent }),
  })
}

