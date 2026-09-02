import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const TABS = [
  { key: 'FIRE', label: 'Fire', cls: 'temp-fire' },
  { key: 'HOT', label: 'Hot', cls: 'temp-hot' },
  { key: 'WARM', label: 'Warm', cls: 'temp-warm' },
]

// Shown when the `leads` table is empty or not reachable yet, so the queue
// always renders something useful during setup.
const SAMPLE_LEADS = [
  {
    id: 's1',
    name: 'Marcus Reilly',
    address: '4821 Sheffield Ave, Hammond, IN',
    temperature: 'FIRE',
    source: 'PPC',
    motivation: 'Pre-foreclosure, needs out in 30 days',
    est_value: 142000,
    last_contact: '2h ago',
  },
  {
    id: 's2',
    name: 'Dana Whitfield',
    address: '1207 Ridge Rd, Munster, IN',
    temperature: 'FIRE',
    source: 'Cold call',
    motivation: 'Inherited, vacant, tired landlord',
    est_value: 205000,
    last_contact: 'Yesterday',
  },
  {
    id: 's3',
    name: 'Tyrone Beckett',
    address: '9 Lincoln St, Gary, IN',
    temperature: 'HOT',
    source: 'Direct mail',
    motivation: 'Relocating for work in Q2',
    est_value: 88000,
    last_contact: '3d ago',
  },
  {
    id: 's4',
    name: 'Priya Nandakumar',
    address: '3344 Calumet Ave, Valparaiso, IN',
    temperature: 'HOT',
    source: 'Referral',
    motivation: 'Divorce, wants a clean sale',
    est_value: 261000,
    last_contact: '4d ago',
  },
  {
    id: 's5',
    name: 'Walt & Carol Jensen',
    address: '712 Birch Ln, Portage, IN',
    temperature: 'WARM',
    source: 'SEO',
    motivation: 'Downsizing, no urgency yet',
    est_value: 178000,
    last_contact: '1w ago',
  },
  {
    id: 's6',
    name: 'Andre Coleman',
    address: '58 Garfield St, East Chicago, IN',
    temperature: 'WARM',
    source: 'Facebook',
    motivation: 'Curious about cash offer',
    est_value: 96000,
    last_contact: '2w ago',
  },
]

function money(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString('en-US')}`
}

function LeadCard({ lead }) {
  const tab = TABS.find((t) => t.key === lead.temperature)
  return (
    <article className="lead-card">
      <div className="lead-main">
        <div className="lead-name">{lead.name}</div>
        <div className="lead-address">{lead.address}</div>
        <div className="lead-meta">
          {lead.source && (
            <span>
              <b>Source</b> · {lead.source}
            </span>
          )}
          {lead.motivation && (
            <span>
              <b>Motivation</b> · {lead.motivation}
            </span>
          )}
          {lead.last_contact && (
            <span>
              <b>Last touch</b> · {lead.last_contact}
            </span>
          )}
        </div>
      </div>
      <div className="lead-side">
        <span className={`temp ${tab?.cls ?? ''}`}>{lead.temperature}</span>
        <span className="lead-value">{money(lead.est_value)}</span>
        <button className="btn btn-sm">Work lead</button>
      </div>
    </article>
  )
}

export default function LeadManager() {
  const [active, setActive] = useState('FIRE')
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [usingSample, setUsingSample] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('leads')
        .select('id, name, address, temperature, source, motivation, est_value, last_contact')
        .order('est_value', { ascending: false })

      if (cancelled) return

      if (error || !data || data.length === 0) {
        setLeads(SAMPLE_LEADS)
        setUsingSample(true)
      } else {
        setLeads(data)
        setUsingSample(false)
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const counts = useMemo(() => {
    const c = { FIRE: 0, HOT: 0, WARM: 0 }
    for (const l of leads) {
      if (c[l.temperature] != null) c[l.temperature] += 1
    }
    return c
  }, [leads])

  const visible = leads.filter((l) => l.temperature === active)

  return (
    <div>
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={active === tab.key ? 'tab active' : 'tab'}
            onClick={() => setActive(tab.key)}
          >
            <span className={`temp ${tab.cls}`}>{tab.label}</span>
            <span className="tab-count">{counts[tab.key]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">
          <div className="spinner" />
          Loading leads…
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">✓</div>
          <strong>Queue clear</strong>
          <span>No {active.toLowerCase()} leads waiting. Nice work.</span>
        </div>
      ) : (
        <div className="lead-list">
          {visible.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}

      {usingSample && !loading && (
        <p className="login-foot" style={{ textAlign: 'left', marginTop: 20 }}>
          Showing sample data — connect the <code>leads</code> table in Supabase to
          see the live queue.
        </p>
      )}
    </div>
  )
}
