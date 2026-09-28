import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, BadgeIndianRupee, Check, CircleCheck, ClipboardList, CookingPot, Flame, Plus, ReceiptText, Save, Trash2, Truck, UserRound } from 'lucide-react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, formatINR, friendlyDate, type MenuItem, type Order } from '../api'
import { useAuth } from '../state'
import { Badge, Button, EmptyState, Loading, MenuImageCarousel, Notice, PageTitle, QuantityPicker, StatusBadge } from '../components'

function Queue() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [filter, setFilter] = useState('ACTIVE')

  const refresh = useCallback(() => api<Order[]>('/staff/orders').then((ordersList) => {
    setOrders(ordersList)
  }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load the order queue.')).finally(() => setLoading(false)), [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 12000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const active = useMemo(() => orders.filter((order) => ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].includes(order.status)), [orders])
  const displayed = filter === 'ACTIVE' ? active : orders.filter((order) => order.status === filter)

  async function update(order: Order, status: string) {
    setBusy(order.id)
    setError('')
    try {
      await api(`/staff/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'The order could not be updated.') }
    finally { setBusy(null) }
  }

  function escapeReceipt(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }

  async function markReadyAndPrint(order: Order) {
    const printWindow = window.open('', '_blank', 'width=420,height=720')
    setBusy(order.id)
    setError('')
    try {
      await api(`/staff/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'READY' }) })
      if (printWindow) {
        const lines = order.items.map((item) => `<tr><td>${item.quantity} × ${escapeReceipt(item.name)}</td><td>${formatINR(item.line_total_paise)}</td></tr>`).join('')
        const source = order.customer_id !== null ? 'ONLINE ORDER' : order.order_type === 'DINE_IN' ? 'WALK-IN · DINE-IN' : 'WALK-IN · PICKUP'
        printWindow.document.write(`<!doctype html><html><head><title>Receipt ${escapeReceipt(order.public_id)}</title><style>body{font:14px Arial,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 4px}small{color:#555}.tag{margin:12px 0;padding:7px;background:#eee;font-weight:bold}table{width:100%;border-collapse:collapse;margin:18px 0}td{padding:7px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right}.totals p{display:flex;justify-content:space-between;margin:6px 0}.grand{font-size:18px;font-weight:bold;border-top:1px solid #111;padding-top:10px}</style></head><body><h1>KebabZilla</h1><small>Order ${escapeReceipt(order.public_id)} · ${escapeReceipt(friendlyDate(order.created_at))}</small><div class="tag">${source}</div><p>Customer: ${escapeReceipt(order.customer_name)}</p><p>${escapeReceipt(order.address || 'Restaurant counter')}</p><table>${lines}</table><div class="totals"><p><span>Subtotal</span><span>${formatINR(order.subtotal_paise)}</span></p><p><span>Tax</span><span>${formatINR(order.tax_paise)}</span></p>${order.delivery_fee_paise ? `<p><span>Delivery</span><span>${formatINR(order.delivery_fee_paise)}</span></p>` : ''}<p class="grand"><span>Total</span><span>${formatINR(order.total_paise)}</span></p></div></body></html>`)
        printWindow.document.close()
        printWindow.focus()
        window.setTimeout(() => printWindow.print(), 300)
      }
      await refresh()
    } catch (err) {
      printWindow?.close()
      setError(err instanceof Error ? err.message : 'The order could not be marked ready.')
    } finally { setBusy(null) }
  }

  if (loading) return <Loading label="Getting the kitchen queue…" />
  return <>
    <PageTitle eyebrow="THE GRILL IS ON" title="Order queue" description="Keep each order moving, from the first sizzle to the front door." action={<span className="live-indicator"><span className="pulse-dot" /> Live queue</span>} />
    {error && <Notice onDismiss={() => setError('')}>{error}</Notice>}
    <div className="stat-row ops-stats"><div className="stat-card"><span className="stat-icon stat-orange"><ClipboardList size={18} /></span><div><small>New orders</small><strong>{orders.filter((order) => order.status === 'PLACED').length}</strong></div><span className="stat-caption">Need a quick look</span></div><div className="stat-card"><span className="stat-icon stat-amber"><CookingPot size={18} /></span><div><small>On the grill</small><strong>{orders.filter((order) => ['ACCEPTED', 'PREPARING'].includes(order.status)).length}</strong></div><span className="stat-caption">In progress</span></div><div className="stat-card"><span className="stat-icon stat-green"><Truck size={18} /></span><div><small>Ready to go</small><strong>{orders.filter((order) => order.status === 'READY').length}</strong></div><span className="stat-caption">Awaiting dispatch</span></div><div className="stat-card"><span className="stat-icon stat-plum"><CircleCheck size={18} /></span><div><small>Orders today</small><strong>{orders.filter((order) => new Date(order.created_at).toDateString() === new Date().toDateString()).length}</strong></div><span className="stat-caption">All day so far</span></div></div>
    <div className="section-header"><div><h2>On the pass</h2><span>{displayed.length} order{displayed.length === 1 ? '' : 's'} to look after</span></div><div className="filter-tabs"><button className={filter === 'ACTIVE' ? 'active' : ''} onClick={() => setFilter('ACTIVE')}>Active</button><button className={filter === 'PLACED' ? 'active' : ''} onClick={() => setFilter('PLACED')}>New <b>{orders.filter((order) => order.status === 'PLACED').length}</b></button><button className={filter === 'READY' ? 'active' : ''} onClick={() => setFilter('READY')}>Ready</button></div></div>
    {!displayed.length ? <EmptyState icon={<CookingPot size={21} />} title="A quiet moment at the pass" description="New orders show up here as soon as they’re placed." /> : <div className="ops-order-grid">{displayed.map((order, index) => <article className="ops-order-card" key={order.id}><div className="ops-order-head"><div><span className="ops-order-time">{friendlyDate(order.created_at)}</span><h3><strong className="ops-queue-number">Order #{index + 1}</strong></h3></div><StatusBadge status={order.status} /></div><div className="ops-customer"><span className="mini-person"><UserRound size={15} /></span><span><strong>{order.customer_name}</strong><small>{order.order_type === 'DINE_IN' ? 'Walk-in · dine-in' : order.order_type === 'PICKUP' ? 'Walk-in · collection' : order.customer_phone || order.customer_email}</small></span>{order.customer_id !== null ? <Badge tone="amber">ONLINE ORDER</Badge> : <Badge tone="soft">WALK-IN</Badge>}</div><div className="ops-order-items">{order.items.map((line) => <div className="ops-order-item" key={line.id}>{(line.image_urls?.length || line.image_url) && <span className="ops-order-item-art"><MenuImageCarousel images={line.image_urls?.length ? line.image_urls : line.image_url ? [line.image_url] : []} alt={line.name} className="menu-gallery-order" /></span>}<span><b>{line.quantity}×</b> {line.name}</span><strong>{formatINR(line.line_total_paise)}</strong></div>)}</div><div className="ops-order-address"><Truck size={14} /><span>{order.address || 'Restaurant counter pickup'}</span></div><div className="ops-order-bottom"><span>Total <strong>{formatINR(order.total_paise)}</strong></span><div className="order-actions">
      {order.status === 'PLACED' && <><Button variant="ghost" className="reject-action" disabled={busy === order.id} onClick={() => void update(order, 'REJECTED')}>Reject</Button><Button size="button-sm" disabled={busy === order.id} onClick={() => void update(order, 'ACCEPTED')}>Accept <Check size={14} /></Button></>}
      {order.status === 'ACCEPTED' && <Button size="button-sm" disabled={busy === order.id} onClick={() => void update(order, 'PREPARING')}>Start grilling <ArrowRight size={14} /></Button>}
      {order.status === 'PREPARING' && <Button size="button-sm" disabled={busy === order.id} onClick={() => void markReadyAndPrint(order)}>Mark and print the receipt <ReceiptText size={14} /></Button>}
      {order.status === 'READY' && <span className="queue-waiting">Waiting for delivery partner</span>}
    </div></div></article>)}</div>}
  </>
}

function Billing() {
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<{ item: MenuItem; quantity: number }[]>([])
  const [name, setName] = useState('Walk-in')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState<Order | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { state } = location as { state: { draft?: { customer_name?: string; phone?: string; payload?: { items?: { id: number; quantity: number }[] }; items?: { id: number; quantity: number }[] } } | null }
  const subtotal = cart.reduce((sum, line) => sum + line.item.price_paise * line.quantity, 0)
  const tax = cart.reduce((sum, line) => sum + Math.round(line.item.price_paise * line.quantity * line.item.tax_percent / 100), 0)
  const total = subtotal + tax
  useEffect(() => {
    api<MenuItem[]>('/menu').then(setMenu).catch((err) => setError(err instanceof Error ? err.message : 'Could not load menu.'))
  }, [])
  useEffect(() => {
    if (!state?.draft || !menu.length) return
    const draft = state.draft
    const lines = draft.payload?.items || draft.items || []
    setCart(lines.map((line) => ({ item: menu.find((item) => item.id === line.id)!, quantity: line.quantity })).filter((line) => line.item))
    setName(draft.customer_name || 'Walk-in')
    setPhone(draft.phone || '')
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, menu, navigate, state])

  function setQuantity(item: MenuItem, quantity: number) {
    setCart((previous) => {
      const found = previous.find((line) => line.item.id === item.id)
      if (quantity <= 0) return previous.filter((line) => line.item.id !== item.id)
      return found ? previous.map((line) => line.item.id === item.id ? { ...line, quantity } : line) : [...previous, { item, quantity }]
    })
  }

  async function saveDraft() {
    setError('')
    try {
      await api('/staff/drafts', { method: 'POST', body: JSON.stringify({ customer_name: name, payload: { phone, notes, items: cart.map((line) => ({ id: line.item.id, quantity: line.quantity })) } }) })
      setCart([])
      setName('Walk-in')
      setPhone('')
      setNotes('')
      setError('Draft saved. You can pick it up any time from Saved drafts.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save draft.') }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cart.length) { setError('Add at least one menu item to create a bill.'); return }
    setBusy(true)
    setError('')
    try {
      const result = await api<Order>(`/staff/walk-in?customer_name=${encodeURIComponent(name)}${phone ? `&phone=${encodeURIComponent(phone)}` : ''}`, {
        method: 'POST', body: JSON.stringify({ items: cart.map((line) => ({ menu_item_id: line.item.id, quantity: line.quantity })), payment_method: 'CASH', address: 'Restaurant counter', notes }),
      })
      setInvoice(result)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create this bill.') }
    finally { setBusy(false) }
  }

  if (invoice) return <div className="invoice-wrap"><article className="invoice-card"><div className="invoice-success"><span><Check size={20} /></span><div><div className="eyebrow">BILL PAID · WALK-IN</div><h1>All squared away.</h1></div></div><div className="invoice-brand"><span><Flame size={15} /></span> KebabZilla <small> · PAYMENT RECEIPT</small></div><div className="invoice-id"><span>INVOICE</span><strong>{invoice.public_id}</strong><small>{friendlyDate(invoice.created_at)}</small></div><div className="invoice-lines">{invoice.items.map((line) => <div key={line.id}><span>{line.quantity} × {line.name}<small>{line.tax_percent}% tax</small></span><strong>{formatINR(line.line_total_paise)}</strong></div>)}<div><span>Tax</span><strong>{formatINR(invoice.tax_paise)}</strong></div><div className="invoice-total"><span>Total paid</span><strong>{formatINR(invoice.total_paise)}</strong></div></div><div className="invoice-customer"><span><UserRound size={14} /> {invoice.customer_name}</span><Badge tone="success">CASH</Badge></div><div className="invoice-actions"><Button onClick={() => window.print()}><ReceiptText size={16} /> Print receipt</Button><Button variant="secondary" onClick={() => { setInvoice(null); setCart([]); setName('Walk-in'); setPhone(''); setNotes('') }}>New bill</Button></div></article></div>

  return <><PageTitle eyebrow="AT THE COUNTER" title="Walk-in billing" description="Close out a dine-in bill when your guest is ready to leave." action={<Link className="button button-secondary" to="/ops/drafts"><ClipboardList size={15} /> Saved drafts</Link>} />
    {error && <Notice tone={error.startsWith('Draft saved') ? 'success' : 'error'} onDismiss={() => setError('')} >{error}</Notice>}
    <form onSubmit={submit} className="billing-layout"><section className="billing-menu"><div className="section-header"><div><h2>Menu</h2><span>Tap an item to add it</span></div><span className="menu-count">{menu.length} items</span></div><div className="billing-item-grid">{menu.map((item) => { const quantity = cart.find((line) => line.item.id === item.id)?.quantity || 0; return <div role="button" tabIndex={0} aria-pressed={quantity > 0} className={`billing-item ${quantity ? 'in-cart' : ''}`} key={item.id} onClick={() => setQuantity(item, quantity + 1)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setQuantity(item, quantity + 1) } }}>{item.image_urls?.length || item.image_url ? <span className="billing-item-icon billing-item-photo"><MenuImageCarousel images={item.image_urls?.length ? item.image_urls : item.image_url ? [item.image_url] : []} alt={item.name} className="menu-gallery-billing" /></span> : <span className="billing-item-icon">{item.is_vegetarian ? '🥬' : '🍢'}</span>}<span><strong>{item.name}</strong><small>{item.category} · {formatINR(item.price_paise)}</small></span>{quantity > 0 ? <Badge tone="soft">×{quantity}</Badge> : <Plus size={16} />}</div>})}</div></section>
      <aside className="billing-ticket"><div className="ticket-heading"><span><ReceiptText size={17} /></span><div><h2>New bill</h2><small>Cash · Dine-in</small></div></div><label className="field-label">Customer name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">Phone <span className="field-optional">optional</span><input type="tel" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Customer phone" /></label><label className="field-label">Kitchen note <span className="field-optional">optional</span><input maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="No onions, extra chutney…" /></label><div className="ticket-items">{cart.map(({ item, quantity }) => <div className="ticket-line" key={item.id}><span>{item.name}<small>{formatINR(item.price_paise)} each</small></span><QuantityPicker small quantity={quantity} onChange={(next) => setQuantity(item, next)} /><b>{formatINR(item.price_paise * quantity)}</b></div>)}</div><div className="ticket-total"><span>Bill total <small>· tax {formatINR(tax)} included</small></span><strong>{formatINR(total)}</strong></div><Button type="submit" disabled={busy || !cart.length} className="full-width">{busy ? 'Working…' : <>Complete bill · {formatINR(total)} <BadgeIndianRupee size={16} /></>}</Button><Button type="button" variant="secondary" className="full-width" disabled={!cart.length} onClick={() => void saveDraft()}><Save size={15} /> Save as draft</Button></aside>
    </form>
  </>
}

function Drafts() {
  const [drafts, setDrafts] = useState<{ id: number; customer_name: string; payload: { phone?: string; notes?: string; items?: { id: number; quantity: number }[] }; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const refresh = useCallback(() => api<typeof drafts>('/staff/drafts').then(setDrafts).catch((err) => setError(err instanceof Error ? err.message : 'Could not load drafts.')).finally(() => setLoading(false)), [])
  useEffect(() => { void refresh() }, [refresh])
  async function remove(id: number) {
    try { await api(`/staff/drafts/${id}`, { method: 'DELETE' }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete this draft.') }
  }
  return <><PageTitle eyebrow="PICK UP WHERE YOU LEFT OFF" title="Saved drafts" description="Unfinished bills, saved for the next quiet moment." action={<Link className="button button-primary" to="/ops/billing"><Plus size={16} /> New bill</Link>} />
    {error && <Notice>{error}</Notice>}{loading ? <Loading label="Finding saved drafts…" /> : !drafts.length ? <EmptyState icon={<Save size={20} />} title="No drafts waiting" description="Save an unfinished counter bill and it’ll be right here." /> : <div className="draft-list">{drafts.map((draft) => <article className="draft-row" key={draft.id}><span className="draft-icon"><ReceiptText size={18} /></span><div className="draft-main"><strong>{draft.customer_name || 'Walk-in'}</strong><span>{(draft.payload.items || []).length} line items · saved {friendlyDate(draft.created_at)}</span></div><div className="draft-preview">{(draft.payload.items || []).map((line) => <span key={line.id}>{line.quantity}×</span>)}</div><div className="draft-actions"><Button size="button-sm" onClick={() => navigate('/ops/billing', { state: { draft } })}>Resume <ArrowRight size={14} /></Button><button className="icon-button danger-icon" title="Delete draft" onClick={() => void remove(draft.id)}><Trash2 size={16} /></button></div></article>)}</div>}
  </>
}

export default function Operations() {
  const { account } = useAuth()
  if (account?.role === 'ADMIN') return <PageTitle eyebrow="ADMIN OPERATIONS" title="Staff console" description="Team queue and counter billing are available from the admin tools." action={<Link className="button button-primary" to="/admin/orders">Manage all orders <ArrowRight size={16} /></Link>} />
  return <Routes><Route index element={<Queue />} /><Route path="billing" element={<Billing />} /><Route path="drafts" element={<Drafts />} /><Route path="*" element={<NavigateBack />} /></Routes>
}

function NavigateBack() { return <EmptyState title="That kitchen station is closed" description="Choose an operations station from the left menu." action={<Link to="/ops" className="button button-secondary">Back to order queue</Link>} /> }
