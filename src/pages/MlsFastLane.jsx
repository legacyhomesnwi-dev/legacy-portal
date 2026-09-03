import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

function money(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—'
  return `$${Math.round(Number(n)).toLocaleString('en-US')}`
}

function relativeTime(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const s = Math.round((Date.now() - then) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}

function propertyFacts(p) {
  if (!p || (p.sqft == null && p.beds == null && p.baths == null)) return '—'
  return [
    p.sqft != null ? `${Number(p.sqft).toLocaleString('en-US')} sqft` : '— sqft',
    p.beds != null ? `${p.beds} bd` : '— bd',
    p.baths != null ? `${p.baths} ba` : '— ba',
  ].join(' · ')
}

const STATUS_PILL = {
  ANALYSIS_READY: 'temp-green',
  NEEDS_ENRICHMENT: 'temp-warm',
  NEEDS_REVIEW: 'temp-fire',
}
const statusPillClass = (s) => STATUS_PILL[s] || 'temp-grey'

const EVENT_LABEL = {
  NEW_LISTING: 'New Listing',
  PRICE_CHANGE: 'Price Change',
  BACK_ON_MARKET: 'Back On Market',
  STATUS_CHANGE: 'Status Change',
  LISTING_UPDATE: 'Listing Update',
}

// latest incoming_record per listing (incoming is pre-sorted received_at desc)
function indexLatestByListing(incoming) {
  const m = new Map()
  for (const ir of incoming || []) {
    if (ir.matched_listing_id && !m.has(ir.matched_listing_id)) m.set(ir.matched_listing_id, ir)
  }
  return m
}
function groupEventsByListing(events) {
  const m = new Map()
  for (const ev of events || []) {
    if (!m.has(ev.listing_id)) m.set(ev.listing_id, [])
    m.get(ev.listing_id).push(ev)
  }
  return m
}

function priceChange(r) {
  const orig = Number(r.original_list_price)
  const cur = Number(r.current_list_price)
  if (!orig || !cur || orig === cur) return null
  return { orig, cur, down: cur < orig }
}

function ListingRow({ r, isOpen, onToggle }) {
  const pc = priceChange(r)
  const missing = r.incoming?.missing_fields || []
  const canExpand = r.events.length >= 2 || missing.length > 0

  return (
    <>
      <tr className={canExpand ? 'mls-row-expandable' : undefined}>
        <td className="mls-expand-cell">
          {canExpand && (
            <button className="mls-expand-btn" onClick={onToggle} aria-label="Toggle details">
              {isOpen ? '▾' : '▸'}
            </button>
          )}
        </td>
        <td className="cell-num" title={r.incoming?.received_at || ''}>
          {relativeTime(r.incoming?.received_at)}
        </td>
        <td className="cell-num">{r.mls_number}</td>
        <td className="cell-owner">
          {r.property?.street_address}
          <span style={{ color: 'var(--text-dim)' }}>
            {r.property?.city ? `, ${r.property.city}` : ''}
          </span>
        </td>
        <td className="cell-num">{money(r.current_list_price)}</td>
        <td className="cell-num">
          {pc ? (
            <span className={pc.down ? 'go-yes' : 'go-no'} style={{ fontWeight: 600 }}>
              {money(pc.orig)} → {money(pc.cur)}
            </span>
          ) : (
            <span style={{ color: 'var(--text-dim)' }}>no change</span>
          )}
        </td>
        <td>{r.status || '—'}</td>
        <td>{r.last_update_type || '—'}</td>
        <td>{propertyFacts(r.property)}</td>
        <td>
          <span className={`temp ${statusPillClass(r.incoming?.processing_status)}`}>
            {r.incoming?.processing_status || 'UNKNOWN'}
          </span>
        </td>
        <td>{r.saved_search_name || '—'}</td>
      </tr>

      {isOpen && canExpand && (
        <tr className="mls-detail-row">
          <td />
          <td colSpan={10}>
            {missing.length > 0 && (
              <div className="mls-missing">
                Missing for analysis: <strong>{missing.join(', ')}</strong>
              </div>
            )}
            {r.events.length >= 2 && (
              <div className="mls-timeline">
                <div className="mls-timeline-head">Listing event history</div>
                {r.events.map((ev, i) => {
                  const oldP = ev.old_value?.price
                  const newP = ev.new_value?.price
                  return (
                    <div className="mls-timeline-item" key={i}>
                      <span className="mls-ev-type">
                        {EVENT_LABEL[ev.event_type] || ev.event_type}
                      </span>
                      <span className="mls-ev-price">
                        {oldP != null ? `${money(oldP)} → ${money(newP)}` : money(newP)}
                      </span>
                      <span className="mls-ev-time" title={ev.received_at}>
                        {new Date(ev.received_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}{' '}
                        ({relativeTime(ev.received_at)})
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function MlsFastLane() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rtStatus, setRtStatus] = useState('connecting')
  const [expanded, setExpanded] = useState(() => new Set())

  const fetchData = useCallback(async () => {
    const [listingsRes, incomingRes, eventsRes] = await Promise.all([
      supabase
        .from('listings')
        .select(
          'id, mls_number, status, current_list_price, original_list_price, last_update_type, saved_search_name, last_seen_at, ' +
            'property:properties(id, street_address, city, sqft, beds, baths, year_built)'
        )
        .order('last_seen_at', { ascending: false }),
      supabase
        .from('incoming_records')
        .select('matched_listing_id, received_at, processing_status, missing_fields')
        .order('received_at', { ascending: false }),
      supabase
        .from('listing_events')
        .select('listing_id, event_type, old_value, new_value, received_at')
        .order('received_at', { ascending: true }),
    ])

    const err = listingsRes.error || incomingRes.error || eventsRes.error
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    const irByListing = indexLatestByListing(incomingRes.data)
    const evByListing = groupEventsByListing(eventsRes.data)

    setError('')
    setRows(
      (listingsRes.data || []).map((l) => ({
        ...l,
        incoming: irByListing.get(l.id) || null,
        events: evByListing.get(l.id) || [],
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()

    const channel = supabase
      .channel('mls-fast-lane')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listing_events' }, fetchData)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRtStatus('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRtStatus('error')
        else setRtStatus('connecting')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchData])

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

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
          {rows.length} listing{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <div className="empty">
          <div className="spinner" />
          Loading MLS intake…
        </div>
      ) : error ? (
        <div className="empty">
          <strong>Couldn’t load MLS intake</strong>
          <span>{error}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">✓</div>
          <strong>No listings yet</strong>
          <span>Nothing has come through MLS intake.</span>
        </div>
      ) : (
        <div className="lead-table-wrap">
          <table className="lead-table mls-table">
            <thead>
              <tr>
                <th />
                <th>Received</th>
                <th>MLS #</th>
                <th>Address</th>
                <th>List Price</th>
                <th>Price History</th>
                <th>Status</th>
                <th>Update Type</th>
                <th>Property Facts</th>
                <th>Analysis Status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ListingRow
                  key={r.id}
                  r={r}
                  isOpen={expanded.has(r.id)}
                  onToggle={() => toggle(r.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mls-note">
        ARV, rehab estimates, MAO, and deal scores require the Comparable and
        Appraisal Agents, which aren’t built yet. This page shows raw MLS intake
        and enrichment status only.
      </div>
    </div>
  )
}
