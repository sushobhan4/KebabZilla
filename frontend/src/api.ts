export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

let accessToken: string | null = sessionStorage.getItem('kz_access_token')

export function setAccessToken(token: string | null) {
  accessToken = token
  if (token) sessionStorage.setItem('kz_access_token', token)
  else sessionStorage.removeItem('kz_access_token')
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers })
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
  is_active: boolean
  created_at: string
}
export type SavedAddress = {
  id: string; label: string; house_number?: string; area?: string; road?: string
  landmark?: string; city?: string; pincode?: string; postal_code?: string; latitude?: number | null; longitude?: number | null; is_default?: boolean
}
export type MenuItem = {
  id: number
  name: string
  description: string
  category: string
  price_paise: number
  discount_percent: number
  discounted_price_paise: number | null
  tax_percent: number
  image_url: string | null
  image_urls: string[]
  is_vegetarian: boolean
  is_available: boolean
  is_featured: boolean
  discount_campaign_name: string | null
  popularity_count: number
}
export type SavedCartItem = {
  menu_item_id: number
  quantity: number
}
export type Order = {
  id: number
  public_id: string
  customer_id: number | null
  customer_name: string
  customer_email: string
  customer_phone: string | null
  status: string
  order_type: string
  payment_method: string
  payment_status: string
  subtotal_paise: number
  tax_paise: number
  delivery_fee_paise: number
  total_paise: number
  address: string
  notes: string
  assigned_delivery_id: number | null
  scheduled_for?: string | null
  delivery_name?: string | null
  delivery_phone?: string | null
  created_at: string
  items: { id: number; menu_item_id: number | null; name: string; quantity: number; unit_price_paise: number; line_total_paise: number; tax_percent: number; tax_paise: number; image_url?: string | null; image_urls?: string[] }[]
  checkout?: { gateway_order_id: string; amount: number; currency: string; key_id: string; name: string; description: string; prefill: { name: string; email: string; contact: string } }
  delivery_otp?: string | null
}
export type Restaurant = {
  restaurant_name: string
  tagline: string
  phone: string
  address: string
  weekly_schedule: Record<string, { open: boolean; opens: string; closes: string }>
  tax_percent: number
  delivery_fee_paise: number
  minimum_order_paise: number
  delivery_radius_km: number
  accepting_orders: boolean
}

export const formatINR = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format((paise || 0) / 100)

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

