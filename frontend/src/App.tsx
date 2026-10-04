import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { Activity, ArrowLeft, BarChart3, Boxes, ClipboardList, CookingPot, LayoutDashboard, LogIn, LogOut, MapPinned, Menu as MenuIcon, PackageCheck, Plus, Settings, ShoppingBag, Users, X, Send, Percent, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from './state'
import type { Role } from './api'
import { Brand, Button, Notice } from './components'
import Storefront from './pages/Storefront'
import OrdersPage from './pages/Orders'
import Operations from './pages/Operations'
import Delivery from './pages/Delivery'
import Admin from './pages/Admin'
import AuthPage from './pages/AuthPage'
import Profile from './pages/Profile'
import ForcedPasswordChange from './pages/ForcedPasswordChange'

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean; tone?: 'employee' | 'delivery' }

function defaultQuickPaths(role: Role): string[] {
  if (role === 'ADMIN') return ['/admin', '/admin/orders', '/admin/menu']
  if (role === 'EMPLOYEE') return ['/ops', '/ops/menu', '/ops/billing']
  if (role === 'DELIVERY') return ['/delivery', '/delivery/routes']
  return []
}

function savedQuickPaths(role: Role): string[] {
  const saved = localStorage.getItem(`kz_quick_${role}`)
  if (saved === null) return defaultQuickPaths(role)
  try { return (JSON.parse(saved) as string[]).filter((path) => path !== '/admin/preview' && path !== '/admin/takeover') } catch { return defaultQuickPaths(role) }
}

function homeFor(role: Role) {
  if (role === 'ADMIN') return '/admin'
  if (role === 'EMPLOYEE') return '/ops'
  if (role === 'DELIVERY') return '/delivery'
  return '/'
}

function navFor(role: Role): NavItem[] {
  if (role === 'ADMIN') return [
    { to: '/admin', label: 'Overview', icon: <LayoutDashboard size={17} />, end: true },
    { to: '/admin/orders', label: 'Orders', icon: <ClipboardList size={17} /> },
    { to: '/admin/menu', label: 'Menu', icon: <CookingPot size={17} /> },
    { to: '/admin/team', label: 'People', icon: <Users size={17} /> },
    { to: '/admin/activity', label: 'Activity', icon: <Activity size={17} /> },
    { to: '/admin/offers', label: 'Broadcast Offer', icon: <Send size={17} /> },
    { to: '/admin/discounts', label: 'Discounts', icon: <Percent size={17} /> },
    { to: '/ops', label: 'Order queue', icon: <ClipboardList size={17} />, end: true, tone: 'employee' },
    { to: '/ops/menu', label: 'Menu availability', icon: <CookingPot size={17} />, tone: 'employee' },
    { to: '/ops/billing', label: 'Walk-in billing', icon: <ShoppingBag size={17} />, tone: 'employee' },
    { to: '/ops/drafts', label: 'Saved drafts', icon: <Boxes size={17} />, tone: 'employee' },
    { to: '/delivery', label: 'Delivery queue', icon: <PackageCheck size={17} />, end: true, tone: 'delivery' },
    { to: '/delivery/routes', label: 'Route batches', icon: <MapPinned size={17} />, tone: 'delivery' },
    { to: '/admin/reports', label: 'Sales reports', icon: <BarChart3 size={17} /> },
    { to: '/admin/settings', label: 'Restaurant settings', icon: <Settings size={17} /> },
  ]
  if (role === 'EMPLOYEE') return [
    { to: '/ops', label: 'Order queue', icon: <ClipboardList size={17} />, end: true },
    { to: '/ops/menu', label: 'Menu availability', icon: <CookingPot size={17} /> },
    { to: '/ops/billing', label: 'Walk-in billing', icon: <ShoppingBag size={17} /> },
    { to: '/ops/drafts', label: 'Saved drafts', icon: <Boxes size={17} /> },
  ]
  if (role === 'DELIVERY') return [
    { to: '/delivery', label: 'My delivery queue', icon: <PackageCheck size={17} />, end: true },
    { to: '/delivery/routes', label: 'Route batches', icon: <MapPinned size={17} /> },
  ]
  return []
}

function AppHeader() {
  const { account, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [quickItems, setQuickItems] = useState<string[]>(() => account ? savedQuickPaths(account.role) : [])
  const [quickExpanded, setQuickExpanded] = useState(false)
  const [tabsOverflow, setTabsOverflow] = useState(false)
  const topNavRef = useRef<HTMLElement>(null)
  const tabDrag = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null)
  const tabWasDragged = useRef(false)
  const navigate = useNavigate()
  const items = account ? navFor(account.role) : []
  useEffect(() => {
    if (!account) return
    setQuickItems(savedQuickPaths(account.role))
  }, [account?.role])
  // Keep the quick-tab selection intentionally unbounded. The top navigation
  // scrolls horizontally when it no longer fits instead of hiding a tab.
  const selected = items.filter((item) => quickItems.includes(item.to))
  useEffect(() => {
    const nav = topNavRef.current
    if (!nav) return
    const checkOverflow = () => setTabsOverflow(nav.scrollWidth > nav.clientWidth + 1)
    checkOverflow()
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [selected.length])
  function scrollTabs(direction: -1 | 1) {
    topNavRef.current?.scrollBy({ left: direction * 220, behavior: 'smooth' })
  }
  function saveQuick(path: string) {
    const next = quickItems.includes(path) ? quickItems.filter((item) => item !== path) : [...quickItems, path]
    setQuickItems(next)
    if (account) localStorage.setItem(`kz_quick_${account.role}`, JSON.stringify(next))
  }
  return <>
  <header className="app-header">
    <div className="header-inner">
      <div className="header-brand">{account && items.length > 0 ? <button className="workspace-drawer-trigger" aria-label="Open workspace menu" onClick={() => { setQuickExpanded(false); setMobileOpen(true) }}><MenuIcon size={19} /></button> : <Brand />}</div>
      <div className="header-center">
        {account && items.length > 0 ? <div className={`top-nav-shell${tabsOverflow ? ' has-overflow' : ''}`}>{tabsOverflow && <button className="top-nav-arrow top-nav-arrow-left" type="button" onClick={() => scrollTabs(-1)} aria-label="Scroll tabs left"><ChevronLeft size={16} /></button>}<nav ref={topNavRef} className="top-nav" onDragStart={(event) => event.preventDefault()} onClickCapture={(event) => { if (tabWasDragged.current) { event.preventDefault(); event.stopPropagation(); tabWasDragged.current = false } }} onPointerDown={(event) => { if (event.button !== 0) return; tabWasDragged.current = false; tabDrag.current = { pointerId: event.pointerId, startX: event.clientX, startScroll: event.currentTarget.scrollLeft } }} onPointerMove={(event) => { const drag = tabDrag.current; if (!drag || drag.pointerId !== event.pointerId) return; const distance = event.clientX - drag.startX; if (Math.abs(distance) > 4) tabWasDragged.current = true; event.currentTarget.scrollLeft = drag.startScroll - distance }} onPointerUp={(event) => { if (tabDrag.current?.pointerId === event.pointerId) tabDrag.current = null }} onPointerCancel={() => { tabDrag.current = null }}>{selected.map((item) => <NavLink key={item.to} end={item.end} to={item.to} className={({ isActive }) => `${isActive ? 'top-nav-link active' : 'top-nav-link'}${item.tone ? ` staff-nav-${item.tone}` : ''}`}>{item.label}</NavLink>)}</nav>{tabsOverflow && <button className="top-nav-arrow top-nav-arrow-right" type="button" onClick={() => scrollTabs(1)} aria-label="Scroll tabs right"><ChevronRight size={16} /></button>}</div> : null}
      </div>
      <div className="header-account">
        {account ? <><div className="profile-menu-wrap"><button className="account-chip" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}><span className="avatar">{account.name.slice(0, 1).toUpperCase()}</span><span className="account-name">{account.name.split(' ')[0]}</span><span className="role-dot" title={account.role} /></button>{profileOpen && <div className="profile-dropdown">{account.role === 'USER' && <Link to="/orders" onClick={() => setProfileOpen(false)}><ClipboardList size={16} /> Track orders</Link>}<Link to="/profile" onClick={() => setProfileOpen(false)}><Users size={16} /> Edit profile</Link></div>}</div><button className="icon-button" title="Sign out" onClick={() => { signOut(); navigate('/') }}><LogOut size={18} /></button></> : <><NavLink className="header-login" to="/login"><LogIn size={16} /> <span>Sign in</span></NavLink><NavLink className="header-join" to="/register">Sign up <Plus size={15} /></NavLink></>}
      </div>
    </div>
  </header>
  {mobileOpen && account?.role !== 'USER' && createPortal(<div className="workspace-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileOpen(false) }}><aside className="workspace-drawer"><div className="workspace-drawer-head"><div><small>{account?.role || 'GUEST'} WORKSPACE</small><strong>Navigation</strong></div><button className="icon-button" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button></div><section className="drawer-quick-settings"><button className="drawer-quick-toggle" aria-expanded={quickExpanded} onClick={() => setQuickExpanded((expanded) => !expanded)}><span><strong>Quick access</strong><small>Choose any tabs to keep at the top.</small></span><ChevronDown className={quickExpanded ? 'expanded' : ''} size={18} /></button>{quickExpanded && <div className="drawer-quick-options">{items.map((item) => <label className={item.tone ? `staff-nav-${item.tone}` : ''} key={item.to}><input type="checkbox" checked={quickItems.includes(item.to)} onChange={() => saveQuick(item.to)} />{item.icon}{item.label}</label>)}</div>}</section><nav className="drawer-all-links">{items.filter((item) => !quickItems.includes(item.to)).map((item) => <NavLink key={item.to} end={item.end} to={item.to} onClick={() => setMobileOpen(false)} className={({ isActive }) => `${isActive ? 'sidebar-link active' : 'sidebar-link'}${item.tone ? ` staff-nav-${item.tone}` : ''}`}>{item.icon}<span>{item.label}</span></NavLink>)}</nav><button className="sidebar-signout" onClick={() => { signOut(); setMobileOpen(false); navigate('/') }}><LogOut size={16} /> Sign out</button></aside></div>, document.body)}
  </>
}

function WorkspaceNav() {
  return null
}

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { account } = useAuth()
  return <div className="workspace-layout"><WorkspaceNav /><main className="workspace-main"><div className="workspace-mobile-label"><span className="role-kicker">{account?.role} WORKSPACE</span></div>{children}</main></div>
}

function RoleGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { account, loading } = useAuth()
  if (loading) return <div className="app-loading"><Activity className="spin" size={22} /> <span>Getting things ready…</span></div>
  if (!account) return <Navigate to="/login" replace />
  if (!roles.includes(account.role)) return <Navigate to={homeFor(account.role)} replace />
  return <>{children}</>
}

export default function App() {
  const { account } = useAuth()
  const [notice, setNotice] = useState<string | null>(null)
  if (account?.must_change_password) return <div className="app-shell"><AppHeader /><div className="app-main"><Routes><Route path="/change-password" element={<ForcedPasswordChange />} /><Route path="*" element={<Navigate to="/change-password" replace />} /></Routes></div></div>
  return <div className="app-shell">
    <AppHeader />
    {notice && <div className="global-notice"><Notice tone="success" onDismiss={() => setNotice(null)}>{notice}</Notice></div>}
    <div className="app-main"><Routes>
      <Route path="/" element={<Storefront />} />
      <Route path="/login" element={account ? <Navigate to={homeFor(account.role)} replace /> : <AuthPage mode="login" />} />
      <Route path="/register" element={account ? <Navigate to={homeFor(account.role)} replace /> : <AuthPage mode="register" />} />
      <Route path="/forgot-password" element={account ? <Navigate to={homeFor(account.role)} replace /> : <AuthPage mode="recovery" />} />
      <Route path="/workspace" element={account ? <Navigate to={homeFor(account.role)} replace /> : <Navigate to="/login" replace />} />
      <Route path="/orders" element={<RoleGuard roles={['USER']}><OrdersPage /></RoleGuard>} />
      <Route path="/profile" element={<RoleGuard roles={['USER', 'ADMIN', 'EMPLOYEE', 'DELIVERY']}><Profile /></RoleGuard>} />
      <Route path="/ops/*" element={<RoleGuard roles={['EMPLOYEE', 'ADMIN']}><WorkspaceLayout><Operations /></WorkspaceLayout></RoleGuard>} />
      <Route path="/delivery/*" element={<RoleGuard roles={['DELIVERY', 'ADMIN']}><WorkspaceLayout><Delivery /></WorkspaceLayout></RoleGuard>} />
      <Route path="/admin/*" element={<RoleGuard roles={['ADMIN']}><WorkspaceLayout><Admin /></WorkspaceLayout></RoleGuard>} />
      <Route path="*" element={<main className="not-found"><div className="eyebrow">404 · THAT PLATE WENT MISSING</div><h1>We got a little lost.</h1><p>Let’s take you somewhere with more flavor.</p><Button onClick={() => window.location.hash = '#/'}><ArrowLeft size={16} /> Back to the menu</Button></main>} />
    </Routes></div>
    <footer className="app-footer"><Brand compact /><div className="footer-copy">© {new Date().getFullYear()} KebabZilla.</div></footer>
  </div>
}


