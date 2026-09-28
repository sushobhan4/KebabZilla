import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { Activity, ArrowRight, ArrowUpRight, Ban, BarChart3, Check, ChevronDown, CircleDollarSign, CookingPot, CreditCard, Edit3, Flame, LayoutDashboard, Plus, RefreshCw, Search, Settings, ShieldCheck, ShoppingBag, Trash2, Truck, Users, X } from 'lucide-react'
import { Link, Route, Routes } from 'react-router-dom'
import { api, formatINR, formatStatus, friendlyDate, type Account, type MenuItem, type Order, type Restaurant, type Role } from '../api'
import { useAuth } from '../state'
import { Badge, Button, EmptyState, Loading, MenuImageCarousel, Notice, PageTitle, StatusBadge } from '../components'

type Report = { period: string; revenue_paise: number; paid_orders: number; total_orders: number; average_order_paise: number; statuses: Record<string, number>; series: { label: string; revenue_paise: number; orders: number }[]; top_items: { name: string; quantity: number }[] }
type PageData<T> = { items: T[]; total: number; limit: number; offset: number; status_counts?: Record<string, number>; role_counts?: Record<string, number>; active_total?: number; paid_revenue_paise?: number }
const roles: Role[] = ['ADMIN', 'EMPLOYEE', 'DELIVERY', 'USER']
const orderNext: Record<string, string[]> = { PLACED: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['PREPARING'], PREPARING: ['READY'], READY: [], OUT_FOR_DELIVERY: [] }
const adminPageSize = 25

function PageControls({ limit, offset, total, onChange }: { limit: number; offset: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null
  const from = offset + 1
  const to = Math.min(offset + limit, total)
  return <div className="pagination"><span>Showing {from}–{to} of {total}</span><div><Button variant="secondary" size="button-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button><Button variant="secondary" size="button-sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>Next</Button></div></div>
}

function Overview() {
  const [orders, setOrders] = useState<Order[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [orderSummary, setOrderSummary] = useState<PageData<Order> | null>(null)
  const [accountSummary, setAccountSummary] = useState<PageData<Account> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => Promise.all([api<PageData<Order>>('/admin/orders?limit=5'), api<PageData<Account>>('/admin/accounts?limit=5'), api<Report>('/admin/reports/sales?period=week')]).then(([ordersData, people, sales]) => {
    setOrders(ordersData.items); setOrderSummary(ordersData); setAccountSummary(people); setReport(sales)
  }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load your restaurant overview.')).finally(() => setLoading(false)), [])
  useEffect(() => { void refresh() }, [refresh])
  if (loading) return <Loading label="Setting the table…" />
  const openOrders = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].reduce((sum, status) => sum + (orderSummary?.status_counts?.[status] || 0), 0)
  const maxRevenue = Math.max(1, ...(report?.series || []).map((item) => item.revenue_paise))
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return <><PageTitle eyebrow="A LITTLE LOOK AROUND" title={`${greeting}.`} description="Here’s what’s cooking at KebabZilla today." action={<Button variant="secondary" onClick={() => { setLoading(true); void refresh() }}><RefreshCw size={15} /> Refresh</Button>} />{error && <Notice>{error}</Notice>}
    <section className="admin-stat-grid"><div className="admin-stat-card admin-stat-revenue"><div className="admin-stat-top"><span className="admin-stat-icon"><CircleDollarSign size={18} /></span><span className="admin-stat-period">THIS WEEK</span></div><div className="admin-stat-number">{formatINR(report?.revenue_paise || 0)}</div><div className="admin-stat-foot"><span>Paid revenue</span><span className="stat-up"><ArrowUpRight size={13} /> Sales</span></div><div className="stat-ribbon" /></div><div className="admin-stat-card"><div className="admin-stat-top"><span className="admin-stat-icon stat-icon-soft-red"><ShoppingBag size={18} /></span><Link className="stat-open-link" to="/admin/orders"><ArrowRight size={15} /></Link></div><div className="admin-stat-number">{orderSummary?.status_counts ? Object.values(orderSummary.status_counts).reduce((sum, count) => sum + count, 0) : 0}</div><div className="admin-stat-foot"><span>Orders recorded</span><span className="stat-highlight">{openOrders} active now</span></div></div><div className="admin-stat-card"><div className="admin-stat-top"><span className="admin-stat-icon stat-icon-soft-green"><Users size={18} /></span><Link className="stat-open-link" to="/admin/team"><ArrowRight size={15} /></Link></div><div className="admin-stat-number">{accountSummary?.active_total || 0}</div><div className="admin-stat-foot"><span>Active accounts</span><span className="stat-highlight">{accountSummary?.role_counts?.EMPLOYEE || 0} employees</span></div></div><div className="admin-stat-card"><div className="admin-stat-top"><span className="admin-stat-icon stat-icon-soft-amber"><Truck size={18} /></span><Link className="stat-open-link" to="/admin/orders"><ArrowRight size={15} /></Link></div><div className="admin-stat-number">{orderSummary?.status_counts?.OUT_FOR_DELIVERY || 0}</div><div className="admin-stat-foot"><span>Out with a rider</span><span className="stat-highlight">Being delivered</span></div></div></section>
    <div className="admin-overview-grid"><section className="admin-panel sales-overview"><div className="panel-heading"><div><span className="eyebrow">THE WEEK SO FAR</span><h2>Sales at a glance</h2></div><Link to="/admin/reports" className="panel-link">Full report <ArrowRight size={14} /></Link></div><div className="sales-chart"><div className="chart-axis"><span>{formatINR(maxRevenue)}</span><span>{formatINR(Math.round(maxRevenue / 2))}</span><span>₹0</span></div><div className="chart-bars">{(report?.series || []).map((point, index) => <div className="chart-bar-wrap" key={`${point.label}-${index}`}><span className="chart-tip">{formatINR(point.revenue_paise)}<small>{point.orders} orders</small></span><div className={`chart-bar ${index === (report?.series.length || 1) - 1 ? 'bar-highlight' : ''}`} style={{ height: `${Math.max(point.revenue_paise ? 8 : 3, point.revenue_paise / maxRevenue * 100)}%` }} /><span className="chart-label">{point.label}</span></div>)}</div></div><div className="sales-chart-foot"><span><i className="legend-dot" /> Paid sales</span><strong>{formatINR(report?.average_order_paise || 0)}<small> avg. paid order</small></strong></div></section>
      <section className="admin-panel top-items-panel"><div className="panel-heading"><div><span className="eyebrow">PEOPLE KEEP COMING BACK FOR</span><h2>Top of the grill</h2></div><span className="mini-panel-icon"><Flame size={16} /></span></div>{report?.top_items.length ? <div className="top-items-list">{report.top_items.map((item, index) => <div className="top-item-row" key={item.name}><span className={`top-item-n top-item-n-${index}`}>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.name}</strong><small>Hot off the grill</small></div><Badge tone="soft">{item.quantity} sold</Badge></div>)}</div> : <EmptyState title="Waiting for the first orders" description="Menu favorites will show up here." />}<Link to="/admin/menu" className="manage-menu-link"><CookingPot size={15} /> Manage the menu <ArrowRight size={14} /></Link></section></div>
    <section className="admin-panel recent-orders-panel"><div className="panel-heading"><div><span className="eyebrow">THE LATEST FROM THE PASS</span><h2>Recent orders</h2></div><Link to="/admin/orders" className="panel-link">See all orders <ArrowRight size={14} /></Link></div>{orders.slice(0, 5).length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>ORDER</th><th>GUEST</th><th>WHEN</th><th>TOTAL</th><th>STATUS</th><th></th></tr></thead><tbody>{orders.slice(0, 5).map((order) => <tr key={order.id}><td><strong className="mono-id">{order.public_id}</strong></td><td><span className="table-person">{order.customer_name}</span></td><td>{friendlyDate(order.created_at)}</td><td><strong>{formatINR(order.total_paise)}</strong></td><td><StatusBadge status={order.status} /></td><td><Link className="table-arrow" to="/admin/orders"><ArrowRight size={15} /></Link></td></tr>)}</tbody></table></div> : <EmptyState title="No orders yet" description="Once someone places an order, you’ll find it here." />}</section>
    <div className="admin-quick-actions"><div><span className="quick-action-icon"><Users size={17} /></span><span><strong>Grow your crew</strong><small>Add an employee or delivery partner.</small></span><Link to="/admin/team" aria-label="Manage team"><ArrowRight size={16} /></Link></div><div><span className="quick-action-icon quick-action-coral"><Settings size={17} /></span><span><strong>Restaurant details</strong><small>Opening hours, taxes and delivery fee.</small></span><Link to="/admin/settings" aria-label="Restaurant settings"><ArrowRight size={16} /></Link></div></div>
  </>
}

function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [pageData, setPageData] = useState<PageData<Order> | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [filter, setFilter] = useState('ALL')
  const refresh = useCallback(() => {
    const statusQuery = filter === 'ALL' ? '' : `&status_filter=${filter}`
    return api<PageData<Order>>(`/admin/orders?limit=${adminPageSize}&offset=${page * adminPageSize}${statusQuery}`).then((result) => { setPageData(result); setOrders(result.items) }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load orders.')).finally(() => setLoading(false))
  }, [filter, page])
  useEffect(() => { void refresh() }, [refresh])
  const filtered = orders
  function selectFilter(value: string) { setFilter(value); setPage(0); setLoading(true) }
  async function update(order: Order, status: string) {
    setBusyId(order.id); setError('')
    try { await api(`/admin/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update order.') } finally { setBusyId(null) }
  }
  async function refund(order: Order) {
    const message = `Issue a full Razorpay refund of ${formatINR(order.total_paise)} for order ${order.public_id}?`
    if (!window.confirm(message)) return
    setBusyId(order.id); setError('')
    try {
      await api(`/admin/orders/${order.id}/refund`, { method: 'POST' })
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not issue this refund.') }
    finally { setBusyId(null) }
  }
  if (loading) return <Loading label="Getting the order book…" />
  return <><PageTitle eyebrow="EVERY ORDER, ONE VIEW" title="Order management" description="Review each ticket and keep it moving across the restaurant." action={<Button variant="secondary" onClick={() => { setLoading(true); void refresh() }}><RefreshCw size={15} /> Refresh</Button>} />{error && <Notice>{error}</Notice>}
    <div className="orders-kpi-row"><div><strong>{pageData?.status_counts ? Object.values(pageData.status_counts).reduce((sum, count) => sum + count, 0) : 0}</strong><span>Total tickets</span></div><div><strong>{['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].reduce((sum, status) => sum + (pageData?.status_counts?.[status] || 0), 0)}</strong><span>In the kitchen</span></div><div><strong>{pageData?.status_counts?.OUT_FOR_DELIVERY || 0}</strong><span>Out for delivery</span></div><div><strong>{formatINR(pageData?.paid_revenue_paise || 0)}</strong><span>Paid sales</span></div></div>
    <section className="admin-panel"><div className="order-filter-bar"><div className="filter-tabs"><button className={filter === 'ALL' ? 'active' : ''} onClick={() => selectFilter('ALL')}>All <b>{pageData?.status_counts ? Object.values(pageData.status_counts).reduce((sum, count) => sum + count, 0) : 0}</b></button>{['PLACED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'].map((status) => <button className={filter === status ? 'active' : ''} key={status} onClick={() => selectFilter(status)}>{formatStatus(status)} <b>{pageData?.status_counts?.[status] || 0}</b></button>)}</div></div>
      {filtered.length ? <div className="admin-order-list">{filtered.map((order) => <article className="admin-order-row" key={order.id}><div className="admin-order-summary"><div className="admin-order-id"><strong>{order.public_id}</strong><small>{friendlyDate(order.created_at)}</small></div><div className="admin-order-customer"><span className="mini-person"><Users size={14} /></span><span><strong>{order.customer_name}</strong><small>{order.customer_email}</small></span></div><div className="admin-order-products"><strong>{order.items.reduce((count, item) => count + item.quantity, 0)} items</strong><small>{order.items.slice(0, 2).map((item) => item.name).join(', ')}{order.items.length > 2 ? '…' : ''}</small></div><div className="admin-order-price"><strong>{formatINR(order.total_paise)}</strong><small>{formatStatus(order.payment_method)} · {formatStatus(order.payment_status)}</small></div><StatusBadge status={order.status} /></div>
        <div className="admin-order-detail"><span><Truck size={14} /> {order.address || 'Restaurant counter pickup'}</span>{order.notes && <span>“{order.notes}”</span>}<div className="admin-order-line-list">{order.items.map((item) => <div className="admin-order-line" key={item.id}>{(item.image_urls?.length || item.image_url) && <span className="admin-order-line-art"><MenuImageCarousel images={item.image_urls?.length ? item.image_urls : item.image_url ? [item.image_url] : []} alt={item.name} className="menu-gallery-order" /></span>}<span>{item.quantity}× {item.name}</span><b>{formatINR(item.line_total_paise)}</b></div>)}</div><div className="admin-order-tools">{orderNext[order.status]?.map((status) => <Button key={status} variant={status === 'REJECTED' ? 'danger' : 'ghost'} size="button-sm" disabled={busyId === order.id} onClick={() => void update(order, status)}>{formatStatus(status)} {status === 'ACCEPTED' && <Check size={14} />}</Button>)}{order.payment_status === 'PAID' && order.payment_method === 'RAZORPAY' && <Button variant="danger" size="button-sm" disabled={busyId === order.id} onClick={() => void refund(order)}>Refund payment <ArrowRight size={13} /></Button>}{order.payment_status === 'REFUND_PENDING' && <Badge tone="amber">Refund processing</Badge>}</div></div>
      </article>)}</div> : <EmptyState icon={<ShoppingBag size={20} />} title="No orders in this view" description="Choose another order status or check back in a moment." />}
      <PageControls limit={pageData?.limit || adminPageSize} offset={pageData?.offset || 0} total={pageData?.total || 0} onChange={(next) => { setPage(Math.floor(next / adminPageSize)); setLoading(true) }} />
    </section>
  </>
}

function Team() {
  const { account } = useAuth()
  const [people, setPeople] = useState<Account[]>([])
  const [q, setQ] = useState('')
  const [role, setRole] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [historyId, setHistoryId] = useState<number | null>(null)
  const [history, setHistory] = useState<Order[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({})
  const [activeTotal, setActiveTotal] = useState(0)
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: 'EMPLOYEE' as Role })
  const refresh = useCallback(() => api<PageData<Account>>(`/admin/accounts?limit=${adminPageSize}&offset=${page * adminPageSize}&q=${encodeURIComponent(q)}${role !== 'ALL' ? `&role=${role}` : ''}`).then((result) => {
    setPeople(result.items); setTotal(result.total); setRoleCounts(result.role_counts || {}); setActiveTotal(result.active_total || 0)
  }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load accounts.')).finally(() => setLoading(false)), [page, q, role])
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), q ? 220 : 0); return () => window.clearTimeout(timer) }, [refresh, q])
  async function changeRole(person: Account, next: Role) {
    setBusyId(person.id); setError('')
    try { await api<Account>(`/admin/accounts/${person.id}/role?role=${next}`, { method: 'PATCH' }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not change role.') } finally { setBusyId(null) }
  }
  async function toggleActive(person: Account) {
    setBusyId(person.id); setError('')
    try { await api<Account>(`/admin/accounts/${person.id}/active?is_active=${!person.is_active}`, { method: 'PATCH' }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update this account.') } finally { setBusyId(null) }
  }
  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusyId(-1)
    try { const created = await api<Account>('/admin/accounts', { method: 'POST', body: JSON.stringify(form) }); setCreating(false); setForm({ name: '', email: '', phone: '', password: '', role: 'EMPLOYEE' }); setQ(''); setRole('ALL'); setPage(0); setPeople((old) => [created, ...old].slice(0, adminPageSize)); setTotal((old) => old + 1); setRoleCounts((old) => ({ ...old, [created.role]: (old[created.role] || 0) + 1 })); if (created.is_active) setActiveTotal((old) => old + 1) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create account.') } finally { setBusyId(null) }
  }
  async function viewHistory(person: Account) {
    setHistoryId(historyId === person.id ? null : person.id)
    if (historyId === person.id) return
    try { setHistory(await api<Order[]>(`/admin/accounts/${person.id}/orders`)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load this user’s order history.') }
  }
  return <><PageTitle eyebrow="PEOPLE MAKE THE PLACE" title="People & permissions" description="Customer accounts, your restaurant crew and delivery partners." action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Create account</Button>} />{error && <Notice onDismiss={() => setError('')}>{error}</Notice>}
    <div className="team-metrics"><div><strong>{total}</strong><span>{q || role !== 'ALL' ? 'Matching accounts' : 'Accounts'}</span></div><div><strong>{roleCounts.EMPLOYEE || 0}</strong><span>Employees</span></div><div><strong>{roleCounts.DELIVERY || 0}</strong><span>Delivery partners</span></div><div><strong>{activeTotal}</strong><span>Active accounts</span></div></div>
    <section className="admin-panel team-panel"><div className="team-filter-row"><label className="search-field"><Search size={17} /><input value={q} onChange={(event) => { setQ(event.target.value); setPage(0); setLoading(true) }} placeholder="Search name, email or phone…" /><kbd>⌘ K</kbd></label><label className="role-filter"><Users size={15} /><select value={role} onChange={(event) => { setRole(event.target.value); setPage(0); setLoading(true) }}><option value="ALL">All roles</option>{roles.map((r) => <option key={r} value={r}>{formatStatus(r)}</option>)}</select><ChevronDown size={15} /></label></div>
      {loading ? <Loading label="Finding people…" /> : people.length ? <div className="table-wrap"><table className="data-table people-table"><thead><tr><th>PERSON</th><th>ROLE</th><th>STATUS</th><th>JOINED</th><th>ORDERS</th><th></th></tr></thead><tbody>{people.map((person) => <Fragment key={person.id}><tr><td><div className="person-cell"><span className={`person-avatar person-avatar-${person.role.toLowerCase()}`}>{person.name.slice(0, 1).toUpperCase()}</span><span><strong>{person.name}{person.id === account?.id && <small className="you-label">YOU</small>}</strong><small>{person.email}{person.phone ? ` · ${person.phone}` : ''}</small></span></div></td><td><select className="role-select" value={person.role} disabled={busyId === person.id || person.id === account?.id} onChange={(event) => void changeRole(person, event.target.value as Role)}>{roles.map((r) => <option key={r} value={r}>{formatStatus(r)}</option>)}</select></td><td><Badge tone={person.is_active ? 'success' : 'danger'}>{person.is_active ? 'Active' : 'Disabled'}</Badge></td><td>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(person.created_at))}</td><td><button className="history-button" onClick={() => void viewHistory(person)}><ShoppingBag size={14} /> View</button></td><td><button className={`icon-button ${person.is_active ? 'danger-icon' : 'enable-icon'}`} title={person.is_active ? 'Disable account' : 'Enable account'} disabled={busyId === person.id || person.id === account?.id} onClick={() => void toggleActive(person)}>{person.is_active ? <Ban size={16} /> : <Check size={16} />}</button></td></tr>{historyId === person.id && <tr className="history-expanded"><td colSpan={6}><div className="history-title"><strong>Order history · {person.name}</strong><button className="text-button" onClick={() => setHistoryId(null)}>Close</button></div>{history.length ? <div className="history-orders">{history.map((order) => <div key={order.id}><span>{order.public_id}</span><span>{friendlyDate(order.created_at)}</span><StatusBadge status={order.status} /><strong>{formatINR(order.total_paise)}</strong></div>)}</div> : <small>No orders recorded for this customer yet.</small>}</td></tr>}</Fragment>)}</tbody></table></div> : <EmptyState icon={<Users size={20} />} title="No people found" description={q ? 'Try another name, email, phone number or role.' : 'Accounts will appear here as guests and team members join.'} />}
      <PageControls limit={adminPageSize} offset={page * adminPageSize} total={total} onChange={(next) => { setPage(Math.floor(next / adminPageSize)); setLoading(true) }} />
    </section>
    {creating && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false) }}><section className="modal-card"><div className="modal-heading"><div><span className="eyebrow">ADD SOMEONE TO THE TABLE</span><h2>Create an account</h2></div><button className="icon-button" onClick={() => setCreating(false)} aria-label="Close"><X size={18} /></button></div><form className="modal-form" onSubmit={(event) => void createPerson(event)}><label className="field-label">Full name<input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Asha Kumar" /></label><label className="field-label">Email address<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="asha@example.com" /></label><label className="field-label">Phone <span className="field-optional">optional</span><input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+91 98765 43210" /></label><div className="modal-two-col"><label className="field-label">Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>{roles.map((r) => <option key={r} value={r}>{formatStatus(r)}</option>)}</select></label><label className="field-label">Temporary password<input type="password" minLength={10} maxLength={128} required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 10 characters" /></label></div><Notice tone="info">Share the temporary password with this person using your usual secure method.</Notice><div className="modal-actions"><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" disabled={busyId === -1}>{busyId === -1 ? 'Creating…' : 'Create account'} <ArrowRight size={15} /></Button></div></form></section></div>}
  </>
}

function MenuManagement() {
  const [items, setItems] = useState<MenuItem[]>([])
  const [menuCategories, setMenuCategories] = useState<{ id: number; name: string }[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const blank = { name: '', description: '', category: '', price_paise: 0, tax_percent: 18, image_url: '', image_urls: [] as string[], is_vegetarian: false, is_available: true, is_featured: false }
  const [form, setForm] = useState(blank)
  const refresh = useCallback(() => Promise.all([api<MenuItem[]>('/menu/manage'), api<{ id: number; name: string }[]>('/menu/categories')]).then(([menu, categories]) => { setItems(menu); setMenuCategories(categories) }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load the menu.')).finally(() => setLoading(false)), [])
  useEffect(() => { void refresh() }, [refresh])
  function openEdit(item: MenuItem) { setEditing(item); const imageUrls = item.image_urls?.length ? item.image_urls : item.image_url ? [item.image_url] : []; setForm({ ...item, price_paise: item.price_paise / 100, image_url: imageUrls[0] || '', image_urls: imageUrls }); setCreating(false) }
  function openCreate() { setCreating(true); setEditing(null); setForm(blank) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = { ...form, price_paise: Math.round(Number(form.price_paise) * 100), image_urls: form.image_urls, image_url: form.image_urls[0] || null }
    try {
      const updated = await api<MenuItem>(editing ? `/menu/${editing.id}` : '/menu', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(data) })
      setItems((old) => editing ? old.map((item) => item.id === updated.id ? updated : item) : [...old, updated].sort((a, b) => a.category.localeCompare(b.category)))
      setEditing(null); setCreating(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save this menu item.') }
    finally { setBusy(false) }
  }
  async function archive(item: MenuItem) {
    try { await api(`/menu/${item.id}`, { method: 'DELETE' }); setItems((old) => old.map((entry) => entry.id === item.id ? { ...entry, is_available: false } : entry)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not remove this item from the live menu.') }
  }
  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const name = newCategory.trim(); if (!name) return
    try { const created = await api<{ id: number; name: string }>('/menu/categories', { method: 'POST', body: JSON.stringify({ name }) }); setMenuCategories((old) => [...old, created].sort((a, b) => a.name.localeCompare(b.name))); setNewCategory('') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not add this category.') }
  }
  async function deleteCategory(category: { id: number; name: string }) {
    if (category.id === 0) { setError('This category is attached to existing menu data. Run the database migration before editing categories.'); return }
    const affected = items.filter((item) => item.category === category.name).length
    const warning = affected ? `Delete “${category.name}”? ${affected} ${affected === 1 ? 'menu item will' : 'menu items will'} have an empty category.` : `Delete “${category.name}”?`
    if (!window.confirm(warning)) return
    try { await api(`/menu/categories/${category.id}`, { method: 'DELETE' }); setItems((old) => old.map((item) => item.category === category.name ? { ...item, category: '' } : item)); setMenuCategories((old) => old.filter((entry) => entry.id !== category.id)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete this category.') }
  }
  async function editImage(index: number) {
    const current = form.image_urls[index] || ''
    const value = window.prompt(index === -1 ? 'Paste the image URL' : 'Paste the replacement image URL', current)
    if (value === null) return
    const url = value.trim()
    if (!url) { setError('Please enter an image URL.'); return }
    let imageUrl: string
    try {
      const parsed = new URL(url)
      const driveFileId = parsed.hostname === 'drive.google.com'
        ? parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get('id')
        : parsed.hostname === 'docs.google.com' ? parsed.searchParams.get('id') : null
      imageUrl = driveFileId
        ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w1200`
        : url
    } catch { setError('Please enter a valid image URL.'); return }
    const imageUrls = [...form.image_urls]
    if (index === -1) imageUrls.push(imageUrl)
    else imageUrls[index] = imageUrl
    setForm({ ...form, image_urls: imageUrls, image_url: imageUrls[0] || '' }); setError('')
  }
  function removeImage(index: number) { const imageUrls = form.image_urls.filter((_, imageIndex) => imageIndex !== index); setForm({ ...form, image_urls: imageUrls, image_url: imageUrls[0] || '' }) }
  const categories = menuCategories.length
  const showModal = creating || Boolean(editing)
  return <><PageTitle eyebrow="SET THE MENU, SET THE MOOD" title="Menu management" description="Keep the good stuff up to date, one plate at a time." action={<Button onClick={openCreate}><Plus size={16} /> Add a menu item</Button>} />{error && <Notice onDismiss={() => setError('')}>{error}</Notice>}
    <div className="menu-admin-stats"><div><span><CookingPot size={17} /></span><strong>{items.length}</strong><small>Total menu items</small></div><div><span><Check size={17} /></span><strong>{items.filter((item) => item.is_available).length}</strong><small>Available now</small></div><div><span><BadgeTag /></span><strong>{categories}</strong><small>Menu categories</small></div></div>
    <section className="admin-panel category-manager"><div className="panel-heading"><div><span className="eyebrow">ORGANIZE THE MENU</span><h2>Categories</h2></div></div><form className="category-add-form" onSubmit={(event) => void addCategory(event)}><input required minLength={2} maxLength={80} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category name" aria-label="New category name" /><Button type="submit" size="button-sm"><Plus size={14} /> Add category</Button></form><div className="category-list">{menuCategories.map((category) => <div className="category-chip" key={`${category.id}-${category.name}`}><span>{category.name}</span><small>{items.filter((item) => item.category === category.name).length} menus</small><button type="button" className="icon-button danger-icon" title={`Delete ${category.name}`} aria-label={`Delete ${category.name}`} onClick={() => void deleteCategory(category)}><Trash2 size={14} /></button></div>)}</div></section>
    {loading ? <Loading label="Laying out the menu…" /> : <div className="menu-admin-list">{items.map((item) => <article className={`menu-admin-card ${!item.is_available ? 'menu-item-muted' : ''}`} key={item.id}><div className={`menu-admin-art ${item.is_vegetarian ? 'admin-art-green' : 'admin-art-red'}`}>{item.image_urls?.length || item.image_url ? <MenuImageCarousel images={item.image_urls?.length ? item.image_urls : item.image_url ? [item.image_url] : []} alt={item.name} className="menu-gallery-admin" /> : <span>{item.is_vegetarian ? '🥬' : '🍢'}</span>}{item.is_featured && <i>✦</i>}</div><div className="menu-admin-main"><div className="menu-admin-tags"><Badge tone="soft">{item.category || 'Uncategorized'}</Badge>{item.is_vegetarian && <span className="veg-label">VEG</span>}{!item.is_available && <Badge tone="danger">Unavailable</Badge>}</div><h3>{item.name}</h3><p>{item.description || 'A KebabZilla favorite, made fresh.'}</p><div className="menu-admin-price">{formatINR(item.price_paise)} <small>+ {item.tax_percent}% tax</small></div></div><div className="menu-admin-actions"><button className="button button-secondary button-sm" onClick={() => openEdit(item)}><Edit3 size={14} /> Edit</button>{item.is_available && <button className="icon-button danger-icon" title="Remove from live menu" onClick={() => void archive(item)}><Trash2 size={16} /></button>}</div></article>)}</div>}
    {showModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setEditing(null); setCreating(false) } }}><section className="modal-card menu-modal"><div className="modal-heading"><div><span className="eyebrow">{editing ? 'REFINE THE RECIPE CARD' : 'ADD SOMETHING DELICIOUS'}</span><h2>{editing ? 'Edit menu item' : 'New menu item'}</h2></div><button className="icon-button" onClick={() => { setEditing(null); setCreating(false) }} aria-label="Close"><X size={18} /></button></div><form className="modal-form" onSubmit={(event) => void submit(event)}><label className="field-label">Item name<input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Smoky chicken tikka" /></label><label className="field-label">A tasty description<textarea rows={3} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What makes this one a favorite?" /></label><div className="modal-two-col"><label className="field-label">Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="">No category</option>{menuCategories.map((category) => <option key={category.name} value={category.name}>{category.name}</option>)}</select></label><label className="field-label">Price · INR<input required type="number" min="1" step="1" value={form.price_paise} onChange={(event) => setForm({ ...form, price_paise: Number(event.target.value) })} placeholder="299" /></label></div><label className="field-label">Tax rate · %<input required type="number" min="0" max="30" step="1" value={form.tax_percent} onChange={(event) => setForm({ ...form, tax_percent: Number(event.target.value) })} /><small>Applied to this menu item. New items default to 18%.</small></label><div className="field-label">Menu images <span className="field-optional">First image is the main photo</span><div className="menu-image-grid">{form.image_urls.map((url, index) => <div className="menu-image-tile" key={`${index}-${url}`}><img src={url} alt={`Menu image ${index + 1}`} onError={(event) => event.currentTarget.closest('.menu-image-tile')?.classList.add('menu-image-failed')} /><span className="menu-image-order">{index === 0 ? 'MAIN' : `#${index + 1}`}</span><div className="menu-image-actions"><button type="button" aria-label="Change image" title="Change image" onClick={() => void editImage(index)}><Edit3 size={13} /></button><button type="button" aria-label="Delete image" title="Delete image" onClick={() => removeImage(index)}><Trash2 size={13} /></button></div></div>)}<button type="button" className="menu-image-add" onClick={() => void editImage(-1)}><Plus size={25} /><span>Add image</span></button></div></div><div className="checkbox-settings"><label><input type="checkbox" checked={form.is_vegetarian} onChange={(event) => setForm({ ...form, is_vegetarian: event.target.checked })} /><span><strong>Vegetarian</strong><small>Show a green veg marker.</small></span></label><label><input type="checkbox" checked={form.is_available} onChange={(event) => setForm({ ...form, is_available: event.target.checked })} /><span><strong>Available</strong><small>Show on the customer menu.</small></span></label><label><input type="checkbox" checked={form.is_featured} onChange={(event) => setForm({ ...form, is_featured: event.target.checked })} /><span><strong>KZ pick</strong><small>Feature this menu favorite.</small></span></label></div><div className="modal-actions"><Button variant="secondary" onClick={() => { setEditing(null); setCreating(false) }}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add to menu'} <ArrowRight size={15} /></Button></div></form></section></div>}
  </>
}

function BadgeTag() { return <span className="badge-tag-icon">✦</span> }

function Reports() {
  const [period, setPeriod] = useState('week')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { setLoading(true); api<Report>(`/admin/reports/sales?period=${period}`).then(setReport).catch((err) => setError(err instanceof Error ? err.message : 'Could not load sales report.')).finally(() => setLoading(false)) }, [period])
  const maximum = Math.max(1, ...(report?.series || []).map((point) => point.revenue_paise))
  const paidPercent = report?.total_orders ? Math.round(report.paid_orders / report.total_orders * 100) : 0
  return <><PageTitle eyebrow="NUMBERS WITH A LITTLE MORE FLAVOR" title="Sales reports" description="A clear picture of sales, order volume and what people are loving." action={<label className="period-select"><BarChart3 size={15} /><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option></select><ChevronDown size={14} /></label>} />{error && <Notice>{error}</Notice>}
    {loading ? <Loading label="Crunching the numbers…" /> : report && <><div className="report-stat-grid"><div className="report-stat-card report-stat-primary"><span>PAID REVENUE</span><strong>{formatINR(report.revenue_paise)}</strong><small>For this {period}</small><span className="report-decoration">↗</span></div><div className="report-stat-card"><span>PAID ORDERS</span><strong>{report.paid_orders}</strong><small>{report.total_orders} placed in this {period}</small><span className="report-stat-icon"><ShoppingBag size={17} /></span></div><div className="report-stat-card"><span>AVERAGE ORDER</span><strong>{formatINR(report.average_order_paise)}</strong><small>Paid orders, all payment types</small><span className="report-stat-icon"><CreditCard size={17} /></span></div><div className="report-stat-card"><span>PAYMENT SUCCESS</span><strong>{paidPercent}%</strong><small>Payments currently marked paid</small><span className="report-stat-icon"><ShieldCheck size={17} /></span></div></div>
      <div className="report-content-grid"><section className="admin-panel report-chart-panel"><div className="panel-heading"><div><span className="eyebrow">SALES OVER TIME</span><h2>{period === 'day' ? 'Hourly sales' : period === 'year' ? 'Month by month' : 'Daily sales'}</h2></div><span className="report-total"><small>Total</small><strong>{formatINR(report.revenue_paise)}</strong></span></div><div className="report-chart"><div className="chart-axis"><span>{formatINR(maximum)}</span><span>{formatINR(maximum / 2)}</span><span>₹0</span></div><div className="chart-bars">{report.series.map((point, index) => <div className="chart-bar-wrap" key={`${index}-${point.label}`}><span className="chart-tip">{formatINR(point.revenue_paise)}<small>{point.orders} orders</small></span><div className={`chart-bar ${point.revenue_paise ? 'bar-highlight' : ''}`} style={{ height: `${Math.max(point.revenue_paise ? 7 : 2, point.revenue_paise / maximum * 100)}%` }} /><span className="chart-label">{point.label}</span></div>)}</div></div><div className="chart-legend"><span><i className="legend-dot" /> Paid revenue</span><span>Orders placed {formatStatus(period)}: {report.total_orders}</span></div></section>
        <div className="report-side-panels"><section className="admin-panel status-breakdown"><div className="panel-heading"><div><span className="eyebrow">IN THE FLOW</span><h2>Order status</h2></div><Activity size={16} /></div>{Object.entries(report.statuses).filter(([, count]) => count).length ? Object.entries(report.statuses).filter(([, count]) => count).sort((a, b) => b[1] - a[1]).map(([status, count]) => <div className="status-break-row" key={status}><StatusBadge status={status} /><strong>{count}</strong></div>) : <p className="report-no-data">No orders in this period.</p>}</section><section className="admin-panel bestsellers"><div className="panel-heading"><div><span className="eyebrow">GUEST FAVORITES</span><h2>Top sellers</h2></div><Flame size={16} /></div>{report.top_items.length ? report.top_items.map((item, index) => <div className="best-seller-row" key={item.name}><span>{index + 1}</span><strong>{item.name}</strong><b>{item.quantity}</b></div>) : <p className="report-no-data">No paid orders yet.</p>}</section></div></div></>}
  </>
}

function SettingsPage() {
  const [form, setForm] = useState<Restaurant | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { api<Restaurant>('/admin/settings').then((settings) => setForm({ ...settings, delivery_fee_paise: settings.delivery_fee_paise / 100, minimum_order_paise: settings.minimum_order_paise / 100 })).catch((err) => setError(err instanceof Error ? err.message : 'Could not load settings.')).finally(() => setLoading(false)) }, [])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form) return
    setBusy(true); setError(''); setNotice('')
    try { const updated = await api<Restaurant>('/admin/settings', { method: 'PUT', body: JSON.stringify({ ...form, delivery_fee_paise: Math.round(form.delivery_fee_paise * 100), minimum_order_paise: Math.round(form.minimum_order_paise * 100) }) }); setForm({ ...updated, delivery_fee_paise: updated.delivery_fee_paise / 100, minimum_order_paise: updated.minimum_order_paise / 100 }); setNotice('Restaurant details saved.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save these settings.') }
    finally { setBusy(false) }
  }
  if (loading) return <Loading label="Opening the settings book…" />
  if (!form) return <Notice>{error || 'Restaurant settings could not be loaded.'}</Notice>
  function change<K extends keyof Restaurant>(key: K, value: Restaurant[K]) { setForm((old) => old ? { ...old, [key]: value } : old) }
  return <><PageTitle eyebrow="A PLACE OF YOUR OWN" title="Restaurant settings" description="Keep your public details and checkout expectations up to date." />{notice && <Notice tone="success">{notice}</Notice>}{error && <Notice>{error}</Notice>}
    <form className="settings-form" onSubmit={(event) => void save(event)}><div className="settings-layout"><div className="settings-main"><section className="admin-panel settings-card"><div className="settings-section-heading"><span className="settings-icon"><LayoutDashboard size={17} /></span><span><strong>Restaurant profile</strong><small>The name and details your guests see.</small></span></div><div className="settings-fields"><label className="field-label">Restaurant name<input required maxLength={120} value={form.restaurant_name} onChange={(event) => change('restaurant_name', event.target.value)} /></label><label className="field-label">A short tagline<input maxLength={200} value={form.tagline} onChange={(event) => change('tagline', event.target.value)} /></label><label className="field-label">Phone number<input required maxLength={32} value={form.phone} onChange={(event) => change('phone', event.target.value)} /></label><label className="field-label">Restaurant address<input required maxLength={300} value={form.address} onChange={(event) => change('address', event.target.value)} /></label><label className="field-label full-field">Opening hours<input required maxLength={120} value={form.opening_hours} onChange={(event) => change('opening_hours', event.target.value)} /></label></div></section>
      <section className="admin-panel settings-card"><div className="settings-section-heading"><span className="settings-icon settings-icon-amber"><CircleDollarSign size={17} /></span><span><strong>Checkout & delivery</strong><small>Applied to new online orders.</small></span></div><div className="settings-fields settings-fields-compact"><label className="field-label">Delivery fee<input type="number" min="0" step="1" value={form.delivery_fee_paise} onChange={(event) => change('delivery_fee_paise', Number(event.target.value))} /><small>In rupees; currently {formatINR(Math.round(form.delivery_fee_paise * 100))}.</small></label><label className="field-label">Minimum order<input type="number" min="0" step="1" value={form.minimum_order_paise} onChange={(event) => change('minimum_order_paise', Number(event.target.value))} /><small>In rupees; set to zero to remove the minimum.</small></label><label className="field-label">Delivery radius (km)<input type="number" min="0.1" max="500" step="0.1" value={form.delivery_radius_km} onChange={(event) => change('delivery_radius_km', Number(event.target.value))} /><small>Enter the delivery coverage distance in kilometers.</small></label></div></section></div>
      <aside className="settings-aside"><section className="admin-panel accept-orders-card"><span className={`accept-status-mark ${form.accepting_orders ? '' : 'accept-paused'}`}>{form.accepting_orders ? <Check size={17} /> : <X size={17} />}</span><div><strong>{form.accepting_orders ? 'Open for orders' : 'Taking a breather'}</strong><small>{form.accepting_orders ? 'Guests can place new orders.' : 'New orders are paused for now.'}</small></div><label className="toggle-switch"><input type="checkbox" checked={form.accepting_orders} onChange={(event) => change('accepting_orders', event.target.checked)} /><span /></label></section><section className="settings-tip"><span><ShieldCheck size={16} /></span><p>Payment keys and database credentials live on the API server, never in these public restaurant settings.</p></section><Button type="submit" disabled={busy} className="full-width settings-save">{busy ? 'Saving…' : <>Save restaurant settings <Check size={16} /></>}</Button><small className="settings-save-hint">Changes take effect for new orders.</small></aside></div></form>
  </>
}

export default function Admin() {
  return <Routes><Route index element={<Overview />} /><Route path="orders" element={<AdminOrders />} /><Route path="menu" element={<MenuManagement />} /><Route path="team" element={<Team />} /><Route path="reports" element={<Reports />} /><Route path="settings" element={<SettingsPage />} /><Route path="*" element={<EmptyState icon={<LayoutDashboard size={20} />} title="That admin view isn’t on the menu" description="Choose a section from your restaurant workspace." action={<Link className="button button-secondary" to="/admin">Back to overview</Link>} />} /></Routes>
}
