import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronUp, Clock3, Flame, MapPin, Phone, RefreshCw, ShieldCheck, ShoppingBag, Truck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api, formatINR, formatStatus, friendlyDate, type MenuItem, type Order, type Restaurant, type SavedCartItem } from '../api'
import { PageTitle, Button, EmptyState, Loading, MenuImageCarousel, Notice, Pagination, StatusBadge } from '../components'
import { launchCheckout, verifyRazorpayPayment } from '../payments'

const trackerSteps = [
  { key: 'PLACED', label: 'Order received' },
  { key: 'ACCEPTED', label: 'Accepted & preparing' },
  { key: 'READY', label: 'Ready for delivery' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
]

function getProgressIndex(status: string): number {
  if (status === 'PLACED') return 0
  if (status === 'ACCEPTED' || status === 'PREPARING') return 1
  if (status === 'READY') return 2
  if (status === 'OUT_FOR_DELIVERY') return 3
  if (status === 'DELIVERED') return 4
  return -1
}

export default function OrdersPage() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyOrder, setBusyOrder] = useState<string | null>(null)
  const [busyReorder, setBusyReorder] = useState<string | null>(null)
  const [restaurantPhone, setRestaurantPhone] = useState('+919876543210')
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({})

  const toggleExpand = (orderId: string, defaultExpanded: boolean) => {
    setExpandedOrders((prev) => ({
      ...prev,
      [orderId]: !(prev[orderId] ?? defaultExpanded),
    }))
  }

  const handleOrderAgain = async (order: Order) => {
    if (!order.items || !order.items.length) return
    setBusyReorder(order.order_id)
    setError('')
    try {
      let menuItems: MenuItem[] = []
      try {
        const cached = localStorage.getItem('kz_storefront_menu')
        if (cached) menuItems = JSON.parse(cached)
      } catch {}
      if (!menuItems.length) {
        menuItems = await api<MenuItem[]>('/menu').catch(() => [])
      }

      const existingCart = await api<SavedCartItem[]>('/cart').catch(() => [])

      const itemsToAdd: any[] = order.items
        .filter((line) => line.menu_item_id != null || (line as any).custom_menu_item_id != null)
        .map((line) => ({
          menu_id: line.menu_item_id || (line as any).custom_menu_item_id,
          variation_name: (line as any).variation_name || null,
          quantity: line.quantity || 1,
          unit_price_paise: (line as any).unit_price_paise ?? line.price_paise,
          customizations: line.customizations || [],
        }))

      if (!itemsToAdd.length) {
        throw new Error('No items in this order could be reordered.')
      }

      const merged = [...existingCart]
      for (const item of itemsToAdd) {
        const match = merged.find((ex: any) => {
          const aId = ex.menu_id || ex.menu_item_id
          const bId = item.menu_id
          if (aId !== bId) return false
          if ((ex.variation_name || null) !== (item.variation_name || null)) return false
          const aCust = (ex.customizations || []).map((c: any) => `${c.name}:${c.extra_paise || 0}`).sort().join('|')
          const bCust = (item.customizations || []).map((c: any) => `${c.name}:${c.extra_paise || 0}`).sort().join('|')
          return aCust === bCust
        })
        if (match) {
          match.quantity = Math.min(99, match.quantity + item.quantity)
        } else {
          merged.push(item)
        }
      }

      await api('/cart', {
        method: 'PUT',
        body: JSON.stringify(merged),
      })

      if (menuItems.length > 0) {
        const localCartLines = merged.flatMap((savedItem: any) => {
          const itemId = savedItem.menu_id || savedItem.menu_item_id
          const menuItem = menuItems.find((m) => m.id === itemId)
          if (!menuItem || !menuItem.is_available) return []
          const customizations = savedItem.customizations || []
          const unitPrice = savedItem.unit_price_paise ?? menuItem.price_paise
          const lineKey = customizations.length > 0
            ? `custom-${menuItem.id}-${customizations.map((o: any) => `${o.name}:${o.extra_paise || 0}`).sort().join('|')}`
            : savedItem.variation_name
              ? `${menuItem.id}-${savedItem.variation_name}`
              : String(menuItem.id)
          return [{
            item: menuItem,
            quantity: savedItem.quantity,
            customizations,
            variation_name: savedItem.variation_name || undefined,
            unit_price_paise: unitPrice,
            lineKey,
            custom_menu_item_id: menuItem.is_custom ? menuItem.id : undefined,
          }]
        })
        if (localCartLines.length > 0) {
          try {
            localStorage.setItem('kz_active_cart', JSON.stringify(localCartLines))
          } catch {}
        }
      }

      navigate('/?cart=open')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder items.')
      setBusyReorder(null)
    }
  }

  useEffect(() => {
    api<Restaurant>('/restaurant')
      .then((data) => {
        const primary = (data.phones && data.phones.length > 0 && data.phones[0])
          ? data.phones[0]
          : (data.phone ? data.phone.split(',')[0].trim() : '+919876543210')
        if (primary) setRestaurantPhone(primary)
      })
      .catch(() => undefined)
  }, [])

  const pageSize = 10
  const [page, setPage] = useState(0)
  const [totalOrders, setTotalOrders] = useState(0)

  const refresh = useCallback((targetPage = page) => {
    return api<any>(`/orders?limit=${pageSize}&offset=${targetPage * pageSize}`)
      .then((res) => {
        if (Array.isArray(res)) {
          setOrders(res.slice(0, pageSize))
          setTotalOrders(res.length)
        } else {
          setOrders(res.items || [])
          setTotalOrders(res.total || 0)
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your orders.'))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 20000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function cancel(order: Order) {
    setBusyOrder(order.order_id)
    setError('')
    try {
      const updated = await api<Order>(`/orders/${order.order_id}/cancel`, { method: 'POST' })
      setOrders((previous) => previous.map((item) => item.order_id === updated.order_id ? updated : item))
    } catch (err) { setError(err instanceof Error ? err.message : `Orders in preparation cannot be cancelled online. Please call the restaurant directly at ${restaurantPhone}.`) }
    finally { setBusyOrder(null) }
  }

  async function payNow(order: Order) {
    setBusyOrder(order.order_id)
    setError('')
    try {
      const checkout = await api<NonNullable<Order['checkout']>>(`/orders/${order.order_id}/payment-session`, { method: 'POST' })
      await launchCheckout(checkout, {
        onPaid: async (payment) => {
          await verifyRazorpayPayment(payment)
          await refresh()
        },
        onDismiss: () => setError(`Payment for ${order.order_id} was not completed. You can try again here.`),
        onError: (err) => setError(err.message),
      })
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open secure checkout.') }
    finally { setBusyOrder(null) }
  }

  if (loading) return <main className="customer-page"><Loading label="Finding your orders…" /></main>
  return <main className="customer-page">
    <PageTitle eyebrow="YOUR TABLE, ANYTIME" title="My orders" description="A little something delicious is always worth keeping track of." action={<Button variant="secondary" onClick={() => { setLoading(true); void refresh() }}><RefreshCw size={15} /> <span>Refresh</span></Button>} />
    {error && <Notice>{error}</Notice>}
    {!orders.length ? (
      <EmptyState icon={<ShoppingBag size={21} />} title="Nothing on the table yet" description="Your first KebabZilla order is just a few good choices away." action={<Link className="button button-dark" to="/">Explore the menu <ArrowRight size={16} /></Link>} />
    ) : (
      <>
        <div className="customer-order-list">
          {orders.map((order) => {
            const currentIndex = getProgressIndex(order.status)
            const terminal = order.status === 'REJECTED' || order.status === 'CANCELLED'
            const defaultExpanded = order.status !== 'DELIVERED' && !terminal
            const isExpanded = expandedOrders[order.order_id] ?? defaultExpanded

            return (
              <article className={`customer-order-card ${!isExpanded ? 'is-collapsed' : ''}`} key={order.order_id}>
                <div
                  className="customer-order-top"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpand(order.order_id, defaultExpanded)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleExpand(order.order_id, defaultExpanded)
                    }
                  }}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  aria-expanded={isExpanded}
                >
                  <div>
                    <span className="customer-order-kicker">
                      ORDER PLACED · {friendlyDate(order.created_at)}
                      {!isExpanded && (
                        <span className="customer-order-collapsed-meta">
                          {' '}· {order.items.length} {order.items.length === 1 ? 'item' : 'items'} · {formatINR(order.total_paise)}
                        </span>
                      )}
                    </span>
                    <h2>{order.order_id}</h2>
                  </div>
                  <div className="customer-order-top-right">
                    <StatusBadge status={order.status} />
                    {!isExpanded && (order.status === 'DELIVERED' || terminal) && (
                      <button
                        type="button"
                        className="reorder-link-compact"
                        disabled={busyReorder === order.order_id}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleOrderAgain(order)
                        }}
                      >
                        {busyReorder === order.order_id ? 'Adding…' : 'Order again'} <ArrowRight size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="order-chevron-btn"
                      aria-label={isExpanded ? 'Collapse order details' : 'Expand order details'}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpand(order.order_id, defaultExpanded)
                      }}
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <>
                    {!terminal && (
                      <div className="order-progress">
                        {trackerSteps.map((step, index) => {
                          const done = index < currentIndex || (order.status === 'DELIVERED' && step.key === 'DELIVERED')
                          return (
                            <div
                              className={`progress-step ${done ? 'done' : ''} ${index === currentIndex && order.status !== 'DELIVERED' ? 'current' : ''}`}
                              key={step.key}
                            >
                              <span className="progress-dot">{done ? <Check size={11} /> : null}</span>
                              <span>{step.label}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {terminal && (
                      <Notice tone="info">
                        {order.status === 'CANCELLED' && order.payment_status === 'REFUND_PENDING' ? (
                          'Your order was cancelled. The Razorpay refund has been started and is processing.'
                        ) : (
                          <>
                            This order was {order.status.toLowerCase()}. If you need help, call the restaurant at{' '}
                            <a href={`tel:${restaurantPhone}`} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
                              {restaurantPhone}
                            </a>
                            .
                          </>
                        )}
                      </Notice>
                    )}
                    <div className="customer-order-body">
                      <div className="customer-order-items">
                        {order.items.map((line) => (
                          <div className="customer-order-line" key={`${line.menu_item_id}-${line.name}`}>
                            {(line.image_urls?.length || line.image_url) && (
                              <span className="customer-order-line-art">
                                <MenuImageCarousel
                                  images={line.image_urls?.length ? line.image_urls : line.image_url ? [line.image_url] : []}
                                  alt={line.name}
                                  className="menu-gallery-order"
                                  showBadge={false}
                                />
                              </span>
                            )}
                            <span className="customer-order-line-name">
                              {line.quantity}<i>×</i>{line.name}
                            </span>
                            <strong>{formatINR(line.line_total_paise)}</strong>
                          </div>
                        ))}
                        <div className="customer-order-total">
                          <span>Total <small>· incl. taxes & delivery</small></span>
                          <strong>{formatINR(order.total_paise)}</strong>
                        </div>
                      </div>
                      <div className="customer-order-side">
                        <div>
                          <span className="order-side-icon"><MapPin size={15} /></span>
                          <span>
                            <small>Order type</small>
                            <strong>{order.order_type === 'PICKUP' ? 'Restaurant pickup' : 'Delivery order'}</strong>
                          </span>
                        </div>
                        <div>
                          <span className="order-side-icon"><ShieldCheck size={15} /></span>
                          <span>
                            <small>{order.payment_method === 'CASH' ? 'Payment' : 'Online payment'}</small>
                            <strong>{order.payment_method === 'CASH' ? 'Cash on delivery' : (formatStatus(order.payment_status) || 'Pending')}</strong>
                          </span>
                        </div>
                        {order.status === 'OUT_FOR_DELIVERY' && (
                          <div className="delivery-note">
                            <Truck size={15} />
                            <span>{order.delivery_name ? `${order.delivery_name} picked your order.` : 'Your grill-fresh order is on its way.'}</span>
                            {order.delivery_phone && (
                              <a
                                href={`tel:${order.delivery_phone}`}
                                className="rider-call-btn"
                                title={order.delivery_name ? `Call ${order.delivery_name}` : 'Call delivery rider'}
                                aria-label={order.delivery_name ? `Call ${order.delivery_name}` : 'Call delivery rider'}
                              >
                                <Phone size={13} fill="currentColor" />
                              </a>
                            )}
                          </div>
                        )}
                        {order.scheduled_for && (
                          <div>
                            <span className="order-side-icon"><Clock3 size={15} /></span>
                            <span>
                              <small>Scheduled for</small>
                              <strong>{friendlyDate(order.scheduled_for)}</strong>
                            </span>
                          </div>
                        )}
                        {order.status === 'OUT_FOR_DELIVERY' && order.delivery_otp && (
                          <div className="customer-delivery-otp">
                            <ShieldCheck size={17} />
                            <span>
                              <small>YOUR DELIVERY CODE</small>
                              <strong>{order.delivery_otp}</strong>
                              <small>Share this code with your delivery partner.</small>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="customer-order-footer">
                      <span>
                        <Clock3 size={14} /> {order.order_type === 'PICKUP' ? 'Restaurant pickup' : 'Track status as your order moves'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {['ACCEPTED', 'PREPARING', 'READY'].includes(order.status) && (
                          <span className="prep-cancel-notice" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            Order in prep. Call restaurant to cancel:{' '}
                            <a href={`tel:${restaurantPhone}`} style={{ color: 'var(--primary, #c54d2f)', fontWeight: 600, textDecoration: 'underline' }}>
                              {restaurantPhone}
                            </a>
                          </span>
                        )}
                        {order.payment_method === 'RAZORPAY' && order.payment_status !== 'PAID' && !terminal && order.status !== 'DELIVERED' && (
                          <Button size="button-sm" disabled={busyOrder === order.order_id} onClick={() => void payNow(order)}>
                            {busyOrder === order.order_id ? 'Opening…' : 'Pay online'}
                          </Button>
                        )}
                        {order.status === 'PLACED' && order.payment_status !== 'REFUND_PENDING' && (order.payment_status !== 'PAID' || order.payment_method === 'RAZORPAY') && (
                          <Button variant="ghost" disabled={busyOrder === order.order_id} onClick={() => void cancel(order)}>
                            {order.payment_method === 'RAZORPAY' && order.payment_status === 'PAID' ? 'Cancel & refund' : 'Cancel order'}
                          </Button>
                        )}
                        {(order.status === 'DELIVERED' || terminal) && (
                          <button
                            type="button"
                            className="reorder-link"
                            disabled={busyReorder === order.order_id}
                            onClick={() => void handleOrderAgain(order)}
                          >
                            {busyReorder === order.order_id ? 'Adding to cart...' : 'Order again'} <ArrowRight size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </article>
            )
          })}
        </div>
        <Pagination
          limit={pageSize}
          offset={page * pageSize}
          total={totalOrders}
          label="orders"
          onChange={(nextOffset) => {
            const nextP = Math.floor(nextOffset / pageSize)
            setPage(nextP)
            setLoading(true)
            void refresh(nextP)
          }}
        />
      </>
    )}
    <div className="customer-help"><Flame size={16} /><span>Need a hand with something?</span><Link to="/">See restaurant details</Link></div>
  </main>
}
