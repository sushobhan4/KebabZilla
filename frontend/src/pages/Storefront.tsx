import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Edit3, Flame, Leaf, ListFilter, MapPin, Phone, Plus, RotateCcw, ShieldCheck, ShoppingBag, Sparkles, Truck, Utensils, WifiOff, X, Search, Mail } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api, formatINR, formatSavedAddress, getCustomItemLowestPrice, getMenuItemLowestPrice, getItemDiscountedLowestPrice, resolveImageUrl, type CustomMenuItem, type CustomMenuSectionOption, type MenuItem, type MenuItemVariation, type Order, type Restaurant, type SavedCartItem } from '../api'
import { useAuth } from '../state'
import { Button, CenterDialog, EmptyState, Loading, Notice, QuantityPicker, RoundedSelect, RoundedTimePicker } from '../components'
import { launchCheckout, verifyRazorpayPayment } from '../payments'
import { liquidGlassManager } from '../vendor/liquidGlassManager'
import { usePreference } from '../cookies'

type CartLine = {
  item: MenuItem
  quantity: number
  customizations?: CustomMenuSectionOption[]
  variation_name?: string
  unit_price_paise?: number
  lineKey: string
  custom_menu_item_id?: number
}

const colors = ['food-red', 'food-gold', 'food-green', 'food-plum', 'food-orange', 'food-teal']
const art = ['🥙', '🍗', '🫓', '🍢', '🥘', '🍟']

const preloadedImageUrls = new Set<string>()

export function preloadMenuImages(items: MenuItem[]) {
  if (typeof window === 'undefined') return
  items.forEach((item) => {
    const urls: string[] = []
    if (item.image_url) urls.push(item.image_url)
    if (Array.isArray(item.image_urls)) {
      urls.push(...item.image_urls)
    }
    urls.forEach((url) => {
      const resolved = resolveImageUrl(url)
      if (resolved && !preloadedImageUrls.has(resolved)) {
        preloadedImageUrls.add(resolved)
        const img = new Image()
        img.src = resolved
      }
    })
  })
}

export default function Storefront() {
  const { account } = useAuth()
  const navigate = useNavigate()
  const [checkoutWarning, setCheckoutWarning] = useState<{
    tone?: 'warning' | 'danger' | 'info' | 'success'
    eyebrow?: string
    title: string
    description: string
    primaryAction: { label: string; variant?: 'primary' | 'secondary' | 'danger'; onClick: () => void }
    secondaryAction?: { label: string; variant?: 'primary' | 'secondary' | 'danger'; onClick: () => void }
  } | null>(null)
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [category, setCategory] = usePreference<string>('storefront_category', 'All')
  const [menuSearch, setMenuSearch] = useState('')
  const [menuSort, setMenuSort] = usePreference<'popular_desc' | 'popular_asc' | 'price_asc' | 'price_desc'>('storefront_menu_sort', 'popular_desc')
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const saved = localStorage.getItem('kz_active_cart')
      if (saved) return JSON.parse(saved) as CartLine[]
    } catch {}
    return []
  })

  useEffect(() => {
    liquidGlassManager.invalidateAll()
  }, [category, menuSearch, menuSort])

  useEffect(() => {
    liquidGlassManager.updateStuckState()
  }, [])
  const [activeDetailItem, setActiveDetailItem] = useState<MenuItem | null>(null)
  const [customizingModalItem, setCustomizingModalItem] = useState<MenuItem | null>(null)
  const [variationModalItem, setVariationModalItem] = useState<MenuItem | null>(null)
  const [repeatPromptItem, setRepeatPromptItem] = useState<MenuItem | null>(null)
  const [repeatVariationPromptItem, setRepeatVariationPromptItem] = useState<MenuItem | null>(null)
  const [activeVariationLineKey, setActiveVariationLineKey] = useState<string | null>(null)
  const [activeCustomLineKey, setActiveCustomLineKey] = useState<string | null>(null)
  const [selectedOptions, setSelectedOptions] = useState<Record<string, CustomMenuSectionOption>>({})
  const [selectedVariation, setSelectedVariation] = useState<MenuItemVariation | null>(null)
  const [modalQuantity, setModalQuantity] = useState(1)
  const [modalImageIndex, setModalImageIndex] = useState(0)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartExpanded, setCartExpanded] = useState(false)
  const [address, setAddress] = useState('')
  const [selectedAddress, setSelectedAddress] = useState('')
  const [addressInitializedFor, setAddressInitializedFor] = useState<number | null>(null)
  const [deliveryEstimate, setDeliveryEstimate] = useState<{
    distance_km: number
    method: string
    delivery_fee_paise: number
    delivery_fee_inr: number
    raw_delivery_fee_paise?: number
    raw_delivery_fee_inr?: number
    round_off_paise?: number
    round_off_inr?: number
    within_radius: boolean
    max_radius_km: number
    free_radius_km: number
    fee_per_km_paise: number
  } | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [notes, setNotes] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'RAZORPAY'>('RAZORPAY')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [serverDown, setServerDown] = useState(false)
  const [success, setSuccess] = useState<Order | null>(null)
  const cartSync = useRef<Promise<void>>(Promise.resolve())
  const cartDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestPendingCart = useRef<CartLine[] | null>(null)
  const cartRetractTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const totalItems = useMemo(() => cart.reduce((total, line) => total + line.quantity, 0), [cart])

  const [nowTimestamp, setNowTimestamp] = useState<number>(() => Date.now())
  const [cancelCountdownActive, setCancelCountdownActive] = useState(false)
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelOrderCountdown = useCallback(() => {
    if (cancelTimerRef.current) {
      clearTimeout(cancelTimerRef.current)
      cancelTimerRef.current = null
    }
    setCancelCountdownActive(false)
  }, [])

  useEffect(() => {
    return () => {
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (cancelCountdownActive) {
      cancelOrderCountdown()
    }
  }, [paymentMethod, cart.length, cancelOrderCountdown])

  useEffect(() => {
    const timer = setInterval(() => setNowTimestamp(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  const isRestaurantOpen = restaurant === null ? true : (restaurant.is_restaurant_open ?? restaurant.accepting_orders ?? true)
  const isDeliveryOpen = restaurant === null ? true : (restaurant.is_delivery_open ?? restaurant.accepting_orders ?? true)

  const dynamicMinutesUntilClose = useMemo(() => {
    if (restaurant?.closing_time) {
      const closeTime = new Date(restaurant.closing_time).getTime()
      const diffMs = closeTime - nowTimestamp
      if (diffMs <= 0) return 0
      return Math.max(1, Math.round(diffMs / 60000))
    }
    if (restaurant?.closing_in_minutes !== undefined && restaurant?.closing_in_minutes !== null) {
      return restaurant.closing_in_minutes
    }
    if (restaurant?.weekly_schedule) {
      const now = new Date(nowTimestamp)
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const todayName = days[now.getDay()]
      const sched = restaurant.weekly_schedule
      let closeStr: string | null = null
      if (Array.isArray(sched.custom_schedules) && sched.custom_schedules.length > 0) {
        const match = sched.custom_schedules.find((s: any) => s.days?.includes(todayName))
        if (match?.end_time) closeStr = match.end_time
      } else if (sched[todayName]?.open && sched[todayName]?.closes) {
        closeStr = sched[todayName].closes
      }
      if (closeStr) {
        const [ch, cm] = closeStr.split(':').map(Number)
        const closeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ch, cm, 0)
        const diffMs = closeDate.getTime() - nowTimestamp
        if (diffMs > 0) {
          return Math.max(1, Math.round(diffMs / 60000))
        }
      }
    }
    return null
  }, [restaurant?.closing_time, restaurant?.closing_in_minutes, restaurant?.weekly_schedule, nowTimestamp])

  const cutoffMinutes = restaurant?.order_cutoff_minutes_before_closing ?? 30

  const dynamicMinutesUntilCutoff = useMemo(() => {
    if (dynamicMinutesUntilClose === null) return restaurant?.cutoff_in_minutes ?? null
    return Math.max(0, dynamicMinutesUntilClose - cutoffMinutes)
  }, [dynamicMinutesUntilClose, cutoffMinutes, restaurant?.cutoff_in_minutes])

  const isPastCutoff = useMemo(() => {
    if (restaurant?.delivery_status === 'DELIVERY_CUTOFF') return true
    if (restaurant?.delivery_status === 'CLOSING_SOON') return false
    if (isRestaurantOpen && dynamicMinutesUntilClose !== null) {
      return dynamicMinutesUntilClose <= cutoffMinutes
    }
    return false
  }, [restaurant?.delivery_status, isRestaurantOpen, dynamicMinutesUntilClose, cutoffMinutes])

  const isApproachingClosing = useMemo(() => {
    if (restaurant?.delivery_status === 'CLOSING_SOON') return true
    if (isRestaurantOpen && isDeliveryOpen && dynamicMinutesUntilCutoff !== null && !isPastCutoff) {
      return dynamicMinutesUntilCutoff <= 30
    }
    return false
  }, [restaurant?.delivery_status, isRestaurantOpen, isDeliveryOpen, dynamicMinutesUntilCutoff, isPastCutoff])

  const effectiveDeliveryOpen = isDeliveryOpen && !isPastCutoff
  const orderingClosed = restaurant !== null && (!isRestaurantOpen || !effectiveDeliveryOpen)

  const menuHeading = useMemo(() => {
    if (serverDown) return 'Menu temporarily unavailable'
    if (restaurant === null) return 'Menu'
    if (!isRestaurantOpen) return 'Sorry, we are closed'
    if (!effectiveDeliveryOpen) {
      const customReason = (restaurant.delivery_paused_reason || (restaurant.weekly_schedule?.delivery_paused_reason) || restaurant.delivery_status_heading || '').trim()
      return customReason || 'Delivery is currently unavailable'
    }
    if (isApproachingClosing) return 'Hurry up closing soon'
    return restaurant.delivery_status_heading || 'Menu'
  }, [serverDown, restaurant, isRestaurantOpen, effectiveDeliveryOpen, isApproachingClosing])

  const menuSubtitle = useMemo(() => {
    if (serverDown) return 'Our servers are currently down. Please check back in a few minutes.'
    if (restaurant === null) return "Choose what you’d like to order."
    if (!isRestaurantOpen) return 'Our shop is currently closed. Please check back during operating hours.'
    if (!effectiveDeliveryOpen) {
      if (dynamicMinutesUntilClose !== null && dynamicMinutesUntilClose > 0 && dynamicMinutesUntilClose <= 59) {
        return `Our shop is open! We are currently only accepting walk-in orders at our counter. The restaurant is closing in ${dynamicMinutesUntilClose} minutes.`
      }
      return 'Our shop is open! We are currently only accepting walk-in orders at our counter.'
    }
    if (isApproachingClosing) {
      const mins = (dynamicMinutesUntilCutoff !== null && dynamicMinutesUntilCutoff > 0)
        ? dynamicMinutesUntilCutoff
        : (restaurant.cutoff_in_minutes ?? (dynamicMinutesUntilClose !== null ? Math.max(1, dynamicMinutesUntilClose - cutoffMinutes) : 15))
      return `The restaurant is closing in ${mins} minutes.`
    }
    return restaurant.delivery_status_message || "Choose what you’d like to order."
  }, [serverDown, restaurant, isRestaurantOpen, effectiveDeliveryOpen, isApproachingClosing, dynamicMinutesUntilCutoff, dynamicMinutesUntilClose, cutoffMinutes])

  // Permissible opening hour slots for today only (15-min intervals)
  const permissibleTimeSlots = useMemo(() => {
    if (!restaurant) return []
    const schedule = restaurant.weekly_schedule || {}
    const now = new Date()
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const todayName = days[now.getDay()]

    type Window = { startMin: number; endMin: number }
    const windows: Window[] = []

    const customSchedules = schedule.custom_schedules
    if (Array.isArray(customSchedules) && customSchedules.length > 0) {
      for (const s of customSchedules) {
        if (s.days?.includes(todayName)) {
          const [sh, sm] = (s.start_time || '10:00').split(':').map(Number)
          const [eh, em] = (s.end_time || '22:00').split(':').map(Number)
          windows.push({ startMin: sh * 60 + sm, endMin: eh * 60 + em })
        }
      }
    } else if (schedule[todayName]?.open) {
      const [sh, sm] = (schedule[todayName].opens || '10:00').split(':').map(Number)
      const [eh, em] = (schedule[todayName].closes || '22:00').split(':').map(Number)
      windows.push({ startMin: sh * 60 + sm, endMin: eh * 60 + em })
    }

    if (windows.length === 0) return []

    // Earliest orderable time: at least 30 minutes from right now
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const minLeadMinutes = nowMinutes + 30

    const slots: { value: string; label: string }[] = []
    for (let totalMin = 0; totalMin < 24 * 60; totalMin += 15) {
      if (totalMin < minLeadMinutes) continue

      const inWindow = windows.some((w) => {
        if (w.startMin <= w.endMin) {
          return totalMin >= w.startMin && totalMin <= w.endMin
        }
        return totalMin >= w.startMin || totalMin <= w.endMin
      })

      if (inWindow) {
        const h = Math.floor(totalMin / 60)
        const m = totalMin % 60
        const padH = String(h).padStart(2, '0')
        const padM = String(m).padStart(2, '0')
        const ampm = h >= 12 ? 'PM' : 'AM'
        const displayH = h % 12 === 0 ? 12 : h % 12
        const label = `${String(displayH).padStart(2, '0')}:${padM} ${ampm}`
        slots.push({ value: `${padH}:${padM}`, label })
      }
    }
    return slots
  }, [restaurant])

  const permissibleHours = useMemo(() => {
    return Array.from(new Set(permissibleTimeSlots.map((s) => s.value.slice(0, 2))))
  }, [permissibleTimeSlots])

  useEffect(() => {
    if (!totalItems) setCartOpen(false)
  }, [totalItems])

  useEffect(() => () => { if (cartRetractTimer.current) clearTimeout(cartRetractTimer.current) }, [])

  function revealCartSummary() {
    setCartExpanded(true)
    if (cartRetractTimer.current) clearTimeout(cartRetractTimer.current)
    cartRetractTimer.current = setTimeout(() => setCartExpanded(false), 5000)
  }

  const priceFor = (item: MenuItem) => getItemDiscountedLowestPrice(item)

  const flushCartToBackend = useCallback((cartToSync?: CartLine[]) => {
    if (cartDebounceTimer.current) {
      clearTimeout(cartDebounceTimer.current)
      cartDebounceTimer.current = null
    }

    const targetCart = cartToSync !== undefined ? cartToSync : latestPendingCart.current
    latestPendingCart.current = null

    if (!account) return

    cartSync.current = cartSync.current.catch(() => undefined).then(async () => {
      const payload = (targetCart || []).map((line) => ({
        menu_id: line.item.id,
        variation_name: line.variation_name || null,
        quantity: line.quantity,
        unit_price_paise: line.unit_price_paise ?? priceFor(line.item),
        customizations: line.customizations || [],
      }))
      await api<SavedCartItem[]>('/cart', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    }).catch((err) => setError(err instanceof Error ? err.message : 'Could not save your cart.'))
  }, [account?.id])

  const persistCart = useCallback((nextCart: CartLine[], immediate = false) => {
    try {
      if (nextCart.length > 0) {
        localStorage.setItem('kz_active_cart', JSON.stringify(nextCart))
      } else {
        localStorage.removeItem('kz_active_cart')
      }
    } catch {}

    if (!account) return

    latestPendingCart.current = nextCart

    if (cartDebounceTimer.current) {
      clearTimeout(cartDebounceTimer.current)
      cartDebounceTimer.current = null
    }

    if (immediate || nextCart.length === 0) {
      flushCartToBackend(nextCart)
    } else {
      cartDebounceTimer.current = setTimeout(() => {
        flushCartToBackend()
      }, 3000)
    }
  }, [account?.id, flushCartToBackend])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && latestPendingCart.current) {
        flushCartToBackend()
      }
    }
    const handleBeforeUnload = () => {
      if (latestPendingCart.current) {
        flushCartToBackend()
      }
    }

    window.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (cartDebounceTimer.current) {
        clearTimeout(cartDebounceTimer.current)
      }
      if (latestPendingCart.current) {
        flushCartToBackend()
      }
    }
  }, [flushCartToBackend])

  const cartLinesFromSaved = useCallback((saved: SavedCartItem[], availableMenu: MenuItem[]): CartLine[] => {
    if (!availableMenu.length) return []
    return saved.flatMap((savedItem) => {
      const itemId = savedItem.menu_id || savedItem.menu_item_id
      if (!itemId) return []
      const item = availableMenu.find((m) => m.id === itemId)
      if (!item || !item.is_available) return []

      const customizations = savedItem.customizations || []
      const unitPrice = savedItem.unit_price_paise ?? priceFor(item)
      const lineKey = customizations.length > 0
        ? `custom-${item.id}-${customizations.map((o) => `${o.name}:${o.extra_paise}`).sort().join('|')}`
        : savedItem.variation_name
          ? `${item.id}-${savedItem.variation_name}`
          : String(item.id)

      return [{
        item,
        quantity: savedItem.quantity,
        customizations,
        variation_name: savedItem.variation_name || undefined,
        unit_price_paise: unitPrice,
        lineKey,
        custom_menu_item_id: item.is_custom ? item.id : undefined,
      }]
    })
  }, [])

  const loadStore = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([
      api<MenuItem[]>('/menu'),
      api<CustomMenuItem[]>('/custom-menu'),
      api<Restaurant>('/restaurant'),
    ]).then(([items, customItems, config]) => {
      setServerDown(false)
      const mappedCustom: MenuItem[] = (customItems || []).map((ci) => {
        const lowestPaise = getCustomItemLowestPrice(ci)
        const discPercent = (ci as any).discount_percent || 0
        const discPricePaise = (ci as any).discounted_base_price_paise || null
        const itemCats = ci.categories && ci.categories.length > 0
          ? ci.categories
          : (ci.category ? [ci.category] : ['Specialty Rolls'])
        return {
          id: ci.id,
          name: ci.name,
          description: ci.description,
          category: itemCats[0] || 'Specialty Rolls',
          categories: itemCats,
          category_id: ci.category_id || null,
          category_ids: ci.category_ids || (ci.category_id ? [ci.category_id] : []),
          price_paise: lowestPaise,
          base_price_paise: ci.base_price_paise,
          discount_percent: discPercent,
          discounted_price_paise: discPercent ? Math.max(1, Math.round((lowestPaise * (100 - discPercent)) / 100)) : discPricePaise,
          image_url: ci.image_urls?.[0] || ci.image_url || null,
          image_urls: ci.image_urls || [],
          is_vegetarian: ci.is_vegetarian,
          is_available: ci.is_available,
          is_paused: ci.is_paused,
          is_featured: ci.is_featured,
          variations: [],
          is_custom: true,
          custom_menu_item_id: ci.id,
          custom_sections: ci.sections,
          discount_campaign_name: (ci as any).discount_campaign_name || null,
          popularity_count: (ci as any).popularity_count || 0,
        }
      })
      const fullMenu = [...items, ...mappedCustom]
      setMenu(fullMenu)
      setRestaurant(config)
      preloadMenuImages(fullMenu)

      if (account) {
        api<SavedCartItem[]>('/cart').then((saved) => {
          if (saved.length > 0) {
            const restored = cartLinesFromSaved(saved, fullMenu)
            setCart(restored)
            try {
              localStorage.setItem('kz_active_cart', JSON.stringify(restored))
            } catch {}
          } else {
            try {
              const local = localStorage.getItem('kz_active_cart')
              if (local) {
                const parsed = JSON.parse(local) as CartLine[]
                if (parsed.length > 0) {
                  setCart(parsed)
                  persistCart(parsed)
                }
              }
            } catch {}
          }
        }).catch(() => undefined)
      }
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Our servers are currently down. Please check back in a few minutes.'
      setError(msg)
      setServerDown(true)
    }).finally(() => setLoading(false))
  }, [account, cartLinesFromSaved, persistCart])

  useEffect(() => {
    loadStore()
  }, [loadStore])

  useEffect(() => {
    if (account && menu.length > 0) {
      api<SavedCartItem[]>('/cart').then((saved) => {
        if (saved.length > 0) {
          const restored = cartLinesFromSaved(saved, menu)
          setCart(restored)
          try {
            localStorage.setItem('kz_active_cart', JSON.stringify(restored))
          } catch {}
        } else {
          try {
            const local = localStorage.getItem('kz_active_cart')
            if (local) {
              const parsed = JSON.parse(local) as CartLine[]
              if (parsed.length > 0) {
                setCart(parsed)
                persistCart(parsed)
              }
            }
          } catch {}
        }
      }).catch((err) => setError(err instanceof Error ? err.message : 'Could not restore your saved cart.'))
    }
  }, [account?.id, menu, cartLinesFromSaved, persistCart])

  useEffect(() => {
    if (!account || addressInitializedFor === account.id) return
    const saved = account.addresses?.find((item) => item.is_default && formatSavedAddress(item))
    if (saved) {
      setSelectedAddress(saved.id)
      setAddress(formatSavedAddress(saved))
    }
    setAddressInitializedFor(account.id)
  }, [account, addressInitializedFor])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const item of menu) {
      if (item.categories && item.categories.length > 0) {
        item.categories.forEach((c) => { if (c) set.add(c) })
      } else if (item.category) {
        set.add(item.category)
      }
    }
    return ['All', ...set]
  }, [menu])
  const visibleMenu = useMemo(() => {
    const query = menuSearch.trim().toLocaleLowerCase()
    return menu.filter((item) => {
      const itemCats = item.categories && item.categories.length > 0 ? item.categories : (item.category ? [item.category] : [])
      const matchesCategory = category === 'All' || itemCats.includes(category)
      const matchesQuery = !query || `${item.name} ${item.description} ${itemCats.join(' ')}`.toLocaleLowerCase().includes(query)
      return matchesCategory && matchesQuery
    })
      .sort((a, b) => menuSort === 'popular_desc' ? b.popularity_count - a.popularity_count : menuSort === 'popular_asc' ? a.popularity_count - b.popularity_count : menuSort === 'price_asc' ? priceFor(a) - priceFor(b) : priceFor(b) - priceFor(a))
  }, [category, menu, menuSearch, menuSort])

  const isLineUnavailable = useCallback((line: CartLine): boolean => {
    if (loading || menu.length === 0) return false
    const current = menu.find((m) => m.id === line.item.id && Boolean(m.is_custom) === Boolean(line.item.is_custom))
    if (!current) return true
    if (!current.is_available) return true
    if (current.is_paused) return true
    if (line.variation_name && current.variations && current.variations.length > 0) {
      const vMatch = current.variations.find((v) => v.name.toLowerCase() === line.variation_name?.toLowerCase())
      if (!vMatch) return true
    }
    return false
  }, [menu, loading])

  const validCartLines = useMemo(() => cart.filter((line) => !isLineUnavailable(line)), [cart, isLineUnavailable])
  const validItemsCount = useMemo(() => validCartLines.reduce((sum, line) => sum + line.quantity, 0), [validCartLines])
  const hasUnavailableItems = useMemo(() => cart.some((line) => isLineUnavailable(line)), [cart, isLineUnavailable])

  const rawSubtotal = useMemo(() => validCartLines.reduce((total, line) => {
    const unitPrice = line.unit_price_paise ?? priceFor(line.item)
    return total + unitPrice * line.quantity
  }, 0), [validCartLines])

  const isFreeDeliveryByThreshold = Boolean(
    restaurant?.free_delivery_threshold_paise &&
    restaurant.free_delivery_threshold_paise > 0 &&
    rawSubtotal >= restaurant.free_delivery_threshold_paise
  )

  const selectedLocation = useMemo(() => {
    if (!account?.addresses || !selectedAddress) return null
    return account.addresses.find((item) => item.id === selectedAddress) || null
  }, [account?.addresses, selectedAddress])

  useEffect(() => {
    if (!selectedLocation || selectedLocation.latitude == null || selectedLocation.longitude == null) {
      setDeliveryEstimate(null)
      return
    }

    if (selectedLocation.distance_meters != null && restaurant) {
      const distKm = selectedLocation.distance_meters / 1000
      const withinRadius = distKm <= restaurant.delivery_radius_km
      let feePaise = 0
      let rawFeePaise = 0
      let roundOffPaise = 0
      if (
        restaurant.free_delivery_threshold_paise &&
        restaurant.free_delivery_threshold_paise > 0 &&
        rawSubtotal >= restaurant.free_delivery_threshold_paise
      ) {
        feePaise = 0
        rawFeePaise = 0
        roundOffPaise = 0
      } else if (distKm > restaurant.free_delivery_radius_km) {
        const billableKm = restaurant.charge_from_zero_beyond_free_radius
          ? distKm
          : distKm - restaurant.free_delivery_radius_km
        const rawFeeInr = Math.round(billableKm * (restaurant.delivery_fee_per_km_paise / 100) * 100) / 100
        const roundedFeeInr = Math.ceil(rawFeeInr)
        roundOffPaise = Math.round((roundedFeeInr - rawFeeInr) * 100)
        rawFeePaise = Math.round(rawFeeInr * 100)
        feePaise = roundedFeeInr * 100
      }
      setDeliveryEstimate({
        distance_km: Math.round(distKm * 100) / 100,
        method: 'STORED_DISTANCE',
        delivery_fee_paise: feePaise,
        delivery_fee_inr: feePaise / 100,
        raw_delivery_fee_paise: rawFeePaise,
        round_off_paise: roundOffPaise,
        within_radius: withinRadius,
        max_radius_km: restaurant.delivery_radius_km,
        free_radius_km: restaurant.free_delivery_radius_km,
        fee_per_km_paise: restaurant.delivery_fee_per_km_paise,
      })
      setEstimateLoading(false)
      return
    }

    let cancelled = false
    setEstimateLoading(true)
    api<{
      distance_km: number
      method: string
      delivery_fee_paise: number
      delivery_fee_inr: number
      raw_delivery_fee_inr?: number
      raw_delivery_fee_paise?: number
      round_off_inr?: number
      round_off_paise?: number
      within_radius: boolean
      max_radius_km: number
      free_radius_km: number
      fee_per_km_paise: number
      is_free_by_threshold?: boolean
    }>(`/restaurant/delivery-estimate?latitude=${selectedLocation.latitude}&longitude=${selectedLocation.longitude}&subtotal=${rawSubtotal}`)
      .then((data) => {
        if (!cancelled) setDeliveryEstimate(data)
      })
      .catch(() => {
        if (
          !cancelled &&
          restaurant &&
          selectedLocation.latitude != null &&
          selectedLocation.longitude != null &&
          restaurant.latitude != null &&
          restaurant.longitude != null
        ) {
          const earthRadiusKm = 6371.0
          const dLat = ((selectedLocation.latitude - restaurant.latitude) * Math.PI) / 180
          const dLng = ((selectedLocation.longitude - restaurant.longitude) * Math.PI) / 180
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((restaurant.latitude * Math.PI) / 180) *
              Math.cos((selectedLocation.latitude * Math.PI) / 180) *
              Math.sin(dLng / 2) ** 2
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
          const factor = restaurant.haversine_routing_factor || 1.3
          const distKm = earthRadiusKm * c * factor
          const withinRadius = distKm <= restaurant.delivery_radius_km
          let feePaise = 0
          let rawFeePaise = 0
          let roundOffPaise = 0
          if (
            restaurant.free_delivery_threshold_paise &&
            restaurant.free_delivery_threshold_paise > 0 &&
            rawSubtotal >= restaurant.free_delivery_threshold_paise
          ) {
            feePaise = 0
            rawFeePaise = 0
            roundOffPaise = 0
          } else if (distKm > restaurant.free_delivery_radius_km) {
            const billableKm = restaurant.charge_from_zero_beyond_free_radius
              ? distKm
              : distKm - restaurant.free_delivery_radius_km
            const rawFeeInr = Math.round(billableKm * (restaurant.delivery_fee_per_km_paise / 100) * 100) / 100
            const roundedFeeInr = Math.ceil(rawFeeInr)
            roundOffPaise = Math.round((roundedFeeInr - rawFeeInr) * 100)
            rawFeePaise = Math.round(rawFeeInr * 100)
            feePaise = roundedFeeInr * 100
          }
          setDeliveryEstimate({
            distance_km: Math.round(distKm * 100) / 100,
            method: 'HAVERSINE',
            delivery_fee_paise: feePaise,
            delivery_fee_inr: feePaise / 100,
            raw_delivery_fee_paise: rawFeePaise,
            round_off_paise: roundOffPaise,
            within_radius: withinRadius,
            max_radius_km: restaurant.delivery_radius_km,
            free_radius_km: restaurant.free_delivery_radius_km,
            fee_per_km_paise: restaurant.delivery_fee_per_km_paise,
          })
        }
      })
      .finally(() => {
        if (!cancelled) setEstimateLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedLocation, restaurant, rawSubtotal])

  const deliveryFee = deliveryEstimate
    ? (isFreeDeliveryByThreshold ? 0 : (deliveryEstimate.raw_delivery_fee_paise ?? deliveryEstimate.delivery_fee_paise))
    : 0

  const rawPayable = rawSubtotal + deliveryFee
  const roundedPayableInr = Math.round(rawPayable / 100)
  const payable = roundedPayableInr * 100
  const roundOffPaise = payable - rawPayable
  const subtotal = rawSubtotal

  function getLastCustomization(itemId: number): { itemId: number; itemName: string; options: CustomMenuSectionOption[]; unit_price_paise: number } | null {
    try {
      const raw = localStorage.getItem(`kz_last_custom_c_${itemId}`) || localStorage.getItem(`kz_last_custom_${itemId}`)
      if (raw) return JSON.parse(raw)
    } catch (e) {
      // ignore
    }
    const line = cart.slice().reverse().find((l) => l.item.id === itemId && Boolean(l.item.is_custom) && l.customizations?.length)
    if (line && line.customizations) {
      return {
        itemId,
        itemName: line.item.name,
        options: line.customizations,
        unit_price_paise: line.unit_price_paise ?? priceFor(line.item),
      }
    }
    return null
  }

  function applyCustomToCart(item: MenuItem, options: CustomMenuSectionOption[], qty: number, replaceKey?: string | null) {
    if (orderingClosed || item.is_paused) return
    const discount = item.discount_percent || 0
    const base = item.base_price_paise ?? 0
    const extra = options.reduce((sum, opt) => sum + (opt?.extra_paise || 0), 0)
    const rawTotal = base + extra
    const unitPrice = discount ? Math.round((rawTotal * (100 - discount)) / 100) : rawTotal
    const key = `custom-${item.id}-${options.map((o) => `${o.name}:${o.extra_paise}`).sort().join('|')}`

    try {
      localStorage.setItem(
        `kz_last_custom_c_${item.id}`,
        JSON.stringify({ itemId: item.id, itemName: item.name, options, unit_price_paise: unitPrice }),
      )
    } catch (e) {
      // ignore
    }

    setCart((old) => {
      let next: CartLine[]
      if (qty <= 0) {
        next = old.filter((l) => l.lineKey !== (replaceKey || key))
      } else if (replaceKey) {
        const withoutOld = old.filter((l) => l.lineKey !== replaceKey)
        const existing = withoutOld.find((l) => l.lineKey === key)
        if (existing) {
          next = withoutOld.map((l) => l.lineKey === key ? { ...l, quantity: l.quantity + qty } : l)
        } else {
          next = old.map((l) => l.lineKey === replaceKey ? { ...l, lineKey: key, customizations: options, unit_price_paise: unitPrice, quantity: qty } : l)
        }
      } else {
        const existing = old.find((l) => l.lineKey === key)
        if (existing) {
          next = old.map((l) => l.lineKey === key ? { ...l, quantity: qty } : l)
        } else {
          next = [
            ...old,
            { item, quantity: qty, customizations: options, unit_price_paise: unitPrice, lineKey: key, custom_menu_item_id: item.custom_menu_item_id || item.id },
          ]
        }
      }
      persistCart(next)
      return next
    })
    revealCartSummary()
  }

  function openCustomizationModal(item: MenuItem, existingLine?: CartLine) {
    setCustomizingModalItem(item)
    setError('')
    const initial: Record<string, CustomMenuSectionOption> = {}
    if (existingLine) {
      for (const sec of item.custom_sections || []) {
        const found = sec.options.find((opt) =>
          existingLine.customizations?.some((c) => c.name === opt.name),
        )
        if (found) {
          initial[sec.name] = found
        } else if (sec.required !== false && sec.options && sec.options.length > 0) {
          initial[sec.name] = sec.options[0]
        }
      }
    } else {
      for (const sec of item.custom_sections || []) {
        if (sec.required !== false && sec.options && sec.options.length > 0) {
          initial[sec.name] = sec.options[0]
        }
      }
    }
    setSelectedOptions(initial)
    setModalQuantity(existingLine ? existingLine.quantity : 1)
    setActiveCustomLineKey(existingLine ? existingLine.lineKey : null)
  }

  function onSelectCustomOption(sectionName: string, opt: CustomMenuSectionOption, isSelected: boolean, isRequired: boolean) {
    if (!customizingModalItem) return
    let nextOptions: Record<string, CustomMenuSectionOption>
    if (isSelected && !isRequired) {
      nextOptions = { ...selectedOptions }
      delete nextOptions[sectionName]
    } else {
      nextOptions = { ...selectedOptions, [sectionName]: opt }
    }
    setSelectedOptions(nextOptions)
  }

  function confirmCustomItemAdd() {
    if (!customizingModalItem) return
    for (const sec of customizingModalItem.custom_sections || []) {
      if (sec.required !== false && (!selectedOptions[sec.name] || !selectedOptions[sec.name].name)) {
        setError(`Please select an option for ${sec.name}`)
        return
      }
    }
    const optionsList = Object.values(selectedOptions).filter(Boolean)
    applyCustomToCart(customizingModalItem, optionsList, modalQuantity || 1, activeCustomLineKey)
    setCustomizingModalItem(null)
    setActiveCustomLineKey(null)
    setError('')
  }

  function handleCustomItemAddOrIncrement(item: MenuItem) {
    if (orderingClosed || item.is_paused) return
    const currentQty = quantityFor(item.id, Boolean(item.is_custom))
    if (currentQty > 0) {
      setRepeatPromptItem(item)
      return
    }
    setActiveDetailItem(null)
    openCustomizationModal(item)
  }

  function repeatLastCustomization(item: MenuItem) {
    if (orderingClosed || item.is_paused) return
    const saved = getLastCustomization(item.id)
    if (!saved) {
      openCustomizationModal(item)
      return
    }
    const key = `custom-${item.id}-${saved.options.map((o) => `${o.name}:${o.extra_paise}`).sort().join('|')}`
    setCart((old) => {
      let next: CartLine[]
      const found = old.find((l) => l.lineKey === key)
      if (found) {
        next = old.map((l) => l.lineKey === key ? { ...l, quantity: l.quantity + 1 } : l)
      } else {
        next = [
          ...old,
          {
            item,
            quantity: 1,
            customizations: saved.options,
            unit_price_paise: saved.unit_price_paise,
            lineKey: key,
            custom_menu_item_id: item.custom_menu_item_id || item.id,
          },
        ]
      }
      persistCart(next)
      return next
    })
    revealCartSummary()
  }

  function decrementCustomItem(item: MenuItem) {
    const lines = cart.filter((l) => l.item.id === item.id)
    if (lines.length > 1) {
      setActiveDetailItem(null)
      setCartOpen(true)
      return
    }
    setCart((old) => {
      const currentLines = old.filter((l) => l.item.id === item.id && Boolean(l.item.is_custom))
      if (!currentLines.length) return old
      const targetLine = currentLines[0]
      let next: CartLine[]
      if (targetLine.quantity > 1) {
        next = old.map((l) => l.lineKey === targetLine.lineKey ? { ...l, quantity: l.quantity - 1 } : l)
      } else {
        next = old.filter((l) => l.lineKey !== targetLine.lineKey)
      }
      persistCart(next)
      return next
    })
  }

  function openDetailModal(item: MenuItem, existingLine?: CartLine) {
    setActiveDetailItem(item)
    setModalImageIndex(0)
    setError('')
    const existingQty = existingLine ? existingLine.quantity : (quantityFor(item.id, Boolean(item.is_custom)) || 1)
    setModalQuantity(existingQty)
  }

  function getLastVariation(itemId: number): { itemId: number; itemName: string; variation: MenuItemVariation; unit_price_paise: number } | null {
    try {
      const raw = localStorage.getItem(`kz_last_variation_m_${itemId}`) || localStorage.getItem(`kz_last_variation_${itemId}`)
      if (raw) return JSON.parse(raw)
    } catch (e) {
      // ignore
    }
    const line = cart.slice().reverse().find((l) => l.item.id === itemId && !l.item.is_custom && l.variation_name)
    if (line && line.variation_name && line.item.variations) {
      const v = line.item.variations.find((v) => v.name.toLowerCase() === line.variation_name?.toLowerCase())
      if (v) {
        return {
          itemId,
          itemName: line.item.name,
          variation: v,
          unit_price_paise: line.unit_price_paise ?? v.price_paise,
        }
      }
    }
    return null
  }

  function applyVariationToCart(item: MenuItem, variation: MenuItemVariation, qty: number, replaceKey?: string | null) {
    if (orderingClosed || item.is_paused) return
    const disc = item.discount_percent || 0
    const unitPrice = disc ? Math.round((variation.price_paise * (100 - disc)) / 100) : variation.price_paise
    const key = `${item.id}-${variation.name}`

    try {
      localStorage.setItem(
        `kz_last_variation_m_${item.id}`,
        JSON.stringify({
          itemId: item.id,
          itemName: item.name,
          variation,
          unit_price_paise: unitPrice,
        }),
      )
    } catch (e) {
      // ignore
    }

    setCart((old) => {
      let next: CartLine[]
      if (qty <= 0) {
        next = old.filter((l) => l.lineKey !== (replaceKey || key))
      } else if (replaceKey) {
        const withoutOld = old.filter((l) => l.lineKey !== replaceKey)
        const existing = withoutOld.find((l) => l.lineKey === key)
        if (existing) {
          next = withoutOld.map((l) => (l.lineKey === key ? { ...l, quantity: l.quantity + qty } : l))
        } else {
          next = old.map((l) =>
            l.lineKey === replaceKey
              ? {
                  ...l,
                  lineKey: key,
                  variation_name: variation.name,
                  unit_price_paise: unitPrice,
                  quantity: qty,
                }
              : l,
          )
        }
      } else {
        const existing = old.find((l) => l.lineKey === key)
        if (existing) {
          next = old.map((l) => (l.lineKey === key ? { ...l, quantity: qty } : l))
        } else {
          next = [
            ...old,
            {
              item,
              quantity: qty,
              variation_name: variation.name,
              unit_price_paise: unitPrice,
              lineKey: key,
            },
          ]
        }
      }
      persistCart(next)
      return next
    })
    revealCartSummary()
  }

  function handleVariationItemAddOrIncrement(item: MenuItem) {
    if (orderingClosed || item.is_paused) return
    const currentQty = quantityFor(item.id, Boolean(item.is_custom))
    if (currentQty > 0) {
      setRepeatVariationPromptItem(item)
      return
    }
    setActiveDetailItem(null)
    openVariationModal(item)
  }

  function repeatLastVariation(item: MenuItem) {
    if (orderingClosed || item.is_paused) return
    const saved = getLastVariation(item.id)
    if (!saved) {
      openVariationModal(item)
      return
    }
    const variation = saved.variation
    const lineKey = `${item.id}-${variation.name}`
    const disc = item.discount_percent || 0
    const unitPrice = disc ? Math.round((variation.price_paise * (100 - disc)) / 100) : variation.price_paise
    setCart((old) => {
      let next: CartLine[]
      const found = old.find((l) => l.lineKey === lineKey)
      if (found) {
        next = old.map((l) => (l.lineKey === lineKey ? { ...l, quantity: l.quantity + 1 } : l))
      } else {
        next = [
          ...old,
          {
            item,
            quantity: 1,
            variation_name: variation.name,
            unit_price_paise: unitPrice,
            lineKey,
          },
        ]
      }
      persistCart(next)
      return next
    })
    revealCartSummary()
  }

  function decrementVariationItem(item: MenuItem) {
    const lines = cart.filter((l) => l.item.id === item.id)
    if (lines.length > 1) {
      setActiveDetailItem(null)
      setCartOpen(true)
      return
    }
    setCart((old) => {
      const currentLines = old.filter((l) => l.item.id === item.id && !l.item.is_custom)
      if (!currentLines.length) return old
      const targetLine = currentLines[0]
      let next: CartLine[]
      if (targetLine.quantity > 1) {
        next = old.map((l) => (l.lineKey === targetLine.lineKey ? { ...l, quantity: l.quantity - 1 } : l))
      } else {
        next = old.filter((l) => l.lineKey !== targetLine.lineKey)
      }
      persistCart(next)
      return next
    })
  }

  function openVariationModal(item: MenuItem, existingLine?: CartLine) {
    setVariationModalItem(item)
    const matched = existingLine
      ? item.variations?.find((v) => v.name.toLowerCase() === existingLine.variation_name?.toLowerCase())
      : null
    const chosenVar = matched || item.variations?.[0] || null
    setSelectedVariation(chosenVar)
    setModalQuantity(existingLine ? existingLine.quantity : 1)
    setActiveVariationLineKey(existingLine ? existingLine.lineKey : null)
    setError('')
  }

  function onSelectVariation(variation: MenuItemVariation) {
    if (!variationModalItem) return
    setSelectedVariation(variation)
  }

  function confirmVariationAdd() {
    if (!variationModalItem) return
    if (!selectedVariation) {
      setError('Please choose a portion')
      return
    }
    applyVariationToCart(variationModalItem, selectedVariation, modalQuantity || 1, activeVariationLineKey)
    setVariationModalItem(null)
    setActiveVariationLineKey(null)
    setError('')
  }

  const detailImages = useMemo(() => {
    if (!activeDetailItem) return []
    const raw = activeDetailItem.image_urls?.length
      ? activeDetailItem.image_urls
      : activeDetailItem.image_url
        ? [activeDetailItem.image_url]
        : []
    return raw.filter(Boolean).map(resolveImageUrl)
  }, [activeDetailItem])

  useEffect(() => {
    if (!activeDetailItem && !customizingModalItem && !variationModalItem && !repeatPromptItem && !repeatVariationPromptItem) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (repeatPromptItem) {
          setRepeatPromptItem(null)
        } else if (repeatVariationPromptItem) {
          setRepeatVariationPromptItem(null)
        } else if (customizingModalItem) {
          setCustomizingModalItem(null)
        } else if (variationModalItem) {
          setVariationModalItem(null)
        } else {
          setActiveDetailItem(null)
        }
      } else if (e.key === 'ArrowLeft' && detailImages.length > 1 && !customizingModalItem && !variationModalItem) {
        setModalImageIndex((curr) => (curr + detailImages.length - 1) % detailImages.length)
      } else if (e.key === 'ArrowRight' && detailImages.length > 1 && !customizingModalItem && !variationModalItem) {
        setModalImageIndex((curr) => (curr + 1) % detailImages.length)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [activeDetailItem, customizingModalItem, variationModalItem, repeatPromptItem, repeatVariationPromptItem, detailImages.length])

  const modalUnitPrice = useMemo(() => {
    const targetItem = customizingModalItem || activeDetailItem
    if (!targetItem) return 0
    const discount = targetItem.discount_percent || 0
    if (targetItem.is_custom) {
      const base = targetItem.base_price_paise ?? 0
      const extra = Object.values(selectedOptions).reduce((sum, opt) => sum + (opt?.extra_paise || 0), 0)
      const rawTotal = base + extra
      return discount ? (rawTotal * (100 - discount)) / 100 : rawTotal
    }
    return priceFor(targetItem)
  }, [activeDetailItem, customizingModalItem, selectedOptions])

  const modalTotalPrice = modalUnitPrice * modalQuantity

  const variationModalUnitPrice = useMemo(() => {
    if (!variationModalItem || !selectedVariation) return 0
    const disc = variationModalItem.discount_percent || 0
    return disc ? Math.round((selectedVariation.price_paise * (100 - disc)) / 100) : selectedVariation.price_paise
  }, [variationModalItem, selectedVariation])

  const variationModalTotalPrice = variationModalUnitPrice * modalQuantity

  const setLineQuantity = useCallback((lineKey: string, quantity: number) => {
    if (orderingClosed) return
    revealCartSummary()
    setCart((old) => {
      const next = !quantity
        ? old.filter((l) => l.lineKey !== lineKey)
        : old.map((l) => l.lineKey === lineKey ? { ...l, quantity } : l)
      persistCart(next)
      return next
    })
  }, [orderingClosed, persistCart])

  const setStandardQuantity = useCallback((item: MenuItem, quantity: number) => {
    if (orderingClosed || item.is_paused) return
    const lineKey = String(item.id)
    revealCartSummary()
    setCart((old) => {
      const found = old.find((line) => line.lineKey === lineKey)
      const unitPrice = priceFor(item)
      const next = !quantity
        ? old.filter((line) => line.lineKey !== lineKey)
        : found
          ? old.map((line) => line.lineKey === lineKey ? { ...line, quantity } : line)
          : [...old, { item, quantity, lineKey, unit_price_paise: unitPrice }]
      persistCart(next)
      return next
    })
  }, [orderingClosed, persistCart])


  const quantityFor = (itemId: number, isCustom = false) => cart.filter((line) => line.item.id === itemId && Boolean(line.item.is_custom) === isCustom).reduce((sum, line) => sum + line.quantity, 0)

  async function executeOrderPlacement(deliveryLocation: any) {
    setBusy(true)
    setError('')
    try {
      let formattedScheduledFor: string | null = null
      if (scheduledFor) {
        let val = scheduledFor.trim()
        if (!val.includes('T') && val.includes(':')) {
          const istFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
          val = `${istFormatter.format(new Date())}T${val}`
        }
        if (!val.includes('+')) {
          val = `${val.length === 16 ? val + ':00' : val}+05:30`
        }
        formattedScheduledFor = val
      }
      const order = await api<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: validCartLines.map((line) => ({
            menu_item_id: line.custom_menu_item_id || line.item.is_custom ? null : line.item.id,
            custom_menu_item_id: line.custom_menu_item_id || (line.item.is_custom ? line.item.id : null),
            variation_name: line.variation_name || null,
            quantity: line.quantity,
            customizations: line.customizations || [],
          })),
          payment_method: paymentMethod,
          address: address.trim(), latitude: deliveryLocation?.latitude ?? null, longitude: deliveryLocation?.longitude ?? null, notes: notes.trim(),
          scheduled_for: formattedScheduledFor,
        }),
      })
      if (paymentMethod === 'RAZORPAY' && order.checkout) {
        await launchCheckout(order.checkout, {
          onPaid: async (payment) => {
            try {
              await verifyRazorpayPayment(payment)
              setSuccess({ ...order, payment_status: 'PAID' })
              setCart([])
              persistCart([], true)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Payment verification could not be confirmed.')
            }
          },
          onDismiss: () => {
            void api(`/orders/${order.order_id}/abandon`, { method: 'POST' }).catch(() => undefined)
            setCheckoutWarning({
              tone: 'info',
              eyebrow: 'PAYMENT CANCELLED',
              title: 'Online payment cancelled',
              description: 'Your cart has been safely preserved. You can switch to Cash on Delivery or review your order.',
              primaryAction: {
                label: 'Switch to Cash on Delivery',
                onClick: () => {
                  setPaymentMethod('CASH')
                  setCheckoutWarning(null)
                },
              },
              secondaryAction: {
                label: 'Keep online payment',
                variant: 'secondary',
                onClick: () => setCheckoutWarning(null),
              },
            })
          },
          onError: (err) => {
            void api(`/orders/${order.order_id}/abandon`, { method: 'POST' }).catch(() => undefined)
            setCheckoutWarning({
              tone: 'danger',
              eyebrow: 'PAYMENT FAILED',
              title: 'Online payment failed',
              description: `${err.message}. Your cart is still preserved — you can retry online payment or choose Cash on Delivery.`,
              primaryAction: {
                label: 'Switch to Cash on Delivery',
                onClick: () => {
                  setPaymentMethod('CASH')
                  setCheckoutWarning(null)
                },
              },
              secondaryAction: {
                label: 'Close',
                variant: 'secondary',
                onClick: () => setCheckoutWarning(null),
              },
            })
          },
        })
        return
      }
      setSuccess(order)
      setCart([])
      persistCart([], true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not place your order. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function placeOrder() {
    if (cancelCountdownActive) {
      cancelOrderCountdown()
      return
    }
    if (!account) {
      setCheckoutWarning({
        tone: 'info',
        eyebrow: 'SIGN IN REQUIRED',
        title: 'Sign in to place your order',
        description: 'Please sign in or create a customer account so we can track and deliver your meal.',
        primaryAction: {
          label: 'Sign in now',
          onClick: () => {
            setCheckoutWarning(null)
            navigate('/login')
          },
        },
        secondaryAction: {
          label: 'Continue browsing',
          variant: 'secondary',
          onClick: () => setCheckoutWarning(null),
        },
      })
      return
    }
    const deliveryLocation = account.addresses?.find((item) => item.id === selectedAddress)
    if (!cart.length) {
      setCheckoutWarning({
        tone: 'warning',
        eyebrow: 'EMPTY BASKET',
        title: 'Your cart is empty',
        description: 'Add something delicious from the menu before placing an order.',
        primaryAction: {
          label: 'Browse the menu',
          onClick: () => {
            setCheckoutWarning(null)
            setCartOpen(false)
            goToMenu()
          },
        },
        secondaryAction: {
          label: 'Close',
          variant: 'secondary',
          onClick: () => setCheckoutWarning(null),
        },
      })
      return
    }
    if (hasUnavailableItems) {
      setCheckoutWarning({
        tone: 'danger',
        eyebrow: 'UNAVAILABLE ITEMS',
        title: 'Unavailable items in cart',
        description: 'Please remove the unavailable items marked in red before placing your order.',
        primaryAction: {
          label: 'Review cart',
          onClick: () => setCheckoutWarning(null),
        },
      })
      return
    }
    if (validItemsCount === 0) {
      setCheckoutWarning({
        tone: 'warning',
        eyebrow: 'EMPTY BASKET',
        title: 'Select items to order',
        description: 'Please add at least one available item from the menu to place an order.',
        primaryAction: {
          label: 'Browse the menu',
          onClick: () => {
            setCheckoutWarning(null)
            setCartOpen(false)
            goToMenu()
          },
        },
        secondaryAction: {
          label: 'Close',
          variant: 'secondary',
          onClick: () => setCheckoutWarning(null),
        },
      })
      return
    }
    if (!address.trim()) {
      setCheckoutWarning({
        tone: 'warning',
        eyebrow: 'ADDRESS REQUIRED',
        title: 'Delivery address needed',
        description: 'Please select or add a delivery address so our riders know where to bring your order.',
        primaryAction: {
          label: 'Add delivery address',
          onClick: () => {
            setCheckoutWarning(null)
            navigate('/profile')
          },
        },
        secondaryAction: {
          label: 'Close',
          variant: 'secondary',
          onClick: () => setCheckoutWarning(null),
        },
      })
      return
    }
    if (deliveryLocation?.latitude == null || deliveryLocation.longitude == null) {
      setCheckoutWarning({
        tone: 'warning',
        eyebrow: 'MAP PIN REQUIRED',
        title: 'Pin your delivery location',
        description: 'Your saved address needs an exact map pin so our delivery partners can find your doorstep easily.',
        primaryAction: {
          label: 'Set map pin in profile',
          onClick: () => {
            setCheckoutWarning(null)
            navigate('/profile')
          },
        },
        secondaryAction: {
          label: 'Close',
          variant: 'secondary',
          onClick: () => setCheckoutWarning(null),
        },
      })
      return
    }
    if (subtotal < (restaurant?.minimum_order_paise || 0)) {
      const remainingPaise = (restaurant?.minimum_order_paise || 0) - subtotal
      setCheckoutWarning({
        tone: 'warning',
        eyebrow: 'MINIMUM ORDER',
        title: 'A little more flavor needed',
        description: `Our minimum order for delivery is ${formatINR(restaurant?.minimum_order_paise || 0)}. Please add ${formatINR(remainingPaise)} more to checkout.`,
        primaryAction: {
          label: 'Browse the menu',
          onClick: () => {
            setCheckoutWarning(null)
            setCartOpen(false)
            goToMenu()
          },
        },
        secondaryAction: {
          label: 'Review cart',
          variant: 'secondary',
          onClick: () => setCheckoutWarning(null),
        },
      })
      return
    }
    if (deliveryEstimate && !deliveryEstimate.within_radius) {
      setCheckoutWarning({
        tone: 'danger',
        eyebrow: 'OUTSIDE DELIVERY AREA',
        title: 'Delivery location too far',
        description: `Your delivery location is ${deliveryEstimate.distance_km} km away, which exceeds our maximum delivery radius of ${deliveryEstimate.max_radius_km} km.`,
        primaryAction: {
          label: 'Manage address in profile',
          onClick: () => {
            setCheckoutWarning(null)
            navigate('/profile')
          },
        },
        secondaryAction: {
          label: 'Close',
          variant: 'secondary',
          onClick: () => setCheckoutWarning(null),
        },
      })
      return
    }

    if (paymentMethod === 'CASH') {
      setCancelCountdownActive(true)
      cancelTimerRef.current = setTimeout(() => {
        setCancelCountdownActive(false)
        cancelTimerRef.current = null
        void executeOrderPlacement(deliveryLocation)
      }, 5000)
    } else {
      void executeOrderPlacement(deliveryLocation)
    }
  }

  function goToMenu() {
    preloadMenuImages(menu)
    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' })
  }

  if (loading) return <div className="store-loading"><Loading label="Lighting the grill…" /></div>
  if (success) return <main className="order-success-wrap"><section className="order-success"><div className="success-check"><Check size={29} /></div><div className="eyebrow">ORDER {success.payment_method === 'RAZORPAY' && success.payment_status !== 'PAID' ? 'SAVED · PAYMENT PENDING' : 'IT’S ON THE WAY'}</div><h1>{success.payment_method === 'RAZORPAY' && success.payment_status !== 'PAID' ? 'Your ticket is saved.' : 'That’s a wrap.'}</h1><p>{success.payment_method === 'RAZORPAY' && success.payment_status !== 'PAID' ? 'We saved your order, but payment has not been confirmed. Open My orders to finish payment or check its status.' : 'Your order is with the grill team. We’ll keep you posted as it makes its way to you.'}</p><div className="success-order-number"><span>ORDER NUMBER</span><strong>{success.order_id}</strong></div><div className="success-order-meta"><span><Clock3 size={15} /> Track it as it makes its way to you</span><span><ShieldCheck size={15} /> {success.payment_status === 'PAID' ? 'Payment secured' : success.payment_method === 'CASH' ? 'Cash on delivery' : 'Payment not confirmed'}</span></div><Link className="button button-dark" to={account ? '/orders' : '/'}>{success.payment_method === 'RAZORPAY' && success.payment_status !== 'PAID' ? 'Finish payment' : 'Track your order'} <ArrowRight size={16} /></Link><button className="text-button success-back" onClick={() => setSuccess(null)}>Back to the menu</button></section><div className="success-decoration">🥙</div></main>

  return <main className="storefront">
    <section className="hero-section">
      <div className="hero-copy"><div className="hero-kicker"><span className="hero-kicker-icon"><Flame size={15} fill="currentColor" /></span> SLOW FIRE. BIG FLAVOR.</div><h1>Big on flavor.<br />Never <em>on the fence.</em></h1><p className="hero-description">Big, bold flavors and ridiculously good kebabs, made fresh when you order.</p><div className="hero-actions"><Button onClick={goToMenu}>Explore the menu <ArrowDown size={16} /></Button><div className="hero-delivery"><span className="hero-delivery-icon"><Truck size={17} /></span><span><strong>Order updates along the way</strong><small>From our kitchen to your door</small></span></div></div><div className="hero-social-proof"><div className="social-rating"><span>✦</span><b>Made to order</b></div><div className="social-divider" /><span>Freshly prepared</span><span className="social-separator">·</span><span>Made with care</span></div></div>
      <div className="hero-art"><div className="hero-art-bg" /><div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" /><div className="hero-food-main"><span className="hero-food-glow" /><span className="hero-food-emoji">🥙</span><span className="hero-food-herbs">✳ &nbsp;✦ &nbsp;✳</span></div><div className="hero-note hero-note-top"><span className="hero-note-star">✦</span><span>Fire-kissed<br /><strong>to perfection</strong></span></div><div className="hero-note hero-note-bottom"><span className="mini-avatar">Z</span><span><strong>Made fresh</strong><br />Just for you</span><Sparkles className="note-spark" size={17} /></div><span className="hero-art-doodle doodle-one">✷</span><span className="hero-art-doodle doodle-two">✳</span></div>
      <div className="hero-bottomline"><span>01 <i /> GOOD FOOD, GREAT NEIGHBORS</span><span className="hero-bottom-address"><MapPin size={13} /> {restaurant?.address || 'Add your restaurant address'}</span><span>SCROLL TO TASTE <ArrowDown size={13} /></span></div>
    </section>

    <section className="value-strip"><div><span className="value-icon"><Flame size={19} /></span><span><strong>Charcoal, always</strong><small>Real fire. No shortcuts.</small></span></div><div><span className="value-icon"><Leaf size={19} /></span><span><strong>Fresh, never frozen</strong><small>Made when you order.</small></span></div><div><span className="value-icon"><Truck size={19} /></span><span><strong>Quick to your door</strong><small>Hot food. Happy you.</small></span></div><div><span className="value-icon"><Utensils size={19} /></span><span><strong>Made with care</strong><small>Recipes worth sharing.</small></span></div></section>

    <section className="menu-section" id="menu">
      <div className="menu-intro">
        <div>
          <h2>{menuHeading}</h2>
          <p>{menuSubtitle}</p>
        </div>
      </div>
      {serverDown ? (
        <div className="menu-server-down" style={{ padding: '2rem 1rem' }}>
          <EmptyState
            icon={<WifiOff size={24} />}
            title="Our servers are currently down"
            description="We’re having trouble connecting to our servers right now. Please check back in a few minutes or try again shortly."
            action={
              <Button onClick={() => loadStore()} style={{ marginTop: '0.75rem' }}>
                <RotateCcw size={15} style={{ marginRight: '6px' }} /> Try again
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="menu-tabs">{categories.map((name) => <button className={`menu-tab ${category === name ? 'active' : ''}`} key={name} onClick={() => { setCategory(name); preloadMenuImages(menu); liquidGlassManager.invalidateAll(); }}>{name}</button>)}</div>
      <div className="storefront-sticky-controls">
        <div className="menu-discovery-controls">
          <label className="menu-search">
            <Search size={17} />
            <input
              type="search"
              aria-label="Search menu"
              value={menuSearch}
              onChange={(event) => setMenuSearch(event.target.value)}
              placeholder="Search dishes or categories"
            />
          </label>
          <RoundedSelect
            className="menu-sort-select"
            icon={<ListFilter size={16} />}
            ariaLabel="Sort menu"
            value={menuSort}
            onChange={(val) => setMenuSort(val as 'popular_desc' | 'popular_asc' | 'price_asc' | 'price_desc')}
            options={[
              { value: 'popular_desc', label: 'Popularity · high to low' },
              { value: 'popular_asc', label: 'Popularity · low to high' },
              { value: 'price_asc', label: 'Price · low to high' },
              { value: 'price_desc', label: 'Price · high to low' },
            ]}
          />
        </div>
      </div>
      {visibleMenu.length ? <div className={`food-grid ${orderingClosed ? 'food-grid-closed' : ''}`}>{visibleMenu.map((item, index) => <article className={`food-card ${item.is_featured ? 'food-featured' : ''} ${orderingClosed || item.is_paused ? 'food-card-unavailable' : ''}`} key={`${item.is_custom ? 'c-' : 'm-'}${item.id}`} onClick={() => openDetailModal(item)}>
        <div className={`food-image ${colors[(index + item.id) % colors.length]}`}>
          {item.image_urls?.length || item.image_url ? (
            <div className="food-image-main-wrap">
              <img
                src={resolveImageUrl((item.image_urls?.length ? item.image_urls[0] : item.image_url) || '')}
                alt={item.name}
                loading="lazy"
                crossOrigin="anonymous"
              />
            </div>
          ) : (
            <><span className="food-image-orbit" /><span className="food-emoji">{art[(index + item.id) % art.length]}</span><span className="food-image-sprinkle">✦ &nbsp;✳</span></>
          )}
          {item.discount_campaign_name && <span className="food-best discount-campaign-label" title={item.discount_campaign_name}>{item.discount_campaign_name}</span>}
          {item.is_featured && <span className={`food-best food-zilla-pick ${item.discount_campaign_name ? 'food-zilla-pick-after-discount' : ''}`}>ZILLA PICK <Sparkles size={11} /></span>}
          {item.is_custom && <span className="food-best custom-dish-badge">CUSTOMIZABLE</span>}
          <span className={`diet-dot ${item.is_vegetarian ? 'veg' : 'nonveg'}`} title={item.is_vegetarian ? 'Vegetarian' : 'Non-vegetarian'}>{item.is_vegetarian ? <Leaf size={11} /> : <span />}</span>
        </div>
        <div className="food-card-content">
          <div className="food-card-title-row">
            <h3>{item.name}</h3>
          </div>
          <p>{item.description}</p>
          <div className="food-card-bottom" onClick={(event) => event.stopPropagation()}>
            <strong>
              {(() => {
                const isCustomOrVar = Boolean(item.is_custom || (item.variations && item.variations.length > 0))
                const rawLowest = getMenuItemLowestPrice(item)
                const discountedLowest = getItemDiscountedLowestPrice(item, rawLowest)
                const hasDiscount = discountedLowest < rawLowest

                if (isCustomOrVar) {
                  return hasDiscount ? (
                    <>
                      <span>From {formatINR(discountedLowest)}</span>
                      <del>{formatINR(rawLowest)}</del>
                    </>
                  ) : (
                    <span>From {formatINR(rawLowest)}</span>
                  )
                }

                return hasDiscount ? (
                  <>
                    <span>{formatINR(discountedLowest)}</span>
                    <del>{formatINR(rawLowest)}</del>
                  </>
                ) : (
                  <span>{formatINR(rawLowest)}</span>
                )
              })()}
            </strong>
            {orderingClosed || item.is_paused ? (
              <span className="closed-menu-label">
                {item.is_paused ? 'Currently unavailable' : !isRestaurantOpen ? 'Closed' : 'Walk-in only'}
              </span>
            ) : item.is_custom && item.custom_sections && item.custom_sections.length > 0 ? (
              quantityFor(item.id, Boolean(item.is_custom)) > 0 ? (
                <QuantityPicker
                  small
                  quantity={quantityFor(item.id, Boolean(item.is_custom))}
                  onChange={(newQty) => {
                    if (newQty > quantityFor(item.id, Boolean(item.is_custom))) handleCustomItemAddOrIncrement(item)
                    else decrementCustomItem(item)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="add-food"
                  onClick={() => handleCustomItemAddOrIncrement(item)}
                  aria-label={`Customize ${item.name}`}
                >
                  <Sparkles size={13} /> Customize
                </button>
              )
            ) : item.variations && item.variations.length > 0 ? (
              quantityFor(item.id, Boolean(item.is_custom)) > 0 ? (
                <QuantityPicker
                  small
                  quantity={quantityFor(item.id, Boolean(item.is_custom))}
                  onChange={(newQty) => {
                    if (newQty > quantityFor(item.id, Boolean(item.is_custom))) handleVariationItemAddOrIncrement(item)
                    else decrementVariationItem(item)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="add-food"
                  onClick={() => handleVariationItemAddOrIncrement(item)}
                  aria-label={`Choose portion for ${item.name}`}
                >
                  <Sparkles size={13} /> Choose
                </button>
              )
            ) : quantityFor(item.id, Boolean(item.is_custom)) ? (
              <QuantityPicker small quantity={quantityFor(item.id, Boolean(item.is_custom))} onChange={(quantity) => setStandardQuantity(item, quantity)} />
            ) : (
              <button
                type="button"
                className="add-food"
                onClick={() => setStandardQuantity(item, 1)}
                aria-label={`Add ${item.name}`}
              >
                <Plus size={14} /> ADD
              </button>
            )}
          </div>
        </div>
      </article>)}</div> : <EmptyState icon={<Utensils size={20} />} title="The menu’s getting warmed up" description="Ask your restaurant admin to publish a few delicious items." />}
        </>
      )}
    </section>

    <section className="story-banner"><div className="story-mark"><Flame size={25} /></div><div><div className="eyebrow light-eyebrow">THE ZILLA WAY</div><h2>Good food is meant<br />to bring people <em>closer.</em></h2><p>From our charcoal grill to your table, every bite starts with the good stuff.</p></div><div className="story-seal"><span>100%</span><small>GOOD<br />TASTE</small><span>✦</span></div><div className="story-pattern">✳ &nbsp;· &nbsp;✦ &nbsp;· &nbsp;✳</div></section>
    <section className="store-bottom"><div><div className="eyebrow">COME BY, SAY HI</div><h2>Or let us bring it <em>to your table.</em></h2><div className="store-bottom-details">{restaurant?.address ? (<a href={restaurant.latitude != null && restaurant.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${restaurant.latitude},${restaurant.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.address)}`} target="_blank" rel="noreferrer" className="store-address-link" title="Open exact location in Google Maps" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}><MapPin size={15} /> <span>{restaurant.address}</span></a>) : (<span>Restaurant location has not been added yet.</span>)}{restaurant?.email && (<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Mail size={15} /> <a href={`mailto:${restaurant.email}`} style={{ color: 'inherit', textDecoration: 'none' }}>{restaurant.email}</a></span>)}{((restaurant?.phones && restaurant.phones.length > 0) ? restaurant.phones : (restaurant?.phone ? restaurant.phone.split(',').map((p) => p.trim()).filter(Boolean) : [])).map((phoneNum, idx) => (<span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Phone size={15} /> <a href={`tel:${phoneNum}`} style={{ color: 'inherit', textDecoration: 'none' }}>{phoneNum}</a></span>))}</div></div>{restaurant?.latitude != null && restaurant.longitude != null ? <a className="store-bottom-map" href={`https://www.google.com/maps/search/?api=1&query=${restaurant.latitude},${restaurant.longitude}`} target="_blank" rel="noreferrer"><span className="map-mini"><MapPin size={26} /></span><span><strong>Find KebabZilla</strong><small>Open directions in Maps</small></span><ArrowRight size={17} /></a> : <div className="store-bottom-map"><span className="map-mini"><MapPin size={26} /></span><span><strong>Location details</strong><small>Pin location coming soon</small></span></div>}</section>

    {cartOpen && <div className="cart-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}><aside className="cart-panel" aria-label="Your basket" onMouseDown={(event) => event.stopPropagation()}><div className="cart-header"><div><span className="cart-icon"><ShoppingBag size={17} /></span><span><strong>Your order</strong><small>{totalItems} delicious thing{totalItems === 1 ? '' : 's'}</small></span></div><button className="cart-close" aria-label="Close cart" onClick={() => setCartOpen(false)}><X size={17} /></button></div><div className="cart-panel-scroll">{cart.length ? <><div className="cart-items">{cart.map((line) => {
        const unavailable = isLineUnavailable(line)
        const unitPrice = line.unit_price_paise ?? priceFor(line.item)
        const customSummary = (line.customizations || []).map((o) => o.name).join(', ')
        const hasVariations = (line.item.variations?.length || 0) > 0

        if (unavailable) {
          return (
            <div className="cart-line cart-line-unavailable" key={line.lineKey}>
              <span className="cart-line-name">
                <strong className="cart-unavailable-item-name">{line.item.name}</strong>
                {line.variation_name && <small className="cart-custom-desc">Portion: {line.variation_name}</small>}
                {customSummary && <small className="cart-custom-desc">{customSummary}</small>}
                <small className="cart-unavailable-badge">Currently unavailable</small>
              </span>
              <button
                type="button"
                className="cart-remove-item-btn"
                onClick={() => setLineQuantity(line.lineKey, 0)}
                aria-label={`Remove unavailable item ${line.item.name}`}
                title="Remove unavailable item"
              >
                <X size={16} />
              </button>
            </div>
          )
        }

        return (
          <div className="cart-line" key={line.lineKey}>
            <span className="cart-line-name">
              {line.item.name}
              {line.variation_name && <small className="cart-custom-desc">Portion: {line.variation_name}</small>}
              {customSummary && <small className="cart-custom-desc">{customSummary}</small>}
              {(line.item.is_custom || hasVariations) && (
                <button
                  type="button"
                  className="cart-edit-link"
                  onClick={() => {
                    if (line.item.is_custom) {
                      openCustomizationModal(line.item, line)
                    } else {
                      openVariationModal(line.item, line)
                    }
                  }}
                  aria-label={`Edit ${line.item.name}`}
                >
                  <Edit3 size={11} /> {line.item.is_custom ? 'Edit customization' : 'Change portion'}
                </button>
              )}
              <small>{formatINR(unitPrice)} each</small>
            </span>
            <QuantityPicker small quantity={line.quantity} onChange={(next) => setLineQuantity(line.lineKey, next)} />
            <strong>{formatINR(unitPrice * line.quantity)}</strong>
          </div>
        )
      })}</div>
      <div className="cart-totals">
        <div>
          <span>Subtotal</span>
          <strong>{formatINR(subtotal)}</strong>
        </div>
        <div>
          <span>Delivery fee</span>
          <strong>
            {estimateLoading ? (
              <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Calculating…</span>
            ) : selectedLocation ? (
              deliveryEstimate ? (
                deliveryEstimate.within_radius ? (
                  deliveryFee === 0 ? (
                    <span style={{ color: '#2b7a4b', fontWeight: 800 }}>
                      Free{isFreeDeliveryByThreshold && restaurant?.free_delivery_threshold_paise ? ` (Order over ${formatINR(restaurant.free_delivery_threshold_paise)})` : ''}
                    </span>
                  ) : (
                    formatINR(deliveryFee)
                  )
                ) : (
                  <span style={{ color: '#b4483a', fontSize: '11px' }}>Outside delivery zone</span>
                )
              ) : selectedLocation.latitude == null || selectedLocation.longitude == null ? (
                <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Pin address on map</span>
              ) : (
                <span style={{ color: '#2b7a4b', fontWeight: 800 }}>Free</span>
              )
            ) : (
              <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Select address</span>
            )}
          </strong>
        </div>
        {Math.abs(roundOffPaise) >= 0.01 && (
          <div>
            <span>Round off</span>
            <strong>
              {roundOffPaise >= 0 ? '+' : ''}
              {formatINR(roundOffPaise)}
            </strong>
          </div>
        )}
        <div className="cart-grand">
          <span>Total</span>
          <strong>{formatINR(payable)}</strong>
        </div>
      </div>
      {deliveryEstimate && !deliveryEstimate.within_radius && (
        <div className="notice" style={{ margin: '8px 0', fontSize: '12px' }}>
          Your address is {deliveryEstimate.distance_km} km away, which exceeds our maximum delivery radius of {deliveryEstimate.max_radius_km} km.
        </div>
      )}
      {account ? <div className="checkout-fields">
        {account.addresses?.filter((saved) => formatSavedAddress(saved)).length ? (
          <label className="field-label">
            Delivery address
            <RoundedSelect
              value={selectedAddress}
              placeholder="Choose a saved address"
              onChange={(val) => {
                const saved = account.addresses.find((item) => item.id === val);
                setSelectedAddress(val);
                setAddress(saved ? formatSavedAddress(saved) : "")
              }}
              options={account.addresses.filter((saved) => formatSavedAddress(saved)).map((saved) => ({
                value: saved.id,
                label: `${saved.label}${saved.is_default ? " · Default" : ""} — ${formatSavedAddress(saved)}`
              }))}
            />
            <Link to="/profile" className="text-button">Edit saved addresses</Link>
          </label>
        ) : (
          <div className="notice notice-info cart-address-prompt">
            <span>Add a delivery address before ordering.</span>
            <Link to="/profile" className="button button-secondary">Add delivery address <ArrowRight size={14} /></Link>
          </div>
        )}
        <div className={`checkout-timing-row ${scheduledFor ? 'two-col' : 'single-col'}`}>
          <label className="field-label">
            Order timing
            <RoundedSelect
              value={scheduledFor ? "later" : "now"}
              onChange={(val) => {
                if (val === "later") {
                  const defaultSlot = permissibleTimeSlots[0]?.value || '18:00';
                  const istFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
                  const todayStr = istFormatter.format(new Date());
                  setScheduledFor(`${todayStr}T${defaultSlot}`);
                } else {
                  setScheduledFor("");
                }
              }}
              options={[
                { value: "now", label: "As soon as possible" },
                { value: "later", label: "Schedule for later" },
              ]}
            />
          </label>
          {scheduledFor && (
            <label className="field-label schedule-time-field">
              Schedule time (Today only)
              <RoundedTimePicker
                value={scheduledFor.slice(11, 16)}
                placeholder="--:--"
                ariaLabel="Select schedule time"
                allowedHours={permissibleHours.length > 0 ? permissibleHours : undefined}
                onChange={(timeVal) => {
                  const istFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
                  const todayStr = istFormatter.format(new Date());
                  setScheduledFor(`${todayStr}T${timeVal}`);
                }}
              />
            </label>
          )}
        </div>
        <label className="field-label">
          Anything we should know? <span className="field-optional">optional</span>
          <input maxLength={500} placeholder="No onions, extra chutney…" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div> : <div className="cart-signin"><p>One tiny step before the first bite.</p><Link className="button button-dark" to="/login">Sign in to check out <ArrowRight size={16} /></Link><span>New here? <Link to="/register">Create an account</Link></span></div>}
      {subtotal < (restaurant?.minimum_order_paise || 0) && <div className="minimum-note">Add {formatINR((restaurant?.minimum_order_paise || 0) - subtotal)} to meet our minimum.</div>}
      </> : <div className="cart-empty"><p>Your cart is empty.</p><button className="text-button" onClick={() => { setCartOpen(false); document.querySelector('.menu-section')?.scrollIntoView({ behavior: 'smooth' }) }}>Browse the menu</button></div>}</div>
      {cart.length > 0 && (
        <div className="cart-sticky-bottom">
          {account ? (
            <>
              {error && error !== 'One or more menu items are unavailable' && <Notice>{error}</Notice>}
              <div className="cart-action-row">
                <div className="cart-payment-select-wrap">
                  <RoundedSelect
                    value={paymentMethod}
                    onChange={(val) => setPaymentMethod(val as 'RAZORPAY' | 'CASH')}
                    className="cart-payment-select"
                    ariaLabel="Select payment method"
                    options={[
                      { value: 'RAZORPAY', label: 'Pay online' },
                      { value: 'CASH', label: 'Pay on delivery' },
                    ]}
                  />
                </div>
                <Button
                  className={`checkout-button ${cancelCountdownActive ? 'cancelling-mode' : ''}`}
                  disabled={busy || orderingClosed || hasUnavailableItems || validItemsCount === 0}
                  onClick={placeOrder}
                >
                  {cancelCountdownActive && <span className="checkout-loading-bar" />}
                  <span className="checkout-button-content">
                    {cancelCountdownActive ? (
                      <>
                        <span>Cancel</span>
                        <X size={15} />
                      </>
                    ) : busy ? (
                      'Just a second…'
                    ) : orderingClosed ? (
                      !isRestaurantOpen ? 'Sorry, we are closed' : 'Delivery is currently unavailable (Walk-in only)'
                    ) : hasUnavailableItems ? (
                      'Remove unavailable items to order'
                    ) : validItemsCount === 0 ? (
                      'Select items to order'
                    ) : isApproachingClosing ? (
                      <>Place order · {formatINR(payable)} (Closing soon) <ArrowRight size={16} /></>
                    ) : (
                      <>Place order · {formatINR(payable)} <ArrowRight size={16} /></>
                    )}
                  </span>
                </Button>
              </div>
              <div className="checkout-secure">
                <ShieldCheck size={14} /> {paymentMethod === 'RAZORPAY' ? 'Secure checkout by Razorpay' : 'Pay when your food arrives'}
              </div>
            </>
          ) : (
            <div className="cart-action-row">
              <Link className="button button-dark checkout-button" to="/login" style={{ width: '100%', justifyContent: 'center' }}>
                Sign in to check out <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </div>
      )}
    </aside></div>}
    {cart.length > 0 && <button className={`floating-cart visible ${cartExpanded ? 'expanded' : 'compact'}`} onClick={() => setCartOpen(true)} aria-label={`Open cart, ${totalItems} item${totalItems === 1 ? '' : 's'}, total ${formatINR(payable)}`}><span className="cart-summary-icon"><ShoppingBag size={18} /></span><span className="cart-summary-copy"><strong>{totalItems} item{totalItems === 1 ? '' : 's'} added</strong><small>Tap to review your order</small></span><span className="cart-summary-total"><small>ORDER TOTAL</small><strong>{formatINR(payable)}</strong></span><ArrowRight size={17} /></button>}

    {activeDetailItem && (() => {
      const isVariations = Boolean(activeDetailItem.variations && activeDetailItem.variations.length > 0)
      const isCustom = Boolean(activeDetailItem.is_custom && activeDetailItem.custom_sections && activeDetailItem.custom_sections.length > 0)
      const currentQty = quantityFor(activeDetailItem.id, Boolean(activeDetailItem.is_custom))

      return (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActiveDetailItem(null) } }}>
          <section className="modal-card food-detail-modal" role="dialog" aria-modal="true">
            <div className="food-detail-hero-box">
              {detailImages.length > 0 ? (
                <img
                  src={detailImages[modalImageIndex % detailImages.length]}
                  alt={`${activeDetailItem.name} photo`}
                  className="food-detail-hero-img"
                  crossOrigin="anonymous"
                />
              ) : (
                <div className="food-detail-no-img">
                  <span className="food-detail-emoji">{activeDetailItem.is_vegetarian ? "🥬" : "🍢"}</span>
                </div>
              )}

              <button
                type="button"
                className="food-detail-close-floating"
                onClick={() => { setActiveDetailItem(null) }}
                aria-label="Close"
              >
                <X size={18} />
              </button>

              {detailImages.length > 1 && (
                <>
                  <button
                    type="button"
                    className="food-detail-img-nav prev"
                    aria-label="Previous photo"
                    onClick={(e) => {
                      e.stopPropagation()
                      setModalImageIndex((i) => (i + detailImages.length - 1) % detailImages.length)
                    }}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    type="button"
                    className="food-detail-img-nav next"
                    aria-label="Next photo"
                    onClick={(e) => {
                      e.stopPropagation()
                      setModalImageIndex((i) => (i + 1) % detailImages.length)
                    }}
                  >
                    <ChevronRight size={20} />
                  </button>
                  <span className="food-detail-img-counter">
                    {modalImageIndex + 1} / {detailImages.length}
                  </span>
                  <div className="food-detail-dots">
                    {detailImages.map((_, dotIdx) => (
                      <button
                        type="button"
                        key={dotIdx}
                        className={`food-detail-dot ${dotIdx === modalImageIndex ? 'active' : ''}`}
                        onClick={() => setModalImageIndex(dotIdx)}
                        aria-label={`Photo ${dotIdx + 1}`}
                      />
                    ))}
                  </div>
                </>
              )}
              <span
                className={`diet-dot ${activeDetailItem.is_vegetarian ? 'veg' : 'nonveg'}`}
                title={activeDetailItem.is_vegetarian ? 'Vegetarian' : 'Non-vegetarian'}
                style={{ zIndex: 10 }}
              >
                {activeDetailItem.is_vegetarian ? <Leaf size={11} /> : <span />}
              </span>
            </div>

            <div className="food-detail-content-body">
              <div className="food-detail-main-row">
                <div className="food-detail-title-price-col">
                  {(activeDetailItem.is_featured || activeDetailItem.discount_campaign_name) && (
                    <div className="food-detail-meta-row" style={{ marginBottom: 4 }}>
                      {activeDetailItem.is_featured && (
                        <span className="food-detail-bestseller-tag">
                          <Sparkles size={11} /> Bestseller
                        </span>
                      )}
                      {activeDetailItem.discount_campaign_name && (
                        <span className="food-detail-discount-tag" title={activeDetailItem.discount_campaign_name}>
                          {activeDetailItem.discount_campaign_name}
                        </span>
                      )}
                    </div>
                  )}
                  <h3 className="food-detail-title">{activeDetailItem.name}</h3>
                  <div className="food-detail-price">
                    {(() => {
                      const rawLowest = getMenuItemLowestPrice(activeDetailItem)
                      const discountedLowest = getItemDiscountedLowestPrice(activeDetailItem, rawLowest)
                      const hasDiscount = discountedLowest < rawLowest

                      if (isVariations || isCustom) {
                        return hasDiscount ? (
                          <>
                            <strong>From {formatINR(discountedLowest)}</strong>
                            <del>{formatINR(rawLowest)}</del>
                          </>
                        ) : (
                          <strong>From {formatINR(rawLowest)}</strong>
                        )
                      }

                      return (
                        <>
                          <strong>{formatINR(modalUnitPrice)}</strong>
                          {hasDiscount && (
                            <del>{formatINR(activeDetailItem.price_paise)}</del>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>

                <div className="food-detail-action-col">
                  {orderingClosed || activeDetailItem.is_paused ? (
                    <span className="closed-menu-label">
                      {activeDetailItem.is_paused ? 'Unavailable' : !isRestaurantOpen ? 'Closed' : 'Walk-in only'}
                    </span>
                  ) : isCustom ? (
                    currentQty > 0 ? (
                      <QuantityPicker
                        small
                        quantity={currentQty}
                        onChange={(newQty) => {
                          if (newQty > currentQty) handleCustomItemAddOrIncrement(activeDetailItem)
                          else decrementCustomItem(activeDetailItem)
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="add-food"
                        onClick={() => handleCustomItemAddOrIncrement(activeDetailItem)}
                        aria-label={`Customize ${activeDetailItem.name}`}
                      >
                        <Sparkles size={13} /> Customize
                      </button>
                    )
                  ) : isVariations ? (
                    currentQty > 0 ? (
                      <QuantityPicker
                        small
                        quantity={currentQty}
                        onChange={(newQty) => {
                          if (newQty > currentQty) handleVariationItemAddOrIncrement(activeDetailItem)
                          else decrementVariationItem(activeDetailItem)
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="add-food"
                        onClick={() => handleVariationItemAddOrIncrement(activeDetailItem)}
                        aria-label={`Choose portion for ${activeDetailItem.name}`}
                      >
                        <Sparkles size={13} /> Choose
                      </button>
                    )
                  ) : currentQty > 0 ? (
                    <QuantityPicker
                      small
                      quantity={currentQty}
                      onChange={(next) => setStandardQuantity(activeDetailItem, next)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="add-food"
                      onClick={() => setStandardQuantity(activeDetailItem, 1)}
                      aria-label={`Add ${activeDetailItem.name}`}
                    >
                      <Plus size={14} /> ADD
                    </button>
                  )}
                </div>
              </div>

              {activeDetailItem.description && (
                <p className="food-detail-description">{activeDetailItem.description}</p>
              )}
            </div>
          </section>
        </div>
      )
    })()}

    {/* Customization Options Window (Opens on top when ADD / Choose is clicked) */}
    {customizingModalItem && (
      <div className="modal-backdrop" style={{ zIndex: 1100 }} onMouseDown={(e) => { if (e.target === e.currentTarget) { setCustomizingModalItem(null); setError('') } }}>
        <section className="modal-card customize-food-modal" role="dialog" aria-modal="true">
          <div className="modal-heading">
            <div>
              <span className="eyebrow" style={{ color: '#c54d2f' }}>CUSTOMIZE</span>
              <h2 style={{ fontSize: '1.25rem', margin: '4px 0 0' }}>Customize {customizingModalItem.name}</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => { setCustomizingModalItem(null); setError('') }} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className="customize-food-body">
            {error && <div className="notice" style={{ margin: '0 0 12px', fontSize: '13px' }}>{error}</div>}

            <div className="customize-sections-list">
              {customizingModalItem.custom_sections?.map((section) => (
                <div className="customize-section-group" key={section.name}>
                  <div className="customize-section-title">
                    <strong>{section.name}</strong>
                    {section.required !== false ? (
                      <span className="customize-tag-required">Required</span>
                    ) : (
                      <span className="customize-tag-optional">Optional</span>
                    )}
                  </div>
                  <div className="customize-options-grid">
                    {section.options.map((opt) => {
                      const isSelected = selectedOptions[section.name]?.name === opt.name
                      return (
                        <button
                          type="button"
                          key={opt.name}
                          className={`customize-option-pill ${isSelected ? 'selected' : ''}`}
                          onClick={() => onSelectCustomOption(section.name, opt, isSelected, section.required !== false)}
                        >
                          <span className="customize-radio-dot">{isSelected ? '●' : '○'}</span>
                          <span className="customize-opt-name">{opt.name}</span>
                          <span className="customize-opt-price">
                            {opt.extra_paise > 0 ? `+${formatINR(opt.extra_paise)}` : 'Free'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

          </div>

          <div className="food-detail-footer">
            <div className="food-detail-price-breakdown">
              <span>TOTAL</span>
              <strong>{formatINR(modalTotalPrice)}</strong>
            </div>
            <button
              type="button"
              className="food-detail-footer-btn"
              onClick={confirmCustomItemAdd}
            >
              <Plus size={16} /> {activeCustomLineKey ? 'Update item' : 'Add to cart'}
            </button>
          </div>
        </section>
      </div>
    )}

    {/* Repeat Customization Prompt Window */}
    {repeatPromptItem && (
      <div className="modal-backdrop" style={{ zIndex: 1200 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setRepeatPromptItem(null) }}>
        <section className="modal-card repeat-custom-modal" role="dialog" aria-modal="true">
          <div className="modal-heading" style={{ paddingBottom: 6 }}>
            <div>
              <span className="eyebrow" style={{ color: '#c54d2f' }}>CUSTOMIZATION</span>
              <h2 style={{ fontSize: '1.2rem', margin: '4px 0 0' }}>Repeat last customization?</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => setRepeatPromptItem(null)} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(() => {
              const saved = getLastCustomization(repeatPromptItem.id)
              const desc = saved?.options?.map((o) => o.name).join(', ')
              return desc ? (
                <div style={{ background: '#faf9f6', padding: '10px 14px', borderRadius: '10px', border: '1px solid #ebe8e0', fontSize: '0.86rem', color: '#555d56' }}>
                  <strong style={{ color: '#29332f', display: 'block', marginBottom: 2 }}>Last selected:</strong>
                  {desc}
                </div>
              ) : null
            })()}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                className="button button-outline full-width"
                style={{ borderRadius: 10, padding: '11px 16px', fontWeight: 700 }}
                onClick={() => {
                  const it = repeatPromptItem
                  setRepeatPromptItem(null)
                  openCustomizationModal(it)
                }}
              >
                <Sparkles size={15} /> Make a second choice
              </button>
              <button
                type="button"
                className="button button-primary full-width"
                style={{ background: '#c54d2f', borderColor: '#c54d2f', borderRadius: 10, padding: '11px 16px', fontWeight: 700 }}
                onClick={() => {
                  repeatLastCustomization(repeatPromptItem)
                  setRepeatPromptItem(null)
                }}
              >
                <RotateCcw size={15} /> Repeat last
              </button>
            </div>
          </div>
        </section>
      </div>
    )}

    {/* Portion / Size Options Window (Opens when ADD is clicked for variational item) */}
    {variationModalItem && (
      <div className="modal-backdrop" style={{ zIndex: 1100 }} onMouseDown={(e) => { if (e.target === e.currentTarget) { setVariationModalItem(null); setError('') } }}>
        <section className="modal-card customize-food-modal" role="dialog" aria-modal="true">
          <div className="modal-heading">
            <div>
              <span className="eyebrow" style={{ color: '#c54d2f' }}>PORTION</span>
              <h2 style={{ fontSize: '1.25rem', margin: '4px 0 0' }}>Select portion for {variationModalItem.name}</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => { setVariationModalItem(null); setError('') }} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className="customize-food-body">
            {error && <div className="notice" style={{ margin: '0 0 12px', fontSize: '13px' }}>{error}</div>}

            <div className="variation-options-list" style={{ marginTop: 6 }}>
              {variationModalItem.variations?.map((v) => {
                const isSelected = selectedVariation?.name === v.name
                const disc = variationModalItem.discount_percent || 0
                const discountedVarPrice = disc ? Math.round((v.price_paise * (100 - disc)) / 100) : v.price_paise
                return (
                  <button
                    type="button"
                    key={v.name}
                    className={`variation-option-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectVariation(v)}
                  >
                    <div className="variation-option-left">
                      <span className="variation-radio-dot">{isSelected ? '●' : '○'}</span>
                      <span className="variation-name">{v.name}</span>
                    </div>
                    <span className="variation-price">
                      {formatINR(discountedVarPrice)}
                      {disc > 0 && <del style={{ marginLeft: 6, fontSize: '0.85em', opacity: 0.65 }}>{formatINR(v.price_paise)}</del>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="food-detail-footer">
            <div className="food-detail-price-breakdown">
              <span>TOTAL</span>
              <strong>{formatINR(variationModalTotalPrice)}</strong>
            </div>
            <button
              type="button"
              className="food-detail-footer-btn"
              onClick={confirmVariationAdd}
            >
              <Plus size={16} /> {activeVariationLineKey ? 'Update item' : 'Add to cart'}
            </button>
          </div>
        </section>
      </div>
    )}

    {/* Repeat Portion Prompt Window */}
    {repeatVariationPromptItem && (
      <div className="modal-backdrop" style={{ zIndex: 1200 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setRepeatVariationPromptItem(null) }}>
        <section className="modal-card repeat-custom-modal" role="dialog" aria-modal="true">
          <div className="modal-heading" style={{ paddingBottom: 6 }}>
            <div>
              <span className="eyebrow" style={{ color: '#c54d2f' }}>PORTION</span>
              <h2 style={{ fontSize: '1.2rem', margin: '4px 0 0' }}>Repeat last portion?</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => setRepeatVariationPromptItem(null)} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(() => {
              const saved = getLastVariation(repeatVariationPromptItem.id)
              return saved?.variation ? (
                <div style={{ background: '#faf9f6', padding: '10px 14px', borderRadius: '10px', border: '1px solid #ebe8e0', fontSize: '0.86rem', color: '#555d56' }}>
                  <strong style={{ color: '#29332f', display: 'block', marginBottom: 2 }}>Last selected:</strong>
                  {saved.variation.name} ({formatINR(saved.unit_price_paise)})
                </div>
              ) : null
            })()}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                className="button button-outline full-width"
                style={{ borderRadius: 10, padding: '11px 16px', fontWeight: 700 }}
                onClick={() => {
                  const it = repeatVariationPromptItem
                  setRepeatVariationPromptItem(null)
                  openVariationModal(it)
                }}
              >
                <Sparkles size={15} /> Make a second choice
              </button>
              <button
                type="button"
                className="button button-primary full-width"
                style={{ background: '#c54d2f', borderColor: '#c54d2f', borderRadius: 10, padding: '11px 16px', fontWeight: 700 }}
                onClick={() => {
                  repeatLastVariation(repeatVariationPromptItem)
                  setRepeatVariationPromptItem(null)
                }}
              >
                <RotateCcw size={15} /> Repeat last
              </button>
            </div>
          </div>
        </section>
      </div>
    )}
    {checkoutWarning && (
      <CenterDialog
        isOpen={Boolean(checkoutWarning)}
        onClose={() => setCheckoutWarning(null)}
        tone={checkoutWarning.tone || 'warning'}
        eyebrow={checkoutWarning.eyebrow}
        title={checkoutWarning.title}
        description={checkoutWarning.description}
        primaryAction={checkoutWarning.primaryAction}
        secondaryAction={checkoutWarning.secondaryAction}
      />
    )}
  </main>
}


