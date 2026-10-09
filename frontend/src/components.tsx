import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleAlert, ImageOff, LoaderCircle, Minus, Plus, Search, X } from 'lucide-react'
import { createPortal } from 'react-dom'
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

export function RoundedSelect({ value, options, onChange, className = '', disabled = false, ariaLabel, icon }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  ariaLabel?: string
  icon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ position: 'fixed', top: 0, left: -10000, minWidth: 0, visibility: 'hidden' })
  const selected = options.find((option) => option.value === value)
  useLayoutEffect(() => {
    if (!open) return
    const positionMenu = () => {
      const triggerRect = trigger.current?.getBoundingClientRect()
      const menuElement = menu.current
      if (!triggerRect || !menuElement) return

      const viewportPadding = 8
      const availableBelow = window.innerHeight - triggerRect.bottom - viewportPadding * 2
      const availableAbove = triggerRect.top - viewportPadding * 2
      const menuHeight = Math.min(menuElement.scrollHeight, 280)
      const placeAbove = availableBelow < menuHeight && availableAbove > availableBelow
      const maxHeight = Math.max(80, Math.min(280, placeAbove ? availableAbove : availableBelow))
      const width = Math.min(Math.max(triggerRect.width, menuElement.scrollWidth), window.innerWidth - viewportPadding * 2)
      const left = Math.max(viewportPadding, Math.min(triggerRect.left, window.innerWidth - width - viewportPadding))
      const top = placeAbove
        ? Math.max(viewportPadding, triggerRect.top - 7 - Math.min(menuHeight, maxHeight))
        : Math.min(window.innerHeight - viewportPadding, triggerRect.bottom + 7)

      setMenuPosition({ position: 'fixed', top, left, right: 'auto', width: 'max-content', minWidth: triggerRect.width, maxWidth: window.innerWidth - viewportPadding * 2, maxHeight, zIndex: 1000, visibility: 'visible' })
    }
    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [open, options.length])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <div className={`rounded-select ${className}`} ref={root}>
    <button ref={trigger} type="button" className={`rounded-select-trigger ${icon ? 'has-icon' : ''}`} aria-label={ariaLabel || selected?.label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      {icon && <span className="rounded-select-icon">{icon}</span>}
      <span className="rounded-select-label">{selected?.label || 'Choose…'}</span>
      <ChevronDown aria-hidden="true" className={`rounded-select-chevron ${open ? 'open' : ''}`} size={14} strokeWidth={1.8} />
    </button>
    {open && createPortal(<div ref={menu} className="rounded-select-menu" style={menuPosition} role="listbox" aria-label={ariaLabel}>{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpen(false) }}>{option.label}</button>)}</div>, document.body)}
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
  const [modalOpen, setModalOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [failedSource, setFailedSource] = useState('')

  useEffect(() => {
    if (!modalOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setModalOpen(false)
      } else if (event.key === 'ArrowLeft' && urls.length > 1) {
        setActive((curr) => (curr + urls.length - 1) % urls.length)
      } else if (event.key === 'ArrowRight' && urls.length > 1) {
        setActive((curr) => (curr + 1) % urls.length)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [modalOpen, urls.length])

  if (!urls.length) return null

  const mainUrl = urls[0]

  return (
    <>
      <div
        className={`menu-image-carousel menu-image-thumb-trigger ${className}`}
        role="button"
        tabIndex={0}
        aria-label={`View photos of ${alt}`}
        onClick={(event) => {
          event.stopPropagation()
          event.preventDefault()
          setActive(0)
          setModalOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation()
            event.preventDefault()
            setActive(0)
            setModalOpen(true)
          }
        }}
      >
        {failedSource === mainUrl ? (
          <span className="menu-image-unavailable">
            <ImageOff size={22} />
            <small>Image unavailable</small>
          </span>
        ) : (
          <img src={mainUrl} alt={alt} onError={() => setFailedSource(mainUrl)} />
        )}
        {urls.length > 1 && (
          <span className="menu-photo-multi-badge" title={`${urls.length} photos · Click to view`}>
            <span>{urls.length}</span>
          </span>
        )}
      </div>

      {modalOpen &&
        createPortal(
          <div
            className="menu-lightbox-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`${alt} photos`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                event.stopPropagation()
                setModalOpen(false)
              }
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="menu-lightbox-square-card">
              <div className="menu-lightbox-topbar">
                <div className="menu-lightbox-info">
                  <strong className="menu-lightbox-title">{alt}</strong>
                  {urls.length > 1 && (
                    <span className="menu-lightbox-count">
                      {active + 1} / {urls.length}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="menu-lightbox-close"
                  aria-label="Close photo viewer"
                  onClick={(event) => {
                    event.stopPropagation()
                    setModalOpen(false)
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="menu-lightbox-image-viewport">
                {failedSource === urls[active] ? (
                  <div className="menu-image-unavailable">
                    <ImageOff size={32} />
                    <small>Image unavailable</small>
                  </div>
                ) : (
                  <img
                    src={urls[active]}
                    alt={`${alt} · photo ${active + 1}`}
                    className="menu-lightbox-big-img"
                    onError={() => setFailedSource(urls[active])}
                  />
                )}

                {urls.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="menu-lightbox-arrow prev"
                      aria-label="Previous photo"
                      onClick={(event) => {
                        event.stopPropagation()
                        setActive((curr) => (curr + urls.length - 1) % urls.length)
                      }}
                    >
                      <ArrowLeft size={20} />
                    </button>
                    <button
                      type="button"
                      className="menu-lightbox-arrow next"
                      aria-label="Next photo"
                      onClick={(event) => {
                        event.stopPropagation()
                        setActive((curr) => (curr + 1) % urls.length)
                      }}
                    >
                      <ArrowRight size={20} />
                    </button>
                  </>
                )}
              </div>

              {urls.length > 1 && (
                <div className="menu-lightbox-bottombar">
                  <div className="menu-lightbox-dots" role="tablist">
                    {urls.map((url, dotIndex) => (
                      <button
                        type="button"
                        key={`${dotIndex}-${url}`}
                        role="tab"
                        aria-selected={dotIndex === active}
                        className={`menu-lightbox-dot ${dotIndex === active ? 'active' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setActive(dotIndex)
                        }}
                        aria-label={`Go to photo ${dotIndex + 1}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

export function HeroArrow() { return <ArrowRight size={17} /> }
