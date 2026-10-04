import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Check, ChevronDown, Clock3, Flame, Leaf, ListFilter, MapPin, Phone, Plus, ShieldCheck, ShoppingBag, Sparkles, Truck, Utensils, X, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, formatINR, formatSavedAddress, type MenuItem, type Order, type Restaurant, type SavedCartItem } from '../api'
import { useAuth } from '../state'
import { Button, EmptyState, Loading, MenuImageCarousel, Notice, QuantityPicker } from '../components'
import { launchCheckout, verifyRazorpayPayment } from '../payments'

type CartLine = { item: MenuItem; quantity: number }

const colors = ['food-red', 'food-gold', 'food-green', 'food-plum', 'food-orange', 'food-teal']
const art = ['🥙', '🍗', '🫓', '🍢', '🥘', '🍟']

export default function Storefront() {
  const { account } = useAuth()
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [category, setCategory] = useState('All')
  const [menuSearch, setMenuSearch] = useState('')
  const [menuSort, setMenuSort] = useState<'popular_desc' | 'popular_asc' | 'price_asc' | 'price_desc'>('popular_desc')
  const [sortOpen, setSortOpen] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [cartExpanded, setCartExpanded] = useState(false)
  const [address, setAddress] = useState('')
  const [selectedAddress, setSelectedAddress] = useState('')
  const [addressInitializedFor, setAddressInitializedFor] = useState<number | null>(null)
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
    Promise.all([api<MenuItem[]>('/menu'), api<Restaurant>('/restaurant')]).then(([items, config]) => {
      setMenu(items)
      setRestaurant(config)
    }).catch((err) => setError(err instanceof Error ? err.message : 'We could not load the menu.')).finally(() => setLoading(false))
  }, [])

  const cartLinesFromSaved = useCallback((saved: SavedCartItem[]) => saved.flatMap((savedItem) => {
    const item = menu.find((menuItem) => menuItem.id === savedItem.menu_item_id)
    return item && item.is_available ? [{ item, quantity: savedItem.quantity }] : []
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
  const subtotal = useMemo(() => cart.reduce((total, line) => total + (line.item.discounted_price_paise ?? (line.item.discount_percent ? Math.round(line.item.price_paise * (100 - line.item.discount_percent) / 100) : line.item.price_paise)) * line.quantity, 0), [cart])
  const tax = 0
  const payable = subtotal + tax
  const setQuantity = useCallback((item: MenuItem, quantity: number) => {
    if (orderingClosed) return
    revealCartSummary()
    setCart((old) => {
      const found = old.find((line) => line.item.id === item.id)
      if (!quantity) return old.filter((line) => line.item.id !== item.id)
      return found ? old.map((line) => line.item.id === item.id ? { ...line, quantity } : line) : [...old, { item, quantity }]
    })
    if (account?.role !== 'USER') return
    cartSync.current = cartSync.current.catch(() => undefined).then(async () => {
      const saved = await api<SavedCartItem[]>(`/cart/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ quantity }) })
      setCart(cartLinesFromSaved(saved))
    }).catch((err) => setError(err instanceof Error ? err.message : 'Could not save your cart.'))
  }, [account?.role, cartLinesFromSaved, orderingClosed])
  const quantityFor = (itemId: number) => cart.find((line) => line.item.id === itemId)?.quantity || 0

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
    setBusy(true)
    setError('')
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((line) => ({ menu_item_id: line.item.id, quantity: line.quantity })),
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
      {visibleMenu.length ? <div className={`food-grid ${orderingClosed ? 'food-grid-closed' : ''}`}>{visibleMenu.map((item, index) => <article className={`food-card ${item.is_featured ? 'food-featured' : ''} ${orderingClosed ? 'food-card-unavailable' : ''}`} key={item.id}>
        <div className={`food-image ${colors[(index + item.id) % colors.length]}`}>{item.image_urls?.length || item.image_url ? <MenuImageCarousel images={item.image_urls?.length ? item.image_urls : item.image_url ? [item.image_url] : []} alt={item.name} className="menu-gallery-food" /> : <><span className="food-image-orbit" /><span className="food-emoji">{art[(index + item.id) % art.length]}</span><span className="food-image-sprinkle">✦ &nbsp;✳</span></>}{item.discount_campaign_name && <span className="food-best discount-campaign-label" title={item.discount_campaign_name}>{item.discount_campaign_name}</span>}{item.is_featured && <span className={`food-best food-zilla-pick ${item.discount_campaign_name ? 'food-zilla-pick-after-discount' : ''}`}>ZILLA PICK <Sparkles size={11} /></span>}<span className={`diet-dot ${item.is_vegetarian ? 'veg' : 'nonveg'}`} title={item.is_vegetarian ? 'Vegetarian' : 'Non-vegetarian'}>{item.is_vegetarian ? <Leaf size={11} /> : <span />}</span></div>
        <div className="food-card-content"><div className="food-card-category">{item.category}</div><h3>{item.name}</h3><p>{item.description}</p><div className="food-card-bottom"><strong>{formatINR(item.discounted_price_paise ?? (item.discount_percent ? Math.round(item.price_paise * (100 - item.discount_percent) / 100) : item.price_paise))}{(item.discount_percent || item.discounted_price_paise) && <del>{formatINR(item.price_paise)}</del>}</strong>{orderingClosed ? <span className="closed-menu-label">Currently unavailable</span> : quantityFor(item.id) ? <QuantityPicker small quantity={quantityFor(item.id)} onChange={(quantity) => setQuantity(item, quantity)} /> : <button className="add-food" onClick={() => setQuantity(item, 1)} aria-label={`Add ${item.name}`}><Plus size={15} /> ADD</button>}</div></div>
      </article>)}</div> : <EmptyState icon={<Utensils size={20} />} title="The menu’s getting warmed up" description="Ask your restaurant admin to publish a few delicious items." />}
    </section>

    <section className="story-banner"><div className="story-mark"><Flame size={25} /></div><div><div className="eyebrow light-eyebrow">THE ZILLA WAY</div><h2>Good food is meant<br />to bring people <em>closer.</em></h2><p>From our charcoal grill to your table, every bite starts with the good stuff.</p></div><div className="story-seal"><span>100%</span><small>GOOD<br />TASTE</small><span>✦</span></div><div className="story-pattern">✳ &nbsp;· &nbsp;✦ &nbsp;· &nbsp;✳</div></section>
    <section className="store-bottom"><div><div className="eyebrow">COME BY, SAY HI</div><h2>Or let us bring it <em>to your table.</em></h2><div className="store-bottom-details">{restaurant?.address && <span><MapPin size={15} /> {restaurant.address}</span>}{restaurant?.phone && <span><Phone size={15} /> <a href={`tel:${restaurant.phone}`}>{restaurant.phone}</a></span>}{!restaurant?.address && <span>Restaurant location has not been added yet.</span>}</div></div>{restaurant?.latitude != null && restaurant.longitude != null ? <a className="store-bottom-map" href={`https://www.google.com/maps/search/?api=1&query=${restaurant.latitude},${restaurant.longitude}`} target="_blank" rel="noreferrer"><span className="map-mini"><MapPin size={26} /></span><span><strong>Find KebabZilla</strong><small>Open directions in Maps</small></span><ArrowRight size={17} /></a> : <div className="store-bottom-map"><span className="map-mini"><MapPin size={26} /></span><span><strong>Location details</strong><small>Pin location coming soon</small></span></div>}</section>

    {cartOpen && <div className="cart-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}><aside className="cart-panel" aria-label="Your basket" onMouseDown={(event) => event.stopPropagation()}><div className="cart-panel-scroll"><div className="cart-header"><div><span className="cart-icon"><ShoppingBag size={17} /></span><span><strong>Your order</strong><small>{totalItems} delicious thing{totalItems === 1 ? '' : 's'}</small></span></div><button className="cart-close" aria-label="Close cart" onClick={() => setCartOpen(false)}><X size={17} /></button></div>{cart.length ? <><div className="cart-items">{cart.map(({ item, quantity }) => <div className="cart-line" key={item.id}><span className="cart-line-name">{item.name}<small>{formatINR(priceFor(item))} each</small></span><QuantityPicker small quantity={quantity} onChange={(next) => setQuantity(item, next)} /><strong>{formatINR(priceFor(item) * quantity)}</strong></div>)}</div>
      <div className="cart-totals"><div><span>Subtotal (tax included)</span><strong>{formatINR(subtotal)}</strong></div><div><span>Delivery</span><strong>Calculated by distance</strong></div><div className="cart-grand"><span>Total before delivery</span><strong>{formatINR(payable)}</strong></div></div>
      {account ? <div className="checkout-fields">{account.addresses?.filter((saved) => formatSavedAddress(saved)).length ? <label className="field-label">Delivery address<select required value={selectedAddress} onChange={(event) => { const saved = account.addresses.find((item) => item.id === event.target.value); setSelectedAddress(event.target.value); setAddress(saved ? formatSavedAddress(saved) : "") }}><option value="">Choose a saved address</option>{account.addresses.filter((saved) => formatSavedAddress(saved)).map((saved) => <option key={saved.id} value={saved.id}>{saved.label}{saved.is_default ? " · Default" : ""} — {formatSavedAddress(saved)}</option>)}</select><Link to="/profile" className="text-button">Edit saved addresses</Link></label> : <div className="notice notice-info cart-address-prompt"><span>Add a delivery address before ordering.</span><Link to="/profile" className="button button-secondary">Add delivery address <ArrowRight size={14} /></Link></div>}<label className="field-label">Anything we should know? <span className="field-optional">optional</span><input maxLength={500} placeholder="No onions, extra chutney…" value={notes} onChange={(event) => setNotes(event.target.value)} /></label><label className="field-label">Order timing<select value={scheduledFor ? "later" : "now"} onChange={(event) => setScheduledFor(event.target.value === "later" ? new Date(Date.now() + 3600000).toISOString().slice(0,16) : "")}><option value="now">As soon as possible</option><option value="later">Schedule for later</option></select></label>{scheduledFor && <label className="field-label">Schedule date and time<input type="datetime-local" min={new Date(Date.now() + 60000).toISOString().slice(0,16)} value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></label>}<div className="payment-choices"><button className={paymentMethod === 'RAZORPAY' ? 'selected' : ''} onClick={() => setPaymentMethod('RAZORPAY')}><span className="radio-dot" /> Pay online</button><button className={paymentMethod === 'CASH' ? 'selected' : ''} onClick={() => setPaymentMethod('CASH')}><span className="radio-dot" /> Cash on delivery</button></div>{error && <Notice>{error}</Notice>}<Button className="checkout-button" disabled={busy || !restaurant?.accepting_orders} onClick={placeOrder}>{busy ? 'Just a second…' : <>Place order · {formatINR(payable)} <ArrowRight size={16} /></>}</Button><div className="checkout-secure"><ShieldCheck size={14} /> {paymentMethod === 'RAZORPAY' ? 'Secure checkout by Razorpay' : 'Pay when your food arrives'}</div></div> : <div className="cart-signin"><p>One tiny step before the first bite.</p><Link className="button button-dark" to="/login">Sign in to check out <ArrowRight size={16} /></Link><span>New here? <Link to="/register">Create an account</Link></span></div>}
      {subtotal < (restaurant?.minimum_order_paise || 0) && <div className="minimum-note">Add {formatINR((restaurant?.minimum_order_paise || 0) - subtotal)} to meet our minimum.</div>}
      </> : <div className="cart-empty"><p>Your cart is empty.</p><button className="text-button" onClick={() => { setCartOpen(false); document.querySelector('.menu-section')?.scrollIntoView({ behavior: 'smooth' }) }}>Browse the menu</button></div>}</div></aside></div>}
    {cart.length > 0 && <button className={`floating-cart visible ${cartExpanded ? 'expanded' : 'compact'}`} onClick={() => setCartOpen(true)} aria-label={`Open cart, ${totalItems} item${totalItems === 1 ? '' : 's'}, total ${formatINR(payable)}`}><span className="cart-summary-icon"><ShoppingBag size={18} /></span><span className="cart-summary-copy"><strong>{totalItems} item{totalItems === 1 ? '' : 's'} added</strong><small>Tap to review your order</small></span><span className="cart-summary-total"><small>ORDER TOTAL</small><strong>{formatINR(payable)}</strong></span><ArrowRight size={17} /></button>}
  </main>
}


