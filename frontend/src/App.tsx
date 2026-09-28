import { useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { Activity, ArrowLeft, BarChart3, Boxes, ClipboardList, CookingPot, LayoutDashboard, LogIn, LogOut, MapPinned, Menu as MenuIcon, PackageCheck, Plus, Settings, ShoppingBag, Users, X } from 'lucide-react'
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

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean }

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
    { to: '/admin/reports', label: 'Sales reports', icon: <BarChart3 size={17} /> },
    { to: '/admin/settings', label: 'Restaurant settings', icon: <Settings size={17} /> },
  ]
  if (role === 'EMPLOYEE') return [
    { to: '/ops', label: 'Order queue', icon: <ClipboardList size={17} />, end: true },
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
  const navigate = useNavigate()
  const items = account ? navFor(account.role) : []
  return <header className="app-header">
    <div className="header-inner">
      <div className="header-brand"><button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X /> : <MenuIcon />}</button><Brand /></div>
      <div className="header-center">
        {account && items.length > 0 ? <nav className="top-nav">{items.map((item) => <NavLink key={item.to} end={item.end} to={item.to} className={({ isActive }) => isActive ? 'top-nav-link active' : 'top-nav-link'}>{item.label}</NavLink>)}</nav> : null}
      </div>
      <div className="header-account">
        {account ? <><div className="profile-menu-wrap"><button className="account-chip" aria-expanded={profileOpen} onClick={() => account.role === 'USER' ? setProfileOpen((open) => !open) : navigate(homeFor(account.role))}><span className="avatar">{account.name.slice(0, 1).toUpperCase()}</span><span className="account-name">{account.name.split(' ')[0]}</span><span className="role-dot" title={account.role} /></button>{profileOpen && account.role === 'USER' && <div className="profile-dropdown"><Link to="/orders" onClick={() => setProfileOpen(false)}><ClipboardList size={16} /> Track orders</Link><Link to="/profile" onClick={() => setProfileOpen(false)}><Users size={16} /> Edit profile</Link></div>}</div><button className="icon-button" title="Sign out" onClick={() => { signOut(); navigate('/') }}><LogOut size={18} /></button></> : <><NavLink className="header-login" to="/login"><LogIn size={16} /> <span>Sign in</span></NavLink><NavLink className="header-join" to="/register">Join us <Plus size={15} /></NavLink></>}
      </div>
    </div>
    {mobileOpen && <div className="mobile-menu"><div className="mobile-menu-content">{account?.role === 'USER' ? <><NavLink className="mobile-nav-link" to="/orders" onClick={() => setMobileOpen(false)}><ClipboardList size={17} /> Track orders</NavLink><NavLink className="mobile-nav-link" to="/profile" onClick={() => setMobileOpen(false)}><Users size={17} /> Edit profile</NavLink></> : account ? items.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className="mobile-nav-link">{item.icon}{item.label}</NavLink>) : <><NavLink className="mobile-nav-link" to="/login" onClick={() => setMobileOpen(false)}>Sign in</NavLink><NavLink className="mobile-nav-link" to="/register" onClick={() => setMobileOpen(false)}>Create an account</NavLink></>}</div></div>}
  </header>
}

function WorkspaceNav() {
  const { account, signOut } = useAuth()
  if (!account || account.role === 'USER') return null
  return <aside className="workspace-sidebar">
    <div className="sidebar-label">WORKSPACE</div>
    <nav className="sidebar-links">{navFor(account.role).map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}>{item.icon}<span>{item.label}</span></NavLink>)}</nav>
    <div className="sidebar-bottom"><div className="sidebar-open"><span className="pulse-dot" /><span>Restaurant open</span></div><button className="sidebar-signout" onClick={signOut}><LogOut size={15} /> Sign out</button></div>
  </aside>
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
  return <div className="app-shell">
    <AppHeader />
    {notice && <div className="global-notice"><Notice tone="success" onDismiss={() => setNotice(null)}>{notice}</Notice></div>}
    <div className="app-main"><Routes>
      <Route path="/" element={<Storefront />} />
      <Route path="/login" element={account ? <Navigate to={homeFor(account.role)} replace /> : <AuthPage mode="login" />} />
      <Route path="/register" element={account ? <Navigate to={homeFor(account.role)} replace /> : <AuthPage mode="register" />} />
      <Route path="/workspace" element={account ? <Navigate to={homeFor(account.role)} replace /> : <Navigate to="/login" replace />} />
      <Route path="/orders" element={<RoleGuard roles={['USER']}><OrdersPage /></RoleGuard>} />
      <Route path="/profile" element={<RoleGuard roles={['USER']}><Profile /></RoleGuard>} />
      <Route path="/ops/*" element={<RoleGuard roles={['EMPLOYEE', 'ADMIN']}><WorkspaceLayout><Operations /></WorkspaceLayout></RoleGuard>} />
      <Route path="/delivery/*" element={<RoleGuard roles={['DELIVERY']}><WorkspaceLayout><Delivery /></WorkspaceLayout></RoleGuard>} />
      <Route path="/admin/*" element={<RoleGuard roles={['ADMIN']}><WorkspaceLayout><Admin /></WorkspaceLayout></RoleGuard>} />
      <Route path="*" element={<main className="not-found"><div className="eyebrow">404 · THAT PLATE WENT MISSING</div><h1>We got a little lost.</h1><p>Let’s take you somewhere with more flavor.</p><Button onClick={() => window.location.hash = '#/'}><ArrowLeft size={16} /> Back to the menu</Button></main>} />
    </Routes></div>
    <footer className="app-footer"><Brand compact /><div className="footer-copy">© {new Date().getFullYear()} KebabZilla.</div></footer>
  </div>
}
