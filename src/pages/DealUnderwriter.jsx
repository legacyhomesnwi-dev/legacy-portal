import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Buy-box cities (from the edge function's buyBoxConfig). Free text is allowed —
// anything not listed falls back to the unclassified tier server-side.
const CITIES = [
  'Gary', 'Hammond', 'East Chicago', 'Merrillville', 'Portage', 'Highland',
  'Valparaiso', 'Chesterton', 'Munster', 'Crown Point', 'Cedar Lake',
]

const DEAL_STATUS_CLS = { strong: 'temp-warm', flex: 'temp-nurture', nogo: 'temp-fire' }

function money(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—'
  return `$${Math.round(Number(n)).toLocaleString('en-US')}`
}
function Go({ v }) {
  return <span className={v ? 'go-yes' : 'go-no'}>{v ? 'GO' : 'no'}</span>
}

const BLANK = { arv: '', rehab: '', askingPrice: '', city: 'Gary', isMLS: false, monthlyRent: '' }

export default function DealUnderwriter() {
  const [form, setForm] = useState(BLANK)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [savedRows, setSavedRows] = useState([])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Build the edge-function body from the form (numbers coerced, blanks dropped).
  const buildBody = useCallback(
    (persist) => {
      const body = {
        arv: Number(form.arv),
        rehab: Number(form.rehab),
        askingPrice: Number(form.askingPrice),
        city: form.city.trim(),
        isMLS: !!form.isMLS,
        persist,
      }
      if (form.monthlyRent !== '' && !Number.isNaN(Number(form.monthlyRent))) {
        body.monthlyRent = Number(form.monthlyRent)
      }
      return body
    },
    [form]
  )

  const formValid =
    form.arv !== '' && form.rehab !== '' && form.askingPrice !== '' && form.city.trim() !== ''

  async function analyze(e) {
    e?.preventDefault()
    if (!formValid) return
    setLoading(true)
    setError('')
    setSavedNote('')
    const { data, error: fnErr } = await supabase.functions.invoke('analyze-deal', {
      body: buildBody(false),
    })
    setLoading(false)
    if (fnErr) {
      setError(fnErr.message || 'Edge function call failed')
      setResult(null)
      return
    }
    if (data?.error) {
      setError(data.error)
      setResult(null)
      return
    }
    setResult(data.result)
  }

  async function save() {
    if (!result) return
    setSaving(true)
    setError('')
    const { data, error: fnErr } = await supabase.functions.invoke('analyze-deal', {
      body: buildBody(true),
    })
    setSaving(false)
    if (fnErr || data?.error) {
      setError(fnErr?.message || data?.error || 'Save failed')
      return
    }
    setResult(data.result)
    setSavedNote(`Saved — deal_analyses row ${data.saved?.id?.slice(0, 8)}…`)
    fetchSaved()
  }

  const fetchSaved = useCallback(async () => {
    const { data, error: qErr } = await supabase
      .from('deal_analyses')
      .select(
        'id, property_id, city, arv, rehab, asking_price, is_mls, deal_status, recommended_strategy, engine_version, analyzed_at'
      )
      .order('analyzed_at', { ascending: false })
    if (!qErr) setSavedRows(data || [])
  }, [])

  useEffect(() => {
    fetchSaved()
    const channel = supabase
      .channel('deal-analyzer')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deal_analyses' },
        fetchSaved
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchSaved])

  const ladder = result?.offerLadder
  const flip = result?.strategies?.flip
  const ws = result?.strategies?.wholesale
  const brrrr = result?.strategies?.brrrr

  const ladderRows = useMemo(
    () =>
      ladder
        ? [
            ['MAO (75% ARV − rehab)', ladder.mao],
            ['Flex MAO (80% ARV − rehab)', ladder.flexMAO],
            ['Flex ceiling (+$5k)', ladder.flexCeiling],
            ['LAO — 60% of MAO', ladder.lao],
            ['Tier 2 — 62.5%', ladder.tier2],
            ['Opening — 65%', ladder.opening],
            ['Tier 4 — 70%', ladder.tier4],
          ]
        : [],
    [ladder]
  )

  return (
    <div className="da-layout">
      {/* ---------- Input form ---------- */}
      <form className="card" onSubmit={analyze}>
        <div className="da-form">
          <label className="field">
            <span>ARV</span>
            <input
              type="number"
              inputMode="numeric"
              value={form.arv}
              onChange={(e) => set('arv', e.target.value)}
              placeholder="180000"
            />
          </label>
          <label className="field">
            <span>Rehab</span>
            <input
              type="number"
              inputMode="numeric"
              value={form.rehab}
              onChange={(e) => set('rehab', e.target.value)}
              placeholder="25000"
            />
          </label>
          <label className="field">
            <span>Asking price</span>
            <input
              type="number"
              inputMode="numeric"
              value={form.askingPrice}
              onChange={(e) => set('askingPrice', e.target.value)}
              placeholder="60000"
            />
          </label>
          <label className="field">
            <span>City</span>
            <input
              type="text"
              list="da-cities"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            />
            <datalist id="da-cities">
              {CITIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Monthly rent (BRRRR — optional)</span>
            <input
              type="number"
              inputMode="numeric"
              value={form.monthlyRent}
              onChange={(e) => set('monthlyRent', e.target.value)}
              placeholder="1500"
            />
          </label>
          <label className="da-check">
            <input
              type="checkbox"
              checked={form.isMLS}
              onChange={(e) => set('isMLS', e.target.checked)}
            />
            On-market (MLS) deal
          </label>
        </div>

        <div className="da-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="submit" disabled={loading || !formValid}>
            {loading ? 'Analyzing…' : 'Analyze deal'}
          </button>
          {result && (
            <button className="btn" type="button" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save this analysis'}
            </button>
          )}
          {savedNote && <span className="da-saved-note">{savedNote}</span>}
        </div>
        {error && (
          <div className="form-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
      </form>

      {/* ---------- Result ---------- */}
      {result && (
        <div className="card da-layout">
          <div className="da-result-head">
            <span className={`temp ${DEAL_STATUS_CLS[result.dealStatus] || ''}`}>
              {result.dealStatus}
            </span>
            <span className="da-rec">→ {result.recommendedStrategy}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {result.engineVersion}
            </span>
          </div>

          <div className="da-section">
            <h3>Offer ladder</h3>
            <div className="kv">
              {ladderRows.map(([k, v]) => (
                <div key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{money(v)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="da-section">
            <h3>
              Flip &nbsp;<Go v={flip.go} />
            </h3>
            <div className="kv" style={{ marginBottom: 12 }}>
              <div>
                <span className="k">Cash profit @ asking</span>
                <span className="v">{money(flip.scenarios.cash.atAsking)}</span>
              </div>
              <div>
                <span className="k">Meets min / target</span>
                <span className="v">
                  {flip.meetsMin ? 'min ✓' : 'min ✗'} · {flip.meetsTarget ? 'target ✓' : 'target ✗'}
                </span>
              </div>
              <div>
                <span className="k">In buy box</span>
                <span className="v">
                  {flip.inBuyBox ? 'yes' : 'no'} ({money(flip.buyBoxCeiling)}, {flip.buyBoxCalibration})
                </span>
              </div>
              <div>
                <span className="k">Sell costs</span>
                <span className="v">{money(flip.sellCosts)}</span>
              </div>
            </div>
            <div className="lead-table-wrap">
              <table className="lead-table">
                <thead>
                  <tr>
                    <th>Financing</th>
                    <th>@ LAO</th>
                    <th>@ Tier 2</th>
                    <th>@ Opening</th>
                    <th>@ Tier 4</th>
                    <th>@ MAO</th>
                    <th>@ Asking</th>
                  </tr>
                </thead>
                <tbody>
                  {['cash', 'hardMoney', 'creditLine'].map((fin) => (
                    <tr key={fin}>
                      <td className="cell-owner">{fin}</td>
                      {['atLAO', 'atTier2', 'atOpening', 'atTier4', 'atMAO', 'atAsking'].map((k) => (
                        <td className="cell-num" key={k}>
                          {money(flip.scenarios[fin][k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="da-section">
            <h3>
              Wholesale &nbsp;<Go v={ws.go} />
            </h3>
            <div className="kv">
              <div>
                <span className="k">Sell price (MAO to end buyer)</span>
                <span className="v">{money(ws.sellPrice)}</span>
              </div>
              <div>
                <span className="k">Assignment profit @ asking</span>
                <span className="v">{money(ws.atAsking)}</span>
              </div>
              <div>
                <span className="k">Double-close @ asking</span>
                <span className="v">{money(ws.doubleCloseAtAsking)}</span>
              </div>
              <div>
                <span className="k">End-buyer profit</span>
                <span className="v">{money(ws.endBuyerProfit)}</span>
              </div>
              <div>
                <span className="k">TC fee</span>
                <span className="v">{money(ws.tcFee)}</span>
              </div>
              <div>
                <span className="k">@ MAO / @ Opening</span>
                <span className="v">
                  {money(ws.atMAO)} / {money(ws.atOpening)}
                </span>
              </div>
            </div>
          </div>

          <div className="da-section">
            <h3>
              BRRRR &nbsp;{brrrr.available ? <Go v={brrrr.go} /> : null}
            </h3>
            {!brrrr.available ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{brrrr.note}</p>
            ) : (
              <div className="kv">
                <div>
                  <span className="k">All-in</span>
                  <span className="v">{money(brrrr.allIn)}</span>
                </div>
                <div>
                  <span className="k">Refi loan (75% LTV)</span>
                  <span className="v">{money(brrrr.refiLoan)}</span>
                </div>
                <div>
                  <span className="k">Refi costs</span>
                  <span className="v">{money(brrrr.refiCosts)}</span>
                </div>
                <div>
                  <span className="k">Cash out</span>
                  <span className="v">{money(brrrr.cashOut)}</span>
                </div>
                <div>
                  <span className="k">Monthly mortgage</span>
                  <span className="v">{money(brrrr.monthlyMortgage)}</span>
                </div>
                <div>
                  <span className="k">Monthly cash flow</span>
                  <span className="v">{money(brrrr.monthlyCashFlow)}</span>
                </div>
                <div>
                  <span className="k">Annual cash flow</span>
                  <span className="v">{money(brrrr.annualCashFlow)}</span>
                </div>
                <div>
                  <span className="k">Meets cash-out / cash-flow</span>
                  <span className="v">
                    {brrrr.meetsCashOut ? '✓' : '✗'} / {brrrr.meetsCashFlow ? '✓' : '✗'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- Saved analyses ---------- */}
      <div className="da-section">
        <h3>Saved analyses ({savedRows.length})</h3>
        {savedRows.length === 0 ? (
          <div className="empty">
            <span>No saved analyses yet.</span>
          </div>
        ) : (
          <div className="lead-table-wrap">
            <table className="lead-table">
              <thead>
                <tr>
                  <th>City</th>
                  <th>ARV</th>
                  <th>Rehab</th>
                  <th>Asking</th>
                  <th>MLS</th>
                  <th>Status</th>
                  <th>Recommended</th>
                  <th>Analyzed</th>
                </tr>
              </thead>
              <tbody>
                {savedRows.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-owner">{r.city}</td>
                    <td className="cell-num">{money(r.arv)}</td>
                    <td className="cell-num">{money(r.rehab)}</td>
                    <td className="cell-num">{money(r.asking_price)}</td>
                    <td>{r.is_mls ? 'yes' : 'no'}</td>
                    <td>
                      <span className={`temp ${DEAL_STATUS_CLS[r.deal_status] || ''}`}>
                        {r.deal_status}
                      </span>
                    </td>
                    <td>{r.recommended_strategy}</td>
                    <td className="cell-num">
                      {new Date(r.analyzed_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
