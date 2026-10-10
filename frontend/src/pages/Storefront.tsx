import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Edit3, Flame, Leaf, ListFilter, MapPin, Phone, Plus, ShieldCheck, ShoppingBag, Sparkles, Truck, Utensils, X, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE, api, formatINR, formatSavedAddress, getCustomItemLowestPrice, getMenuItemLowestPrice, type CustomMenuItem, type CustomMenuSectionOption, type MenuItem, type MenuItemVariation, type Order, type Restaurant, type SavedCartItem } from '../api'
import { useAuth } from '../state'
import { Button, EmptyState, Loading, Notice, QuantityPicker, RoundedSelect, RoundedTimePicker } from '../components'
import { launchCheckout, verifyRazorpayPayment } from '../payments'

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

function resolveImageUrl(url: string) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    const fileId = parsed.hostname === 'drive.google.com' ? parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get('id') : null
    return fileId ? `${API_BASE}/menu/images/${encodeURIComponent(fileId)}` : url
  } catch { return url }
}

export default function Storefront() {
  const { account } = useAuth()
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [category, setCategory] = useState('All')
  const [menuSearch, setMenuSearch] = useState('')
  const [menuSort, setMenuSort] = useState<'popular_desc' | 'popular_asc' | 'price_asc' | 'price_desc'>('popular_desc')
  const [sortOpen, setSortOpen] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [activeDetailItem, setActiveDetailItem] = useState<MenuItem | null>(null)
  const [editingCartLine, setEditingCartLine] = useState<CartLine | null>(null)
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
  const [success, setSuccess] = useState<Order | null>(null)
  const cartSync = useRef<Promise<void>>(Promise.resolve())
  const cartRetractTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const totalItems = useMemo(() => cart.reduce((total, line) => total + line.quantity, 0), [cart])
  const orderingClosed = restaurant !== null && !restaurant.accepting_orders

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

  useEffect(() => {
    Promise.all([
      api<MenuItem[]>('/menu'),
      api<CustomMenuItem[]>('/custom-menu'),
      api<Restaurant>('/restaurant'),
    ]).then(([items, customItems, config]) => {
      const mappedCustom: MenuItem[] = (customItems || []).map((ci) => {
        const lowestPaise = getCustomItemLowestPrice(ci)
        const discPercent = (ci as any).discount_percent || 0
        const discPricePaise = (ci as any).discounted_base_price_paise || null
        return {
          id: ci.id,
          name: ci.name,
          description: ci.description,
          category: ci.category || 'Specialty Rolls',
          category_id: ci.category_id || null,
          price_paise: lowestPaise,
          base_price_paise: ci.base_price_paise,
          discount_percent: discPercent,
          discounted_price_paise: discPricePaise,
          image_url: ci.image_urls?.[0] || ci.image_url || null,
          image_urls: ci.image_urls || [],
          is_vegetarian: ci.is_vegetarian,
          is_available: ci.is_available,
          is_featured: ci.is_featured,
          variations: [],
          is_custom: true,
          custom_menu_item_id: ci.id,
          custom_sections: ci.sections,
          discount_campaign_name: (ci as any).discount_campaign_name || null,
          popularity_count: (ci as any).popularity_count || 0,
        }
      })
      setMenu([...items, ...mappedCustom])
      setRestaurant(config)
    }).catch((err) => setError(err instanceof Error ? err.message : 'We could not load the menu.')).finally(() => setLoading(false))
  }, [])

  const cartLinesFromSaved = useCallback((saved: SavedCartItem[]) => saved.flatMap((savedItem) => {
    const item = menu.find((menuItem) => menuItem.id === savedItem.menu_item_id)
    return item && item.is_available ? [{ item, quantity: savedItem.quantity, lineKey: String(item.id), unit_price_paise: priceFor(item) }] : []
  }), [menu])

  useEffect(() => {
    if (account?.role !== 'USER') {
      setCart([])
      return
    }
    api<SavedCartItem[]>('/cart').then((saved) => setCart(cartLinesFromSaved(saved))).catch((err) => setError(err instanceof Error ? err.message : 'Could not restore your saved cart.'))
  }, [account?.id, account?.role, cartLinesFromSaved])

  useEffect(() => {
    if (!account || addressInitializedFor === account.id) return
    const saved = account.addresses?.find((item) => item.is_default && formatSavedAddress(item))
    if (saved) {
      setSelectedAddress(saved.id)
      setAddress(formatSavedAddress(saved))
    }
    setAddressInitializedFor(account.id)
  }, [account, addressInitializedFor])

  const categories = useMemo(() => ['All', ...new Set(menu.map((item) => item.category).filter(Boolean))], [menu])
  const priceFor = (item: MenuItem) => item.discounted_price_paise ?? (item.discount_percent ? Math.round(item.price_paise * (100 - item.discount_percent) / 100) : item.price_paise)
  const visibleMenu = useMemo(() => {
    const query = menuSearch.trim().toLocaleLowerCase()
    return menu.filter((item) => (category === 'All' || item.category === category) && (!query || `${item.name} ${item.description} ${item.category}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => menuSort === 'popular_desc' ? b.popularity_count - a.popularity_count : menuSort === 'popular_asc' ? a.popularity_count - b.popularity_count : menuSort === 'price_asc' ? priceFor(a) - priceFor(b) : priceFor(b) - priceFor(a))
  }, [category, menu, menuSearch, menuSort])

  const selectedLocation = useMemo(() => {
    if (!account?.addresses || !selectedAddress) return null
    return account.addresses.find((item) => item.id === selectedAddress) || null
  }, [account?.addresses, selectedAddress])

  useEffect(() => {
    if (!selectedLocation || selectedLocation.latitude == null || selectedLocation.longitude == null) {
      setDeliveryEstimate(null)
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
    }>(`/restaurant/delivery-estimate?latitude=${selectedLocation.latitude}&longitude=${selectedLocation.longitude}`)
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
          if (distKm > restaurant.free_delivery_radius_km) {
            const billableKm = distKm - restaurant.free_delivery_radius_km
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
  }, [selectedLocation, restaurant])

  const rawSubtotal = useMemo(() => cart.reduce((total, line) => {
    const unitPrice = line.unit_price_paise ?? priceFor(line.item)
    return total + unitPrice * line.quantity
  }, 0), [cart])

  const deliveryFee = deliveryEstimate
    ? (deliveryEstimate.raw_delivery_fee_paise ?? deliveryEstimate.delivery_fee_paise)
    : 0

  const rawPayable = rawSubtotal + deliveryFee
  const roundedPayableInr = Math.round(rawPayable / 100)
  const payable = roundedPayableInr * 100
  const roundOffPaise = payable - rawPayable
  const subtotal = rawSubtotal

  function openDetailModal(item: MenuItem, existingLine?: CartLine) {
    setActiveDetailItem(item)
    setModalImageIndex(0)
    if (existingLine) {
      setEditingCartLine(existingLine)
      setModalQuantity(existingLine.quantity)
      if (item.is_custom) {
        setSelectedVariation(null)
        const current: Record<string, CustomMenuSectionOption> = {}
        for (const sec of item.custom_sections || []) {
          const found = sec.options.find((opt) =>
            existingLine.customizations?.some((c) => c.name === opt.name),
          )
          if (found) {
            current[sec.name] = found
          } else if (sec.required !== false && sec.options && sec.options.length > 0) {
            current[sec.name] = sec.options[0]
          }
        }
        setSelectedOptions(current)
      } else if (item.variations && item.variations.length > 0) {
        setSelectedOptions({})
        const matched = existingLine.variation_name
          ? item.variations.find((v) => v.name.toLowerCase() === existingLine.variation_name?.toLowerCase())
          : null
        setSelectedVariation(matched || item.variations[0])
      } else {
        setSelectedOptions({})
        setSelectedVariation(null)
      }
    } else {
      setEditingCartLine(null)
      if (item.is_custom) {
        setModalQuantity(1)
        setSelectedVariation(null)
        const initial: Record<string, CustomMenuSectionOption> = {}
        for (const sec of item.custom_sections || []) {
          if (sec.required !== false && sec.options && sec.options.length > 0) {
            initial[sec.name] = sec.options[0]
          }
        }
        setSelectedOptions(initial)
      } else if (item.variations && item.variations.length > 0) {
        setModalQuantity(1)
        setSelectedOptions({})
        setSelectedVariation(item.variations[0])
      } else {
        const existingQty = cart.find((l) => l.lineKey === String(item.id))?.quantity || 1
        setModalQuantity(existingQty)
        setSelectedOptions({})
        setSelectedVariation(null)
      }
    }
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
    if (!activeDetailItem) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setActiveDetailItem(null)
        setEditingCartLine(null)
      } else if (e.key === 'ArrowLeft' && detailImages.length > 1) {
        setModalImageIndex((curr) => (curr + detailImages.length - 1) % detailImages.length)
      } else if (e.key === 'ArrowRight' && detailImages.length > 1) {
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
  }, [activeDetailItem, detailImages.length])

  const modalUnitPrice = useMemo(() => {
    if (!activeDetailItem) return 0
    const discount = activeDetailItem.discount_percent || 0
    if (activeDetailItem.is_custom) {
      const base = activeDetailItem.base_price_paise ?? 0
      const extra = Object.values(selectedOptions).reduce((sum, opt) => sum + (opt?.extra_paise || 0), 0)
      const rawTotal = base + extra
      return discount ? (rawTotal * (100 - discount)) / 100 : rawTotal
    }
    if (selectedVariation) {
      const rawPrice = selectedVariation.price_paise
      return discount ? (rawPrice * (100 - discount)) / 100 : rawPrice
    }
    return priceFor(activeDetailItem)
  }, [activeDetailItem, selectedOptions, selectedVariation])

  const modalTotalPrice = modalUnitPrice * modalQuantity

  function submitDetailModal() {
    if (!activeDetailItem || orderingClosed) return
    if (activeDetailItem.is_custom) {
      const missing = activeDetailItem.custom_sections?.filter(
        (s) => s.required !== false && !selectedOptions[s.name],
      )
      if (missing && missing.length > 0) {
        setError(`Please select an option for ${missing.map((s) => s.name).join(', ')}.`)
        return
      }
      const optionsList = Object.values(selectedOptions).filter(Boolean)
      const key = `custom-${activeDetailItem.id}-${optionsList.map((o) => `${o.name}:${o.extra_paise}`).sort().join('|')}`
      const unitPrice = modalUnitPrice

      setCart((old) => {
        if (editingCartLine) {
          return old.map((l) => {
            if (l.lineKey === editingCartLine.lineKey) {
              return {
                ...l,
                lineKey: key,
                customizations: optionsList,
                unit_price_paise: unitPrice,
                quantity: modalQuantity,
                custom_menu_item_id: activeDetailItem.custom_menu_item_id || activeDetailItem.id,
              }
            }
            return l
          })
        }
        const found = old.find((l) => l.lineKey === key)
        if (found) {
          return old.map((l) => l.lineKey === key ? { ...l, quantity: l.quantity + modalQuantity } : l)
        }
        return [
          ...old,
          {
            item: activeDetailItem,
            quantity: modalQuantity,
            customizations: optionsList,
            unit_price_paise: unitPrice,
            lineKey: key,
            custom_menu_item_id: activeDetailItem.custom_menu_item_id || activeDetailItem.id,
          },
        ]
      })
      revealCartSummary()
      setActiveDetailItem(null)
      setEditingCartLine(null)
    } else if (activeDetailItem.variations && activeDetailItem.variations.length > 0) {
      if (!selectedVariation) {
        setError('Please select a portion/variation.')
        return
      }
      const lineKey = `${activeDetailItem.id}-${selectedVariation.name}`
      const unitPrice = modalUnitPrice
      setCart((old) => {
        if (editingCartLine) {
          return old.map((l) => {
            if (l.lineKey === editingCartLine.lineKey) {
              return {
                ...l,
                lineKey,
                variation_name: selectedVariation.name,
                unit_price_paise: unitPrice,
                quantity: modalQuantity,
              }
            }
            return l
          })
        }
        const found = old.find((l) => l.lineKey === lineKey)
        if (found) {
          return old.map((l) => l.lineKey === lineKey ? { ...l, quantity: l.quantity + modalQuantity } : l)
        }
        return [
          ...old,
          {
            item: activeDetailItem,
            quantity: modalQuantity,
            variation_name: selectedVariation.name,
            unit_price_paise: unitPrice,
            lineKey,
          },
        ]
      })
      revealCartSummary()
      setActiveDetailItem(null)
      setEditingCartLine(null)
    } else {
      const lineKey = String(activeDetailItem.id)
      const unitPrice = modalUnitPrice
      setCart((old) => {
        const found = old.find((l) => l.lineKey === lineKey)
        if (found) {
          return old.map((l) => l.lineKey === lineKey ? { ...l, quantity: modalQuantity } : l)
        }
        return [...old, { item: activeDetailItem, quantity: modalQuantity, lineKey, unit_price_paise: unitPrice }]
      })
      if (account?.role === 'USER') {
        cartSync.current = cartSync.current.catch(() => undefined).then(async () => {
          const saved = await api<SavedCartItem[]>(`/cart/items/${activeDetailItem.id}`, { method: 'PUT', body: JSON.stringify({ quantity: modalQuantity }) })
          setCart(cartLinesFromSaved(saved))
        }).catch((err) => setError(err instanceof Error ? err.message : 'Could not save your cart.'))
      }
      revealCartSummary()
      setActiveDetailItem(null)
      setEditingCartLine(null)
    }
  }

  const setLineQuantity = useCallback((lineKey: string, quantity: number) => {
    if (orderingClosed) return
    revealCartSummary()
    setCart((old) => {
      if (!quantity) return old.filter((l) => l.lineKey !== lineKey)
      return old.map((l) => l.lineKey === lineKey ? { ...l, quantity } : l)
    })
  }, [orderingClosed])

  const setStandardQuantity = useCallback((item: MenuItem, quantity: number) => {
    if (orderingClosed) return
    const lineKey = String(item.id)
    revealCartSummary()
    setCart((old) => {
      const found = old.find((line) => line.lineKey === lineKey)
      if (!quantity) return old.filter((line) => line.lineKey !== lineKey)
      const unitPrice = priceFor(item)
      return found ? old.map((line) => line.lineKey === lineKey ? { ...line, quantity } : line) : [...old, { item, quantity, lineKey, unit_price_paise: unitPrice }]
    })
    if (account?.role !== 'USER') return
    cartSync.current = cartSync.current.catch(() => undefined).then(async () => {
      const saved = await api<SavedCartItem[]>(`/cart/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ quantity }) })
      setCart(cartLinesFromSaved(saved))
    }).catch((err) => setError(err instanceof Error ? err.message : 'Could not save your cart.'))
  }, [account?.role, cartLinesFromSaved, orderingClosed])

  const quantityFor = (itemId: number) => cart.filter((line) => line.item.id === itemId).reduce((sum, line) => sum + line.quantity, 0)

  async function placeOrder() {
    if (!account) {
      setError('Sign in or create a customer account to place an order.')
      return
    }
    const deliveryLocation = account.addresses?.find((item) => item.id === selectedAddress)
    if (!cart.length || !address.trim()) {
      setError('Add something delicious and enter your delivery address to continue.')
      return
    }
    if (deliveryLocation?.latitude == null || deliveryLocation.longitude == null) {
      setError('Pin the exact delivery location on the map before placing your order.')
      return
    }
    if (subtotal < (restaurant?.minimum_order_paise || 0)) {
      setError(`A little more flavor: minimum order is ${formatINR(restaurant?.minimum_order_paise || 0)}.`)
      return
    }
    if (deliveryEstimate && !deliveryEstimate.within_radius) {
      setError(`Delivery location is ${deliveryEstimate.distance_km} km away, which exceeds our maximum delivery radius of ${deliveryEstimate.max_radius_km} km.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((line) => ({
            menu_item_id: line.custom_menu_item_id ? null : line.item.id,
            custom_menu_item_id: line.custom_menu_item_id || null,
            variation_name: line.variation_name || null,
            quantity: line.quantity,
            customizations: line.customizations || [],
          })),
          payment_method: paymentMethod,
          address: address.trim(), latitude: deliveryLocation.latitude, longitude: deliveryLocation.longitude, notes: notes.trim(),
          scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        }),
      })
      if (paymentMethod === 'RAZORPAY' && order.checkout) {
        await launchCheckout(order.checkout, {
          onPaid: async (payment) => {
            try {
              await verifyRazorpayPayment(payment)
              setSuccess({ ...order, payment_status: 'PAID' })
              setCart([])
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Payment verification is still pending.')
              setSuccess(order)
              setCart([])
            }
          },
          onDismiss: () => { setSuccess(order); setCart([]) },
          onError: (err) => setError(err.message),
        })
        return
      }
      setSuccess(order)
      setCart([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not place your order. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function goToMenu() { document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }) }

  if (loading) return <div className="store-loading"><Loading label="Lighting the grill…" /></div>
  if (success) return <main className="order-success-wrap"><section className="order-success"><div className="success-check"><Check size={29} /></div><div className="eyebrow">ORDER {success.payment_method === 'RAZORPAY' && success.payment_status !== 'PAID' ? 'SAVED · PAYMENT PENDING' : 'IT’S ON THE WAY'}</div><h1>{success.payment_method === 'RAZORPAY' && success.payment_status !== 'PAID' ? 'Your ticket is saved.' : 'That’s a wrap.'}</h1><p>{success.payment_method === 'RAZORPAY' && success.payment_status !== 'PAID' ? 'We saved your order, but payment has not been confirmed. Open My orders to finish payment or check its status.' : 'Your order is with the grill team. We’ll keep you posted as it makes its way to you.'}</p><div className="success-order-number"><span>ORDER NUMBER</span><strong>{success.order_id}</strong></div><div className="success-order-meta"><span><Clock3 size={15} /> Track it as it makes its way to you</span><span><ShieldCheck size={15} /> {success.payment_status === 'PAID' ? 'Payment secured' : success.payment_method === 'CASH' ? 'Cash on delivery' : 'Payment not confirmed'}</span></div><Link className="button button-dark" to={account ? '/orders' : '/'}>{success.payment_method === 'RAZORPAY' && success.payment_status !== 'PAID' ? 'Finish payment' : 'Track your order'} <ArrowRight size={16} /></Link><button className="text-button success-back" onClick={() => setSuccess(null)}>Back to the menu</button></section><div className="success-decoration">🥙</div></main>

  return <main className="storefront">
    <section className="hero-section">
      <div className="hero-copy"><div className="hero-kicker"><span className="hero-kicker-icon"><Flame size={15} fill="currentColor" /></span> SLOW FIRE. BIG FLAVOR.</div><h1>Big on flavor.<br />Never <em>on the fence.</em></h1><p className="hero-description">Big, bold flavors and ridiculously good kebabs, made fresh when you order.</p><div className="hero-actions"><Button onClick={goToMenu}>Explore the menu <ArrowDown size={16} /></Button><div className="hero-delivery"><span className="hero-delivery-icon"><Truck size={17} /></span><span><strong>Order updates along the way</strong><small>From our kitchen to your door</small></span></div></div><div className="hero-social-proof"><div className="social-rating"><span>✦</span><b>Made to order</b></div><div className="social-divider" /><span>Freshly prepared</span><span className="social-separator">·</span><span>Made with care</span></div></div>
      <div className="hero-art"><div className="hero-art-bg" /><div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" /><div className="hero-food-main"><span className="hero-food-glow" /><span className="hero-food-emoji">🥙</span><span className="hero-food-herbs">✳ &nbsp;✦ &nbsp;✳</span></div><div className="hero-note hero-note-top"><span className="hero-note-star">✦</span><span>Fire-kissed<br /><strong>to perfection</strong></span></div><div className="hero-note hero-note-bottom"><span className="mini-avatar">Z</span><span><strong>Made fresh</strong><br />Just for you</span><Sparkles className="note-spark" size={17} /></div><span className="hero-art-doodle doodle-one">✷</span><span className="hero-art-doodle doodle-two">✳</span></div>
      <div className="hero-bottomline"><span>01 <i /> GOOD FOOD, GREAT NEIGHBORS</span><span className="hero-bottom-address"><MapPin size={13} /> {restaurant?.address || 'Add your restaurant address'}</span><span>SCROLL TO TASTE <ArrowDown size={13} /></span></div>
    </section>

    <section className="value-strip"><div><span className="value-icon"><Flame size={19} /></span><span><strong>Charcoal, always</strong><small>Real fire. No shortcuts.</small></span></div><div><span className="value-icon"><Leaf size={19} /></span><span><strong>Fresh, never frozen</strong><small>Made when you order.</small></span></div><div><span className="value-icon"><Truck size={19} /></span><span><strong>Quick to your door</strong><small>Hot food. Happy you.</small></span></div><div><span className="value-icon"><Utensils size={19} /></span><span><strong>Made with care</strong><small>Recipes worth sharing.</small></span></div></section>

    <section className="menu-section" id="menu"><div className="menu-intro"><div><h2>Menu</h2><p>Choose what you’d like to order.</p></div><div className="menu-count"><span className="menu-count-dot" /> {menu.length} items</div></div>
      {error && <Notice onDismiss={() => setError('')}>{error}</Notice>}
      {orderingClosed && <Notice tone="info">We’re taking a short breather. Ordering will be back soon.</Notice>}
      <div className="menu-tabs">{categories.map((name) => <button className={`menu-tab ${category === name ? 'active' : ''}`} key={name} onClick={() => setCategory(name)}>{name}</button>)}</div>
      <div className="menu-discovery-controls"><label className="menu-search"><Search size={17} /><input type="search" aria-label="Search menu" value={menuSearch} onChange={(event) => setMenuSearch(event.target.value)} placeholder="Search dishes or categories" /></label><div className="menu-sort-label"><button type="button" className="menu-sort-trigger" aria-label="Sort menu" aria-expanded={sortOpen} onClick={() => setSortOpen((open) => !open)}><ListFilter size={16} /><span>{({ popular_desc: 'Popularity · high to low', popular_asc: 'Popularity · low to high', price_asc: 'Price · low to high', price_desc: 'Price · high to low' } as const)[menuSort]}</span><ChevronDown size={15} /></button>{sortOpen && <div className="menu-sort-options" role="menu">{([['popular_desc', 'Popularity · high to low'], ['popular_asc', 'Popularity · low to high'], ['price_asc', 'Price · low to high'], ['price_desc', 'Price · high to low']] as const).map(([value, label]) => <button type="button" role="menuitemradio" aria-checked={menuSort === value} className={menuSort === value ? 'active' : ''} key={value} onClick={() => { setMenuSort(value); setSortOpen(false) }}>{label}</button>)}</div>}</div></div>
      {visibleMenu.length ? <div className={`food-grid ${orderingClosed ? 'food-grid-closed' : ''}`}>{visibleMenu.map((item, index) => <article className={`food-card ${item.is_featured ? 'food-featured' : ''} ${orderingClosed ? 'food-card-unavailable' : ''}`} key={item.id} onClick={() => openDetailModal(item)}>
        <div className={`food-image ${colors[(index + item.id) % colors.length]}`}>
          {item.image_urls?.length || item.image_url ? (
            <div className="food-image-main-wrap">
              <img
                src={resolveImageUrl((item.image_urls?.length ? item.image_urls[0] : item.image_url) || '')}
                alt={item.name}
                loading="lazy"
              />
              {(item.image_urls?.length || 0) > 1 && (
                <span className="menu-photo-multi-badge" title={`${item.image_urls.length} photos · Click to view`}>
                  <span>{item.image_urls.length}</span>
                </span>
              )}
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
          <div className="food-card-category">{item.category}</div>
          <h3>{item.name}</h3>
          <p>{item.description}</p>
          <div className="food-card-bottom" onClick={(event) => event.stopPropagation()}>
            <strong>
              {item.is_custom || (item.variations && item.variations.length > 0) ? (
                `From ${formatINR(getMenuItemLowestPrice(item))}`
              ) : (
                <>{formatINR(item.discounted_price_paise ?? (item.discount_percent ? Math.round(item.price_paise * (100 - item.discount_percent) / 100) : item.price_paise))}{(item.discount_percent || item.discounted_price_paise) && <del>{formatINR(item.price_paise)}</del>}</>
              )}
            </strong>
            {orderingClosed ? (
              <span className="closed-menu-label">Currently unavailable</span>
            ) : item.is_custom && item.custom_sections && item.custom_sections.length > 0 ? (
              <button className="add-food customize-btn" onClick={() => openDetailModal(item)} aria-label={`Customize ${item.name}`}><Sparkles size={13} /> {quantityFor(item.id) > 0 ? `CUSTOMIZE (${quantityFor(item.id)})` : 'CUSTOMIZE'}</button>
            ) : item.variations && item.variations.length > 0 ? (
              <button className="add-food customize-btn" onClick={() => openDetailModal(item)} aria-label={`Choose portion for ${item.name}`}><Utensils size={13} /> {quantityFor(item.id) > 0 ? `CHOOSE (${quantityFor(item.id)})` : 'CHOOSE'}</button>
            ) : quantityFor(item.id) ? (
              <QuantityPicker small quantity={quantityFor(item.id)} onChange={(quantity) => setStandardQuantity(item, quantity)} />
            ) : (
              <button className="add-food" onClick={() => setStandardQuantity(item, 1)} aria-label={`Add ${item.name}`}><Plus size={15} /> ADD</button>
            )}
          </div>
        </div>
      </article>)}</div> : <EmptyState icon={<Utensils size={20} />} title="The menu’s getting warmed up" description="Ask your restaurant admin to publish a few delicious items." />}
    </section>

    <section className="story-banner"><div className="story-mark"><Flame size={25} /></div><div><div className="eyebrow light-eyebrow">THE ZILLA WAY</div><h2>Good food is meant<br />to bring people <em>closer.</em></h2><p>From our charcoal grill to your table, every bite starts with the good stuff.</p></div><div className="story-seal"><span>100%</span><small>GOOD<br />TASTE</small><span>✦</span></div><div className="story-pattern">✳ &nbsp;· &nbsp;✦ &nbsp;· &nbsp;✳</div></section>
    <section className="store-bottom"><div><div className="eyebrow">COME BY, SAY HI</div><h2>Or let us bring it <em>to your table.</em></h2><div className="store-bottom-details">{restaurant?.address ? (<a href={restaurant.latitude != null && restaurant.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${restaurant.latitude},${restaurant.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.address)}`} target="_blank" rel="noreferrer" className="store-address-link" title="Open exact location in Google Maps" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}><MapPin size={15} /> <span>{restaurant.address}</span></a>) : (<span>Restaurant location has not been added yet.</span>)}{((restaurant?.phones && restaurant.phones.length > 0) ? restaurant.phones : (restaurant?.phone ? restaurant.phone.split(',').map((p) => p.trim()).filter(Boolean) : [])).map((phoneNum, idx) => (<span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Phone size={15} /> <a href={`tel:${phoneNum}`} style={{ color: 'inherit', textDecoration: 'none' }}>{phoneNum}</a></span>))}</div></div>{restaurant?.latitude != null && restaurant.longitude != null ? <a className="store-bottom-map" href={`https://www.google.com/maps/search/?api=1&query=${restaurant.latitude},${restaurant.longitude}`} target="_blank" rel="noreferrer"><span className="map-mini"><MapPin size={26} /></span><span><strong>Find KebabZilla</strong><small>Open directions in Maps</small></span><ArrowRight size={17} /></a> : <div className="store-bottom-map"><span className="map-mini"><MapPin size={26} /></span><span><strong>Location details</strong><small>Pin location coming soon</small></span></div>}</section>

    {cartOpen && <div className="cart-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}><aside className="cart-panel" aria-label="Your basket" onMouseDown={(event) => event.stopPropagation()}><div className="cart-panel-scroll"><div className="cart-header"><div><span className="cart-icon"><ShoppingBag size={17} /></span><span><strong>Your order</strong><small>{totalItems} delicious thing{totalItems === 1 ? '' : 's'}</small></span></div><button className="cart-close" aria-label="Close cart" onClick={() => setCartOpen(false)}><X size={17} /></button></div>{cart.length ? <><div className="cart-items">{cart.map((line) => { const unitPrice = line.unit_price_paise ?? priceFor(line.item); const customSummary = (line.customizations || []).map((o) => o.name).join(', '); const hasVariations = (line.item.variations?.length || 0) > 0; return <div className="cart-line" key={line.lineKey}><span className="cart-line-name">{line.item.name}{line.variation_name && <small className="cart-custom-desc">Portion: {line.variation_name}</small>}{customSummary && <small className="cart-custom-desc">{customSummary}</small>}{(line.item.is_custom || hasVariations) && <button type="button" className="cart-edit-link" onClick={() => openDetailModal(line.item, line)} aria-label={`Edit ${line.item.name}`}><Edit3 size={11} /> {line.item.is_custom ? 'Edit customization' : 'Change portion'}</button>}<small>{formatINR(unitPrice)} each</small></span><QuantityPicker small quantity={line.quantity} onChange={(next) => setLineQuantity(line.lineKey, next)} /><strong>{formatINR(unitPrice * line.quantity)}</strong></div> })}</div>
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
                    <span style={{ color: '#2b7a4b', fontWeight: 800 }}>Free</span>
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
        <label className="field-label">
          Anything we should know? <span className="field-optional">optional</span>
          <input maxLength={500} placeholder="No onions, extra chutney…" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className={`checkout-timing-row ${scheduledFor ? 'two-col' : 'single-col'}`}>
          <label className="field-label">
            Order timing
            <RoundedSelect
              value={scheduledFor ? "later" : "now"}
              onChange={(val) => {
                if (val === "later") {
                  const defaultSlot = permissibleTimeSlots[0]?.value || '18:00';
                  const todayStr = new Date().toISOString().slice(0, 10);
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
                  const todayStr = new Date().toISOString().slice(0, 10);
                  setScheduledFor(`${todayStr}T${timeVal}`);
                }}
              />
            </label>
          )}
        </div>
        <div className="payment-choices">
          <button className={paymentMethod === 'RAZORPAY' ? 'selected' : ''} onClick={() => setPaymentMethod('RAZORPAY')}>
            <span className="radio-dot" /> Pay online
          </button>
          <button className={paymentMethod === 'CASH' ? 'selected' : ''} onClick={() => setPaymentMethod('CASH')}>
            <span className="radio-dot" /> Cash on delivery
          </button>
        </div>
        {error && <Notice>{error}</Notice>}
        <Button className="checkout-button" disabled={busy || !restaurant?.accepting_orders} onClick={placeOrder}>
          {busy ? 'Just a second…' : <>Place order · {formatINR(payable)} <ArrowRight size={16} /></>}
        </Button>
        <div className="checkout-secure">
          <ShieldCheck size={14} /> {paymentMethod === 'RAZORPAY' ? 'Secure checkout by Razorpay' : 'Pay when your food arrives'}
        </div>
      </div> : <div className="cart-signin"><p>One tiny step before the first bite.</p><Link className="button button-dark" to="/login">Sign in to check out <ArrowRight size={16} /></Link><span>New here? <Link to="/register">Create an account</Link></span></div>}
      {subtotal < (restaurant?.minimum_order_paise || 0) && <div className="minimum-note">Add {formatINR((restaurant?.minimum_order_paise || 0) - subtotal)} to meet our minimum.</div>}
      </> : <div className="cart-empty"><p>Your cart is empty.</p><button className="text-button" onClick={() => { setCartOpen(false); document.querySelector('.menu-section')?.scrollIntoView({ behavior: 'smooth' }) }}>Browse the menu</button></div>}</div></aside></div>}
    {cart.length > 0 && <button className={`floating-cart visible ${cartExpanded ? 'expanded' : 'compact'}`} onClick={() => setCartOpen(true)} aria-label={`Open cart, ${totalItems} item${totalItems === 1 ? '' : 's'}, total ${formatINR(payable)}`}><span className="cart-summary-icon"><ShoppingBag size={18} /></span><span className="cart-summary-copy"><strong>{totalItems} item{totalItems === 1 ? '' : 's'} added</strong><small>Tap to review your order</small></span><span className="cart-summary-total"><small>ORDER TOTAL</small><strong>{formatINR(payable)}</strong></span><ArrowRight size={17} /></button>}

    {activeDetailItem && (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActiveDetailItem(null); setEditingCartLine(null) } }}>
        <section className="modal-card food-detail-modal" role="dialog" aria-modal="true">
          <div className="food-detail-topbar">
            <div className="food-detail-tags">
              <span className="food-detail-cat-badge">{activeDetailItem.category || "Menu"}</span>
              {activeDetailItem.is_custom && <span className="custom-dish-badge-pill">Build Your Own</span>}
              {activeDetailItem.variations && activeDetailItem.variations.length > 0 && <span className="custom-dish-badge-pill">Portion Options</span>}
              <span className={`diet-dot ${activeDetailItem.is_vegetarian ? 'veg' : 'nonveg'}`} title={activeDetailItem.is_vegetarian ? 'Vegetarian' : 'Non-vegetarian'}>
                {activeDetailItem.is_vegetarian ? <Leaf size={11} /> : <span />}
              </span>
            </div>
            <button className="icon-button food-detail-close" type="button" onClick={() => { setActiveDetailItem(null); setEditingCartLine(null) }} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className="food-detail-scroll-wrap">
            <div className="food-detail-square-img-box">
              {detailImages.length > 0 ? (
                <img
                  src={detailImages[modalImageIndex % detailImages.length]}
                  alt={`${activeDetailItem.name} photo`}
                  className="food-detail-hero-img"
                />
              ) : (
                <div className="food-detail-no-img">
                  <span className="food-detail-emoji">{activeDetailItem.is_vegetarian ? "🥬" : "🍢"}</span>
                </div>
              )}

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
                    <ChevronLeft size={22} />
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
                    <ChevronRight size={22} />
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
            </div>

            <div className="food-detail-info-block">
              <div className="food-detail-header-row">
                <h2>{activeDetailItem.name}</h2>
                <div className="food-detail-price">
                  <strong>{formatINR(modalUnitPrice)}</strong>
                  {!activeDetailItem.is_custom && !selectedVariation && (activeDetailItem.discount_percent || activeDetailItem.discounted_price_paise) && (
                    <del>{formatINR(activeDetailItem.price_paise)}</del>
                  )}
                </div>
              </div>

              {activeDetailItem.description && (
                <p className="food-detail-desc">{activeDetailItem.description}</p>
              )}

              {activeDetailItem.variations && activeDetailItem.variations.length > 0 && (
                <div className="customize-sections-list">
                  <div className="customize-section-group">
                    <div className="customize-section-title">
                      <strong>Select Portion / Size</strong>
                      <span className="customize-tag-required">Required</span>
                    </div>
                    <div className="customize-options-grid">
                      {activeDetailItem.variations.map((v) => {
                        const isSelected = selectedVariation?.name === v.name
                        const disc = activeDetailItem.discount_percent || 0
                        const discountedVarPrice = disc ? (v.price_paise * (100 - disc)) / 100 : v.price_paise
                        return (
                          <button
                            type="button"
                            key={v.name}
                            className={`customize-option-pill ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedVariation(v)}
                          >
                            <span className="customize-radio-dot">{isSelected ? '●' : '○'}</span>
                            <span className="customize-opt-name">{v.name}</span>
                            <span className="customize-opt-price">
                              {formatINR(discountedVarPrice)}
                              {disc > 0 && <del style={{ marginLeft: 5, fontSize: '0.85em', opacity: 0.65 }}>{formatINR(v.price_paise)}</del>}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {activeDetailItem.is_custom && activeDetailItem.custom_sections && activeDetailItem.custom_sections.length > 0 && (
                <div className="customize-sections-list">
                  {activeDetailItem.custom_sections.map((section) => (
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
                              onClick={() => {
                                if (isSelected && section.required === false) {
                                  setSelectedOptions((prev) => {
                                    const next = { ...prev }
                                    delete next[section.name]
                                    return next
                                  })
                                } else {
                                  setSelectedOptions((prev) => ({ ...prev, [section.name]: opt }))
                                }
                              }}
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
              )}

              <div className="food-detail-qty-picker-row">
                <span>Quantity</span>
                <QuantityPicker
                  quantity={modalQuantity}
                  onChange={(q) => setModalQuantity(Math.max(1, q))}
                />
              </div>
            </div>
          </div>

          <div className="food-detail-footer">
            <div className="food-detail-price-breakdown">
              <span>Total</span>
              <strong>{formatINR(modalTotalPrice)}</strong>
            </div>
            <Button onClick={submitDetailModal} disabled={orderingClosed}>
              {editingCartLine
                ? <>Save changes · {formatINR(modalTotalPrice)} <ArrowRight size={15} /></>
                : <>Add to order · {formatINR(modalTotalPrice)} <ArrowRight size={15} /></>}
            </Button>
          </div>
        </section>
      </div>
    )}
  </main>
}


