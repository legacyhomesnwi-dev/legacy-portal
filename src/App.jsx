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
import crest from './assets/legacy-crest.png'
import Login from './pages/Login.jsx'
import LeadManager from './pages/LeadManager.jsx'
import MlsFastLane from './pages/MlsFastLane.jsx'
import DealUnderwriter from './pages/DealUnderwriter.jsx'
import ActivePipeline from './pages/ActivePipeline.jsx'

const NAV = [
  { to: '/leads', label: 'Lead Manager' },
  { to: '/mls-fast-lane', label: 'MLS Fast Lane' },
  { to: '/underwriter', label: 'Deal Underwriter' },
  { to: '/pipeline', label: 'Active Pipeline' },
]

const PAGE_META = {
  '/leads': {
    title: 'Lead Manager',
    subtitle: 'Work the queue by temperature — fire first.',
  },
  '/mls-fast-lane': {
    title: 'MLS Fast Lane',
    subtitle: 'Raw MLS intake and enrichment status — newest first.',
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

// ───────────────────────────────────────────────────────────────────────────
// TEMPORARY — PUBLIC READ-ONLY DEMO (set 2026-09-03)
//
// Supabase Auth was never built; only the <Login> UI shell exists. To get the
// portal in front of the team today, the auth gate is disabled below: the app
// renders Lead Manager / MLS Fast Lane / Deal Underwriter directly, no session
// required. All data is read through the anon key + the `anon_read_*` RLS
// policies, so this is genuinely read-only — nothing here can write.
//
// THIS IS NOT THE FINAL STATE. When real auth lands: set DEMO_PUBLIC = false
// (or delete it and the `if (DEMO_PUBLIC)` branch in App()). The original
// `if (!session)` redirect and the <Login> route are left fully intact right
// where they were, so re-gating is a one-line change.
// ───────────────────────────────────────────────────────────────────────────
const DEMO_PUBLIC = true

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
      <img className="sidebar-logo" src={crest} alt="" />
      <span>
        <span className="brand-name">Legacy Homes NWI</span>
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

  // --- Normal auth flow (disabled while DEMO_PUBLIC is true; see note above) ---
  if (!DEMO_PUBLIC) {
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
  }

  return (
    <AppShell session={session ?? null}>
      <Routes>
        <Route path="/" element={<Navigate to="/leads" replace />} />
        {/* Login screen stays viewable in demo mode; real auth just isn't wired yet */}
        <Route
          path="/login"
          element={DEMO_PUBLIC ? <Login /> : <Navigate to="/leads" replace />}
        />
        <Route path="/leads" element={<LeadManager />} />
        <Route path="/mls-fast-lane" element={<MlsFastLane />} />
        <Route path="/underwriter" element={<DealUnderwriter />} />
        <Route path="/pipeline" element={<ActivePipeline />} />
        <Route path="*" element={<Navigate to="/leads" replace />} />
      </Routes>
    </AppShell>
  )
}
