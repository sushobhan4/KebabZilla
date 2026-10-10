import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { Activity, ArrowLeft, BarChart3, ClipboardList, CookingPot, LayoutDashboard, LogIn, LogOut, Menu as MenuIcon, PackageCheck, Plus, Settings, Users, X, Send, Percent, ChevronDown, ChevronLeft, ChevronRight, Phone, MapPin } from 'lucide-react'
import { useAuth, useRestaurant } from './state'
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
import { getPreference, setPreference } from './cookies'
import { CookieConsentBanner, CookiePolicyModal, CookiePreferencesModal } from './components/CookieConsent'

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean; tone?: 'employee' | 'delivery' }

function defaultQuickPaths(role: Role): string[] {
  if (role === 'ADMIN') return ['/admin', '/admin/orders', '/admin/menu']
  if (role === 'EMPLOYEE') return ['/ops', '/ops/menu']
  if (role === 'DELIVERY') return ['/delivery']
  return []
}

function savedQuickPaths(role: Role): string[] {
  const saved = getPreference<string[]>(`kz_quick_${role}`, defaultQuickPaths(role))
  return (saved || []).filter((path) => path !== '/admin/preview' && path !== '/admin/takeover' && path !== '/ops/drafts')
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
    { to: '/delivery', label: 'Delivery queue', icon: <PackageCheck size={17} />, end: true, tone: 'delivery' },
    { to: '/admin/reports', label: 'Sales reports', icon: <BarChart3 size={17} /> },
    { to: '/admin/settings', label: 'Restaurant settings', icon: <Settings size={17} /> },
  ]
  if (role === 'EMPLOYEE') return [
    { to: '/ops', label: 'Order queue', icon: <ClipboardList size={17} />, end: true },
    { to: '/ops/menu', label: 'Menu availability', icon: <CookingPot size={17} /> },
  ]
  if (role === 'DELIVERY') return [
    { to: '/delivery', label: 'Deliveries', icon: <PackageCheck size={17} />, end: true },
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
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [maxCenterWidth, setMaxCenterWidth] = useState<number | null>(null)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 700)
  const topNavRef = useRef<HTMLElement>(null)
  const headerInnerRef = useRef<HTMLDivElement>(null)
  const headerBrandRef = useRef<HTMLDivElement>(null)
  const headerAccountRef = useRef<HTMLDivElement>(null)
  const tabDrag = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null)
  const tabWasDragged = useRef(false)
  const navigate = useNavigate()
  const items = account ? navFor(account.role) : []
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 700)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  useEffect(() => {
    if (!account) return
    setQuickItems(savedQuickPaths(account.role))
  }, [account?.role])
  // Keep the quick-tab selection intentionally unbounded. The top navigation
  // scrolls horizontally when it no longer fits instead of hiding a tab.
  const selected = items.filter((item) => quickItems.includes(item.to))

  const updateScrollIndicators = () => {
    const nav = topNavRef.current
    if (!nav) return
    setCanScrollLeft(nav.scrollLeft > 4)
    setCanScrollRight(nav.scrollLeft < nav.scrollWidth - nav.clientWidth - 4)
  }

  useEffect(() => {
    const updateDynamicLayout = () => {
      const inner = headerInnerRef.current
      const brand = headerBrandRef.current
      const accountEl = headerAccountRef.current
      const nav = topNavRef.current
      if (!inner || !brand || !accountEl || !nav) return

      const innerRect = inner.getBoundingClientRect()
      const brandRect = brand.getBoundingClientRect()
      const accountRect = accountEl.getBoundingClientRect()

      const centerCoord = innerRect.left + innerRect.width / 2
      const safetyMargin = 16

      // Max available space on left of center without touching brand
      const leftAvailable = Math.max(40, (centerCoord - brandRect.right) - safetyMargin)
      // Max available space on right of center without touching account
      const rightAvailable = Math.max(40, (accountRect.left - centerCoord) - safetyMargin)

      // Symmetric width centered at 50% that guarantees zero overlap on both sides
      const availableSymmetric = Math.floor(2 * Math.min(leftAvailable, rightAvailable))

      setMaxCenterWidth(availableSymmetric > 0 ? availableSymmetric : null)

      // Natural width of the tab items
      const isOverflowing = nav.scrollWidth > availableSymmetric
      setTabsOverflow(isOverflowing)

      if (isOverflowing) {
        setCanScrollLeft(nav.scrollLeft > 4)
        setCanScrollRight(nav.scrollLeft < nav.scrollWidth - nav.clientWidth - 4)
      } else {
        setCanScrollLeft(false)
        setCanScrollRight(false)
      }
    }

    updateDynamicLayout()

    const observer = new ResizeObserver(updateDynamicLayout)
    if (headerInnerRef.current) observer.observe(headerInnerRef.current)
    if (headerBrandRef.current) observer.observe(headerBrandRef.current)
    if (headerAccountRef.current) observer.observe(headerAccountRef.current)
    if (topNavRef.current) observer.observe(topNavRef.current)

    window.addEventListener('resize', updateDynamicLayout)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateDynamicLayout)
    }
  }, [selected.length, account?.role])

  function scrollTabs(direction: -1 | 1) {
    topNavRef.current?.scrollBy({ left: direction * 220, behavior: 'smooth' })
    setTimeout(updateScrollIndicators, 320)
  }
  function saveQuick(path: string) {
    const next = quickItems.includes(path) ? quickItems.filter((item) => item !== path) : [...quickItems, path]
    setQuickItems(next)
    if (account) {
      setPreference(`kz_quick_${account.role}`, next)
    }
  }

  const showTopTabs = account?.role === 'ADMIN' ? items.length > 0 : account?.role === 'EMPLOYEE' ? (!isMobile && items.length > 0) : false
  const showSidebarDrawer = account?.role === 'ADMIN' ? items.length > 0 : account?.role === 'EMPLOYEE' ? (isMobile && items.length > 0) : false
  const showQuickSettings = account?.role === 'ADMIN'

  return <>
  <header className="app-header">
    <div className="header-inner" ref={headerInnerRef}>
      <div className="header-brand" ref={headerBrandRef}>
        {showSidebarDrawer ? (
          <>
            <button className="workspace-drawer-trigger" aria-label="Open workspace menu" onClick={() => { setQuickExpanded(false); setMobileOpen(true) }}>
              <MenuIcon size={19} />
            </button>
            <Brand />
          </>
        ) : (
          <Brand />
        )}
      </div>
      <div className="header-center" style={{ maxWidth: maxCenterWidth ? `${maxCenterWidth}px` : undefined }}>
        {showTopTabs ? (
          <div className={`top-nav-shell${tabsOverflow ? ' has-overflow' : ''}`}>
            {tabsOverflow && (
              <button
                className="top-nav-arrow top-nav-arrow-left"
                type="button"
                disabled={!canScrollLeft}
                style={{ opacity: canScrollLeft ? 1 : 0.2, pointerEvents: canScrollLeft ? 'auto' : 'none' }}
                onClick={() => scrollTabs(-1)}
                aria-label="Scroll tabs left"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <nav
              ref={topNavRef}
              className="top-nav"
              onScroll={updateScrollIndicators}
              onDragStart={(event) => event.preventDefault()}
              onClickCapture={(event) => {
                if (tabWasDragged.current) {
                  event.preventDefault()
                  event.stopPropagation()
                  tabWasDragged.current = false
                }
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                tabWasDragged.current = false
                tabDrag.current = { pointerId: event.pointerId, startX: event.clientX, startScroll: event.currentTarget.scrollLeft }
              }}
              onPointerMove={(event) => {
                const drag = tabDrag.current
                if (!drag || drag.pointerId !== event.pointerId) return
                const distance = event.clientX - drag.startX
                if (Math.abs(distance) > 4) tabWasDragged.current = true
                event.currentTarget.scrollLeft = drag.startScroll - distance
                updateScrollIndicators()
              }}
              onPointerUp={(event) => {
                if (tabDrag.current?.pointerId === event.pointerId) tabDrag.current = null
              }}
              onPointerCancel={() => {
                tabDrag.current = null
              }}
            >
              {(account?.role === 'EMPLOYEE' ? items : selected).map((item) => (
                <NavLink
                  key={item.to}
                  end={item.end}
                  to={item.to}
                  className={({ isActive }) => `${isActive ? 'top-nav-link active' : 'top-nav-link'}${item.tone ? ` staff-nav-${item.tone}` : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            {tabsOverflow && (
              <button
                className="top-nav-arrow top-nav-arrow-right"
                type="button"
                disabled={!canScrollRight}
                style={{ opacity: canScrollRight ? 1 : 0.2, pointerEvents: canScrollRight ? 'auto' : 'none' }}
                onClick={() => scrollTabs(1)}
                aria-label="Scroll tabs right"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        ) : null}
      </div>
      <div className="header-account" ref={headerAccountRef}>
        {account ? (
          <>
            <div className="profile-menu-wrap">
              <button className="account-chip" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>
                <span className="avatar">{account.name.slice(0, 1).toUpperCase()}</span>
                <span className="account-name">{account.name.split(' ')[0]}</span>
                <span className="role-dot" title={account.role} />
              </button>
              {profileOpen && (
                <div className="profile-dropdown">
                  {account.role === 'USER' && (
                    <Link to="/orders" onClick={() => setProfileOpen(false)}>
                      <ClipboardList size={16} /> Track orders
                    </Link>
                  )}
                  <Link to="/profile" onClick={() => setProfileOpen(false)}>
                    <Users size={16} /> Edit profile
                  </Link>
                </div>
              )}
            </div>
            <button className="icon-button" title="Sign out" onClick={() => { signOut(); navigate('/') }}>
              <LogOut size={18} />
            </button>
          </>
        ) : (
          <>
            <NavLink className="header-login" to="/login">
              <LogIn size={16} /> <span>Sign in</span>
            </NavLink>
            <NavLink className="header-join" to="/register">
              Sign up <Plus size={15} />
            </NavLink>
          </>
        )}
      </div>
    </div>
  </header>
  {mobileOpen && showSidebarDrawer && createPortal(
    <div className="workspace-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileOpen(false) }}>
      <aside className="workspace-drawer">
        <div className="workspace-drawer-head">
          <div>
            <small>{account?.role || 'GUEST'} WORKSPACE</small>
            <strong>Navigation</strong>
          </div>
          <button className="icon-button" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        {showQuickSettings && !isMobile && (
          <section className="drawer-quick-settings">
            <button className="drawer-quick-toggle" aria-expanded={quickExpanded} onClick={() => setQuickExpanded((expanded) => !expanded)}>
              <span>
                <strong>Quick access</strong>
                <small>Choose any tabs to keep at the top.</small>
              </span>
              <ChevronDown className={quickExpanded ? 'expanded' : ''} size={18} />
            </button>
            {quickExpanded && (
              <div className="drawer-quick-options">
                {items.map((item) => (
                  <label className={item.tone ? `staff-nav-${item.tone}` : ''} key={item.to}>
                    <input type="checkbox" checked={quickItems.includes(item.to)} onChange={() => saveQuick(item.to)} />
                    {item.icon}
                    {item.label}
                  </label>
                ))}
              </div>
            )}
          </section>
        )}
        <nav className="drawer-all-links">
          {(isMobile || !showQuickSettings ? items : items.filter((item) => !quickItems.includes(item.to))).map((item) => (
            <NavLink
              key={item.to}
              end={item.end}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `${isActive ? 'sidebar-link active' : 'sidebar-link'}${item.tone ? ` staff-nav-${item.tone}` : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </div>,
    document.body
  )}
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

function NotFound() {
  const navigate = useNavigate()
  return <main className="not-found"><div className="eyebrow">404 · THAT PLATE WENT MISSING</div><h1>We got a little lost.</h1><p>Let’s take you somewhere with more flavor.</p><Button onClick={() => navigate('/')}><ArrowLeft size={16} /> Back to the menu</Button></main>
}

export default function App() {
  const { account } = useAuth()
  const { restaurant } = useRestaurant()
  const [notice, setNotice] = useState<string | null>(null)
  const [cookiePolicyOpen, setCookiePolicyOpen] = useState(false)
  const [cookiePreferencesOpen, setCookiePreferencesOpen] = useState(false)

  const phoneList = (restaurant?.phones && restaurant.phones.length > 0)
    ? restaurant.phones
    : restaurant?.phone
      ? restaurant.phone.split(',').map((p) => p.trim()).filter(Boolean)
      : []

  const googleMapsUrl = restaurant?.latitude != null && restaurant?.longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${restaurant.latitude},${restaurant.longitude}`
    : restaurant?.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.address)}`
      : null

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
      <Route path="*" element={<NotFound />} />
    </Routes></div>
    <footer className="app-footer">
      <div className="footer-identity-col">
        <Brand compact showTagline={false} />
        <div className="footer-copy">© {new Date().getFullYear()} {restaurant?.restaurant_name || 'KebabZilla'}. All rights reserved.</div>
        <div className="footer-cookie-links">
          <button type="button" className="footer-cookie-link" onClick={() => setCookiePolicyOpen(true)}>
            Cookie Policy
          </button>
          <span>·</span>
          <button
            type="button"
            className="footer-cookie-link"
            onClick={() => setCookiePreferencesOpen(true)}
          >
            Cookie Preferences
          </button>
        </div>
      </div>
      <div className="footer-contact-col">
        {phoneList.length > 0 && (
          <div className="footer-phone-list">
            <Phone size={14} className="footer-icon" />
            <div className="footer-phones">
              {phoneList.map((num, idx) => (
                <a key={idx} href={`tel:${num}`} className="footer-phone-link">
                  {num}
                </a>
              ))}
            </div>
          </div>
        )}
        {restaurant?.address && (
          googleMapsUrl ? (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-address-link"
              title="Open location on Google Maps"
            >
              <MapPin size={14} className="footer-icon" />
              <span>{restaurant.address}</span>
            </a>
          ) : (
            <div className="footer-address-text">
              <MapPin size={14} className="footer-icon" />
              <span>{restaurant.address}</span>
            </div>
          )
        )}
      </div>
    </footer>
    <CookieConsentBanner
      onOpenPolicy={() => setCookiePolicyOpen(true)}
      onOpenCustomize={() => setCookiePreferencesOpen(true)}
    />
    <CookiePreferencesModal
      open={cookiePreferencesOpen}
      onClose={() => setCookiePreferencesOpen(false)}
    />
    <CookiePolicyModal
      open={cookiePolicyOpen}
      onClose={() => setCookiePolicyOpen(false)}
      onOpenSettings={() => {
        setCookiePolicyOpen(false);
        setCookiePreferencesOpen(true);
      }}
    />
  </div>
}

