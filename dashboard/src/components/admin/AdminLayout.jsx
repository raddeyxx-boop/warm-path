import { Clock3, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const ITEMS = [
  { id: 'pending', label: 'Pending Users', icon: Clock3 },
  { id: 'add', label: 'Add User', icon: UserPlus },
  { id: 'users', label: 'All Users', icon: Users },
]

export function AdminLayout({
  activeSection,
  adminEmail,
  children,
  onLogout,
  onSectionChange,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const collapseTimer = useRef(null)
  const sidebarRef = useRef(null)
  const menuButtonRef = useRef(null)

  function cancelCollapse() {
    window.clearTimeout(collapseTimer.current)
  }

  function revealSidebar() {
    cancelCollapse()
    if (window.matchMedia('(max-width: 900px), (prefers-reduced-motion: reduce)').matches) return
    setCollapsed(false)
  }

  function scheduleCollapse() {
    cancelCollapse()
    if (window.matchMedia('(max-width: 900px), (prefers-reduced-motion: reduce)').matches) return
    if (sidebarRef.current?.contains(document.activeElement)) return
    collapseTimer.current = window.setTimeout(() => setCollapsed(true), 600)
  }

  function selectSection(section, event) {
    onSectionChange(section)
    setMobileOpen(false)
    if (window.matchMedia('(max-width: 900px)').matches) menuButtonRef.current?.focus()
    else if (event?.detail > 0) event.currentTarget.blur()
  }

  useEffect(() => () => cancelCollapse(), [])

  useEffect(() => {
    if (!mobileOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sidebarRef.current?.querySelector('button, [href]')?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setMobileOpen(false)
        menuButtonRef.current?.focus()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...sidebarRef.current.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobileOpen])

  const initials = String(adminEmail || 'Admin').slice(0, 2).toUpperCase()

  return (
    <main className={`admin-command-shell ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-drawer-open' : ''}`}>
      <div className="admin-command-background" aria-hidden="true"><span /><span /><span /></div>
      <button
        ref={menuButtonRef}
        type="button"
        className="admin-mobile-menu"
        aria-label="Open admin navigation"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <Menu size={20} />
      </button>
      {mobileOpen ? <button type="button" className="admin-drawer-overlay" aria-label="Close admin navigation" onClick={() => setMobileOpen(false)} /> : null}
      <aside
        ref={sidebarRef}
        className="admin-command-sidebar"
        onMouseEnter={revealSidebar}
        onMouseLeave={scheduleCollapse}
        onFocusCapture={cancelCollapse}
        onBlurCapture={scheduleCollapse}
      >
        <div className="admin-sidebar-brand">
          <div className="admin-brand-mark" aria-hidden="true"><ShieldCheck size={23} /></div>
          <div className="admin-sidebar-copy">
            <strong>INDPRO</strong>
            <span>ADMIN CONTROL</span>
          </div>
          <button
            type="button"
            className="admin-sidebar-toggle"
            aria-label={collapsed ? 'Expand admin navigation' : 'Collapse admin navigation'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button type="button" className="admin-sidebar-close" aria-label="Close admin navigation" onClick={() => setMobileOpen(false)}>
            <X size={19} />
          </button>
        </div>

        <div className="admin-identity">
          <span>{initials}</span>
          <div className="admin-sidebar-copy">
            <small>AUTHENTICATED ADMIN</small>
            <strong title={adminEmail}>{adminEmail || 'Administrator'}</strong>
          </div>
        </div>

        <nav className="admin-sidebar-nav" aria-label="Admin navigation">
          {ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={collapsed ? label : undefined}
              className={activeSection === id ? 'is-active' : ''}
              aria-current={activeSection === id ? 'page' : undefined}
              aria-label={label}
              onClick={(event) => selectSection(id, event)}
            >
              <Icon size={19} aria-hidden="true" />
              <span className="admin-sidebar-copy">{label}</span>
              {activeSection === id ? <i aria-hidden="true" /> : null}
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-system-state">
            <span aria-hidden="true" />
            <div className="admin-sidebar-copy">
              <small>SESSION STATUS</small>
              <strong>Authenticated</strong>
            </div>
          </div>
          <button type="button" className="admin-logout-button" onClick={onLogout} aria-label="Logout">
            <LogOut size={18} aria-hidden="true" />
            <span className="admin-sidebar-copy">Logout</span>
          </button>
        </div>
      </aside>
      <section className="admin-command-main">{children}</section>
    </main>
  )
}
