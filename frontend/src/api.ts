export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    })
  } catch {
    throw new Error('Can’t reach the KebabZilla server. Check that the API is running and try again.')
  }
  if (!response.ok) {
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
  price_paise: number
  base_price_paise?: number
  discount_percent: number
  discounted_price_paise: number | null
  image_url: string | null
  image_urls: string[]
  is_vegetarian: boolean
  is_available: boolean
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
  base_price_paise: number
  lowest_price_paise?: number
  image_url: string | null
  image_urls: string[]
  is_vegetarian: boolean
  is_available: boolean
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
  menu_item_id: number
  quantity: number
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
  address: string
  latitude: number | null
  longitude: number | null
  weekly_schedule: Record<string, any>
  minimum_order_paise: number
  delivery_radius_km: number
  free_delivery_radius_km: number
  delivery_fee_per_km_paise: number
  accepting_orders: boolean
  admin_override_open?: boolean
  distance_calculation_mode?: 'AUTO' | 'GOOGLE_MAPS' | 'HAVERSINE'
  enforce_driver_geofence?: boolean
  driver_geofence_meters?: number
  haversine_routing_factor?: number
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
  order: (Order & { round_trip_km?: number }) | null
  round_trip_km?: number
  clusters: {
    id: string
    route_label: string
    orders: Order[]
    round_trip_km?: number
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
