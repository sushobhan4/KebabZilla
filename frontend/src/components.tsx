import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, CircleAlert, ImageOff, LoaderCircle, Minus, Plus, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE, formatStatus } from './api'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className={`brand ${compact ? 'brand-compact' : ''}`} to="/" aria-label="KebabZilla home">
    <span className="brand-mark"><img src="/kebabzilla-mark.png" alt="" /></span>
    <span className="brand-word">Kebab<span>Zilla</span></span>
  </Link>
}

export function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-title-row"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="page-action">{action}</div>}</div>
}

export function RoundedSelect({ value, options, onChange, className = '', disabled = false, ariaLabel }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <div className={`rounded-select ${className}`} ref={root}>
    <button type="button" className="rounded-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <span>{selected?.label || 'Choose…'}</span><span className={`rounded-select-chevron ${open ? 'open' : ''}`}>⌄</span>
    </button>
    {open && <div className="rounded-select-menu" role="listbox" aria-label={ariaLabel}>{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpen(false) }}>{option.label}</button>)}</div>}
  </div>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'DELIVERED' || status === 'PAID' ? 'success' : status === 'REJECTED' || status === 'CANCELLED' || status === 'FAILED' ? 'danger' : status === 'READY' || status === 'OUT_FOR_DELIVERY' || status === 'REFUND_PENDING' ? 'amber' : status === 'REFUNDED' ? 'soft' : 'neutral'
  return <Badge tone={tone}>{formatStatus(status)}</Badge>
}

export function Button({ children, variant = 'primary', size = '', className = '', type = 'button', disabled, onClick }: {
  children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'light'; size?: string; className?: string; type?: 'button' | 'submit'; disabled?: boolean; onClick?: () => void
}) {
  return <button className={`button button-${variant} ${size} ${className}`} type={type} disabled={disabled} onClick={onClick}>{children}</button>
}

export function Loading({ label = 'Loading your table…' }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>
}

export function Notice({ children, tone = 'error', onDismiss }: { children: ReactNode; tone?: 'error' | 'success' | 'info'; onDismiss?: () => void }) {
  return <div className={`notice notice-${tone}`} role="status"><span className="notice-icon">{tone === 'success' ? <Check size={17} /> : <CircleAlert size={17} />}</span><span>{children}</span>{onDismiss && <button className="notice-dismiss" aria-label="Dismiss" onClick={onDismiss}><X size={16} /></button>}</div>
}

export function EmptyState({ icon = <Search size={20} />, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>
}

export function QuantityPicker({ quantity, onChange, small = false }: { quantity: number; onChange: (value: number) => void; small?: boolean }) {
  return <div className={`quantity-picker ${small ? 'quantity-small' : ''}`}>
    <button aria-label="Remove one" onClick={() => onChange(Math.max(0, quantity - 1))}><Minus size={13} /></button>
    <span>{quantity}</span>
    <button aria-label="Add one" onClick={() => onChange(quantity + 1)}><Plus size={13} /></button>
  </div>
}

export function MenuImageCarousel({ images, alt, className = '' }: { images: string[]; alt: string; className?: string }) {
  const urls = images.filter(Boolean).map((url) => {
    try {
      const parsed = new URL(url)
      const fileId = parsed.hostname === 'drive.google.com' ? parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get('id') : null
      return fileId ? `${API_BASE}/menu/images/${encodeURIComponent(fileId)}` : url
    } catch { return url }
  })
  const [active, setActive] = useState(0)
  const [failedSource, setFailedSource] = useState('')
  if (!urls.length) return null
  const index = active % urls.length
  return <div className={`menu-image-carousel ${className}`} role="group" aria-label={`${alt} photos`} onClick={(event) => event.stopPropagation()}>
    {failedSource === urls[index] ? <span className="menu-image-unavailable"><ImageOff size={22} /><small>Image unavailable</small></span> : <img src={urls[index]} alt={`${alt} · image ${index + 1}`} onError={() => setFailedSource(urls[index])} />}
    {urls.length > 1 && <><button type="button" className="menu-gallery-arrow menu-gallery-prev" aria-label="Previous image" onClick={() => setActive((value) => (value + urls.length - 1) % urls.length)}><ArrowLeft size={14} /></button><button type="button" className="menu-gallery-arrow menu-gallery-next" aria-label="Next image" onClick={() => setActive((value) => (value + 1) % urls.length)}><ArrowRight size={14} /></button><div className="menu-gallery-dots" role="radiogroup" aria-label="Choose menu image">{urls.map((url, dot) => <button type="button" role="radio" aria-checked={index === dot} aria-label={`Show image ${dot + 1}`} key={`${dot}-${url}`} onClick={() => setActive(dot)}><span /></button>)}</div></>}
  </div>
}

export function HeroArrow() { return <ArrowRight size={17} /> }
