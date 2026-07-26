import { BarChart3, BriefcaseBusiness, Database, LogOut, Menu, Moon, RefreshCcw, Route, Search, ShieldCheck, Sun, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { PolygonMotif } from '../components/PolygonMotif'
import { getConnectionState } from '../lib/supabase'
import { ConfigState } from '../components/StateBlocks'

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: BarChart3 },
  { to: '/top-candidates', label: 'Top Candidates', icon: BriefcaseBusiness },
  { to: '/candidates', label: 'All Candidates', icon: Users },
  { to: '/runs', label: 'Workflow Runs', icon: Route },
  { to: '/find-target', label: 'Find a New Target', icon: Search },
]

const titles = {
  '/dashboard': 'Overview',
  '/top-candidates': 'Top Candidates',
  '/candidates': 'All Candidates',
  '/runs': 'Workflow Runs',
  '/find-target': 'Find a New Target',
}

const subtitles = {
  '/dashboard': 'Relationship intelligence, candidate ranking, and workflow insight.',
  '/top-candidates': 'The highest-priority warm paths from your latest scoring run.',
  '/candidates': 'Search, filter, and inspect every valid ranked candidate.',
  '/runs': 'Monitor completed workflow runs and their linked candidate outputs.',
  '/find-target': 'Enter a target and optional people filters to start a new warm-path search.',
}

const DASHBOARD_THEME_KEY = 'warm-path-dashboard-theme'
const SIDEBAR_CLOSE_DELAY = 220

function Sidebar({ mobileOpen, desktopVisible, onClose, onPointerEnter, onPointerLeave }) {
  return (
    <>
      <aside
        className={`sidebar ${mobileOpen ? 'sidebar-open' : ''} ${desktopVisible ? 'sidebar-visible' : 'sidebar-hidden'}`}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <PolygonMotif
          size={152}
          sides={5}
          cornerRounding={0.08}
          surface="deep-dark"
          className="polygon-float polygon-float-subtle"
          style={{ right: -18, bottom: -8, transform: 'rotate(62deg)' }}
        />
        <div className="brand">
          <div className="brand-mark">WP</div>
          <div>
            <strong>Warm Path Finder</strong>
            <span>Relationship intelligence</span>
          </div>
          <button type="button" className="icon-button mobile-only" onClick={onClose} aria-label="Close navigation">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/dashboard'} onClick={onClose}>
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </NavLink>
            )
          })}
        </nav>
      </aside>
      {mobileOpen ? <button type="button" className="drawer-scrim" aria-label="Close navigation" onClick={onClose} /> : null}
    </>
  )
}

export function AppLayout() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarVisible, setDesktopSidebarVisible] = useState(true)
  const [, setLastRefreshed] = useState(null)
  const [refreshHandler, setRefreshHandler] = useState(null)
  const [dashboardTheme, setDashboardTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return window.localStorage.getItem(DASHBOARD_THEME_KEY) === 'dark' ? 'dark' : 'light'
  })
  const closeTimerRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const connection = getConnectionState()
  const auth = useAuth()

  function clearSidebarTimers() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  function startDesktopSidebarReveal() {
    if (!window.matchMedia('(min-width: 1041px) and (hover: hover) and (pointer: fine)').matches) return
    clearSidebarTimers()
    setDesktopSidebarVisible(true)
  }

  function keepDesktopSidebarOpen() {
    clearSidebarTimers()
  }

  function scheduleDesktopSidebarClose() {
    if (!window.matchMedia('(min-width: 1041px)').matches) return
    closeTimerRef.current = setTimeout(() => {
      setDesktopSidebarVisible(false)
      closeTimerRef.current = null
    }, SIDEBAR_CLOSE_DELAY)
  }

  useEffect(() => clearSidebarTimers, [])

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_THEME_KEY, dashboardTheme)
  }, [dashboardTheme])

  useEffect(() => {
    document.documentElement.classList.add('dashboard-scrollbar-hidden')
    document.body.classList.add('dashboard-scrollbar-hidden')

    return () => {
      document.documentElement.classList.remove('dashboard-scrollbar-hidden')
      document.body.classList.remove('dashboard-scrollbar-hidden')
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b'
      if (isShortcut && window.matchMedia('(max-width: 1040px)').matches) {
        event.preventDefault()
        setMobileSidebarOpen((open) => !open)
      }
      if (event.key === 'Escape') {
        setMobileSidebarOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!mobileSidebarOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileSidebarOpen])

  const title = useMemo(() => {
    if (location.pathname.startsWith('/candidates/')) return 'Candidate Details'
    if (location.pathname.startsWith('/runs/')) return 'Workflow Run Details'
    return titles[location.pathname] || 'Dashboard'
  }, [location.pathname])

  const subtitle = useMemo(() => {
    if (location.pathname.startsWith('/candidates/')) return 'Full candidate profile, analysis, and introduction context.'
    if (location.pathname.startsWith('/runs/')) return 'A workflow report with target, candidates, and linked top recommendations.'
    return subtitles[location.pathname] || 'Warm Path Finder workspace.'
  }, [location.pathname])

  async function handleLogout() {
    await auth.signOut()
    navigate('/login', { replace: true })
  }

  const context = useMemo(
    () => ({
      dashboardTheme,
      setPageMeta: ({ lastRefreshed: refreshed, refresh }) => {
        setLastRefreshed(refreshed || null)
        setRefreshHandler(() => refresh || null)
      },
    }),
    [dashboardTheme],
  )

  return (
    <div className={`app-shell dashboard-${dashboardTheme} ${desktopSidebarVisible ? 'sidebar-is-visible' : 'sidebar-is-hidden'}`}>
      <PolygonMotif
        size={360}
        sides={5}
        cornerRounding={0.08}
        surface="light"
        className="polygon-float"
        style={{ position: 'fixed', top: -116, right: -120, transform: 'rotate(38deg)' }}
      />
      <PolygonMotif
        size={260}
        sides={5}
        cornerRounding={0.08}
        surface="light"
        className="polygon-float polygon-float-reverse"
        style={{ position: 'fixed', left: -138, bottom: 72, transform: 'rotate(-28deg)' }}
      />
      <div
        className="sidebar-activation-zone"
        aria-hidden="true"
        onPointerEnter={startDesktopSidebarReveal}
        onPointerLeave={scheduleDesktopSidebarClose}
      />
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        desktopVisible={desktopSidebarVisible}
        onClose={() => setMobileSidebarOpen(false)}
        onPointerEnter={keepDesktopSidebarOpen}
        onPointerLeave={scheduleDesktopSidebarClose}
      />
      <div className="main-shell">
        <header className="topbar">
          <button type="button" className="icon-button mobile-only" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation">
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="topbar-title">
            <p className="eyebrow">Warm Path Finder</p>
            <h1>{title}</h1>
            <p className="topbar-subtitle">{subtitle}</p>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button dashboard-theme-toggle"
              onClick={() => setDashboardTheme((theme) => theme === 'light' ? 'dark' : 'light')}
              aria-label={`Switch to ${dashboardTheme === 'light' ? 'dark' : 'light'} dashboard design`}
              aria-pressed={dashboardTheme === 'dark'}
              title={`Use ${dashboardTheme === 'light' ? 'dark' : 'light'} design`}
            >
              {dashboardTheme === 'light'
                ? <Moon size={18} aria-hidden="true" />
                : <Sun size={18} aria-hidden="true" />}
            </button>
            <span
              className={`connection ${connection.configured ? 'connection-ok' : 'connection-bad'}`}
              aria-label={connection.configured ? 'Supabase connected' : 'Supabase connection unavailable'}
              role="status"
            >
              <span className="connection-dot" aria-hidden="true" />
              <Database size={15} aria-hidden="true" />
            </span>
            <button type="button" className="button button-primary" onClick={() => refreshHandler?.()} disabled={!refreshHandler}>
              <RefreshCcw size={16} aria-hidden="true" />
              Refresh
            </button>
            {auth.isAdmin ? (
              <button type="button" className="button button-secondary" onClick={() => navigate('/admin')}>
                <ShieldCheck size={16} aria-hidden="true" />
                Admin
              </button>
            ) : null}
            <button type="button" className="icon-button" onClick={handleLogout} aria-label="Logout">
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className="content">
          {connection.error ? <ConfigState message={connection.error} /> : <Outlet key={auth.user?.id} context={context} />}
        </main>
      </div>
    </div>
  )
}
