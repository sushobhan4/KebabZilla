const rawBase = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
export const API_BASE = rawBase.endsWith('/api/v1') ? rawBase : `${rawBase}/api/v1`

let accessToken: string | null = null
try {
  accessToken = localStorage.getItem('kz_access_token')
} catch {}

let memoryCsrfToken: string | null = null
try {
  memoryCsrfToken = localStorage.getItem('kz_csrf_token')
} catch {}

export function setAccessToken(token: string | null) {
  accessToken = token
  try {
    if (token) localStorage.setItem('kz_access_token', token)
    else localStorage.removeItem('kz_access_token')
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
  return memoryCsrfToken
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  const method = (init.method || 'GET').toUpperCase()
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = getCsrfToken()
    if (csrf) headers.set('X-CSRF-Token', csrf)
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
    if (response.status >= 500) {
      throw new Error('Our servers are currently down. Please check back in a few minutes.')
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
    throw new Error(message || `The request failed (${response.status}). Please try again.`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
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
export type SavedAddress = {
  id: string; label: string; house_number?: string; area?: string; road?: string
  landmark?: string; city?: string; pincode?: string; postal_code?: string; latitude?: number | null; longitude?: number | null; is_default?: boolean
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
  if (item.variations && item.variations.length > 0) {
    return Math.min(...item.variations.map((v) => v.price_paise))
  }
  return item.price_paise
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
  payment_method: string
  payment_status: string
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
export type Restaurant = {
  restaurant_name: string
  tagline: string
  phone: string
  phones?: string[]
  email?: string
  address: string
  latitude: number | null
  longitude: number | null
  weekly_schedule: Record<string, any>
  minimum_order_paise: number
  delivery_radius_km: number
  free_delivery_radius_km: number
  delivery_fee_per_km_paise: number
  charge_from_zero_beyond_free_radius?: boolean
  accepting_orders: boolean
  is_restaurant_open?: boolean
  is_delivery_open?: boolean
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
  distance_calculation_mode?: 'AUTO' | 'GOOGLE_MAPS' | 'HAVERSINE'
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

export function formatStatus(value: string) {
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

