import { useEffect, useState } from 'react'
import {
  Routes,
  Route,
  Navigate,
  NavLink,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import LeadManager from './pages/LeadManager.jsx'
import DealUnderwriter from './pages/DealUnderwriter.jsx'
import ActivePipeline from './pages/ActivePipeline.jsx'

const NAV = [
  { to: '/leads', label: 'Lead Manager' },
  { to: '/underwriter', label: 'Deal Underwriter' },
  { to: '/pipeline', label: 'Active Pipeline' },
]

const PAGE_META = {
  '/leads': {
    title: 'Lead Manager',
    subtitle: 'Work the queue by temperature — fire first.',
  },
  '/underwriter': {
    title: 'Deal Underwriter',
    subtitle: 'Run the numbers on a property.',
  },
  '/pipeline': {
    title: 'Active Pipeline',
    subtitle: 'Deals under contract through close.',
  },
}

/** Tracks the Supabase auth session. `undefined` = still loading. */
function useSession() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  return session
}

function BrandBlock() {
  return (
    <div className="brand">
      <span className="brand-mark">L</span>
      <span>
        <span className="brand-name">Legacy Home Buyers</span>
        <br />
        <span className="brand-sub">Team Portal</span>
      </span>
    </div>
  )
}

function AppShell({ session, children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const meta = PAGE_META[location.pathname] ?? { title: 'Portal', subtitle: '' }
  const email = session?.user?.email ?? ''

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <BrandBlock />
        <nav className="nav">
          <span className="nav-label">Workspace</span>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              <span className="nav-dot" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {email && <span className="user-email">{email}</span>}
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="page-title">{meta.title}</div>
            {meta.subtitle && <div className="page-subtitle">{meta.subtitle}</div>}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}

export default function App() {
  const session = useSession()

  if (session === undefined) {
    return (
      <div className="loading">
        <div>
          <div className="spinner" />
          Loading portal…
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <AppShell session={session}>
      <Routes>
        <Route path="/" element={<Navigate to="/leads" replace />} />
        <Route path="/login" element={<Navigate to="/leads" replace />} />
        <Route path="/leads" element={<LeadManager />} />
        <Route path="/underwriter" element={<DealUnderwriter />} />
        <Route path="/pipeline" element={<ActivePipeline />} />
        <Route path="*" element={<Navigate to="/leads" replace />} />
      </Routes>
    </AppShell>
  )
}
