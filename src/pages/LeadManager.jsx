import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Tabs match the six motivation_tier values the scoring engine emits.
const TABS = [
  { key: 'FIRE', label: 'Fire', cls: 'temp-fire' },
  { key: 'HOT', label: 'Hot', cls: 'temp-hot' },
  { key: 'WARM', label: 'Warm', cls: 'temp-warm' },
  { key: 'NURTURE', label: 'Nurture', cls: 'temp-nurture' },
  { key: 'LOW', label: 'Low', cls: 'temp-low' },
  { key: 'INSUFFICIENT_DATA', label: 'Insufficient', cls: 'temp-insufficient' },
]
const TIER_CLASS = Object.fromEntries(TABS.map((t) => [t.key, t.cls]))

function money(n) {
  if (n == null || n === '') return '—'
  return `$${Number(n).toLocaleString('en-US')}`
}

// lead_scores is append-only — a lead accumulates score rows over time.
// Collapse to the most recent row per property_id (latest scored_at wins).
function latestScoreByProperty(scoreRows) {
  const byProp = new Map()
  const sorted = [...scoreRows].sort(
    (a, b) => new Date(b.scored_at) - new Date(a.scored_at)
  )
  for (const row of sorted) {
    if (!byProp.has(row.property_id)) byProp.set(row.property_id, row)
  }
  return byProp
}

function countByTier(rows) {
  const c = Object.fromEntries(TABS.map((t) => [t.key, 0]))
  for (const r of rows) {
    if (r.motivation_tier && c[r.motivation_tier] != null) c[r.motivation_tier] += 1
  }
  return c
}

export default function LeadManager() {
  const [rows, setRows] = useState([]) // leads joined to their latest score
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [active, setActive] = useState('FIRE')
  const [rtStatus, setRtStatus] = useState('connecting') // connecting | live | error
  const pickedTab = useRef(false)

  const fetchData = useCallback(async () => {
    const [leadsRes, scoresRes] = await Promise.all([
      supabase.from('leads').select('id, owner_name, city, assessed_value'),
      supabase
        .from('lead_scores')
        .select(
          'property_id, motivation_score, motivation_tier, primary_signals, scored_at'
        )
        .order('scored_at', { ascending: false }),
    ])

    const err = leadsRes.error || scoresRes.error
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    const latest = latestScoreByProperty(scoresRes.data || [])
    const joined = (leadsRes.data || []).map((lead) => {
      const s = latest.get(lead.id) || null
      return {
        id: lead.id,
        owner_name: lead.owner_name,
        city: lead.city,
        assessed_value: lead.assessed_value,
        motivation_score: s != null ? Number(s.motivation_score) : null,
        motivation_tier: s ? s.motivation_tier : null,
        primary_signals: (s && s.primary_signals) || [],
        scored_at: s ? s.scored_at : null,
      }
    })

    setError('')
    setRows(joined)
    setLoading(false)

    // On first successful load, land on the first tab that actually has leads.
    if (!pickedTab.current) {
      const counts = countByTier(joined)
      const firstWithRows = TABS.find((t) => counts[t.key] > 0)
      if (firstWithRows) setActive(firstWithRows.key)
      pickedTab.current = true
    }
  }, [])

  useEffect(() => {
    fetchData()

    // Real-time: any insert/update/delete on either table -> refetch.
    // Five rows today; a full refetch is the simplest correct approach.
    const channel = supabase
      .channel('lead-manager')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads' },
        fetchData
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_scores' },
        fetchData
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRtStatus('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
          setRtStatus('error')
        else setRtStatus('connecting')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchData])

  const counts = useMemo(() => countByTier(rows), [rows])

  const visible = useMemo(
    () =>
      rows
        .filter((r) => r.motivation_tier === active)
        .sort((a, b) => (b.motivation_score ?? -1) - (a.motivation_score ?? -1)),
    [rows, active]
  )

  const unscored = rows.filter((r) => !r.motivation_tier).length

  return (
    <div>
      <div className="lm-statusbar">
        <span className="rt-status">
          <span className={`rt-dot ${rtStatus === 'live' ? 'live' : ''}`} />
          {rtStatus === 'live'
            ? 'Live — updates in real time'
            : rtStatus === 'error'
            ? 'Realtime disconnected'
            : 'Connecting…'}
        </span>
        <span className="rt-status">
          {rows.length} lead{rows.length === 1 ? '' : 's'}
        </span>
      </div>

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
      ) : error ? (
        <div className="empty">
          <strong>Couldn’t load leads</strong>
          <span>{error}</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">✓</div>
          <strong>No {active.replace(/_/g, ' ').toLowerCase()} leads</strong>
          <span>Nothing in this tier right now.</span>
        </div>
      ) : (
        <div className="lead-table-wrap">
          <table className="lead-table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>City</th>
                <th>Assessed value</th>
                <th>Score</th>
                <th>Tier</th>
                <th>Primary signals</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="cell-owner">{r.owner_name}</td>
                  <td>{r.city || '—'}</td>
                  <td className="cell-num">{money(r.assessed_value)}</td>
                  <td className="cell-score">{r.motivation_score ?? '—'}</td>
                  <td>
                    <span className={`temp ${TIER_CLASS[r.motivation_tier] || ''}`}>
                      {r.motivation_tier}
                    </span>
                  </td>
                  <td>
                    {r.primary_signals.length ? (
                      <div className="signal-chips">
                        {r.primary_signals.map((sig, i) => (
                          <span className="signal-chip" key={i}>
                            {sig}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && unscored > 0 && (
        <p className="login-foot" style={{ textAlign: 'left', marginTop: 16 }}>
          {unscored} lead{unscored === 1 ? '' : 's'} not yet scored (no{' '}
          <code>lead_scores</code> row) — not shown in any tier tab.
        </p>
      )}
    </div>
  )
}
