import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// 30 Lake + Porter County municipalities (matches buyBoxConfig — geographic
// service-area check, no price ceiling).
const CITIES = [
  'Gary', 'Hammond', 'East Chicago', 'Hobart', 'Lake Station', 'Whiting',
  'Cedar Lake', 'Dyer', 'Griffith', 'Highland', 'Lowell', 'Merrillville',
  'Munster', 'New Chicago', 'Schererville', 'Schneider', 'St. John', 'Winfield',
  'Crown Point', 'Beverly Shores', 'Burns Harbor', 'Chesterton', 'Dune Acres',
  'Hebron', 'Kouts', 'Ogden Dunes', 'Pines', 'Portage', 'Porter', 'Valparaiso',
]

// 7-tier rehab-by-condition scale (matches engine CONDITIONS).
const CONDITIONS = [
  { value: 'turnkey', label: 'Turnkey — $7.50/sqft' },
  { value: 'cosmetic', label: 'Cosmetic — $12.50/sqft' },
  { value: 'light', label: 'Light — $25/sqft' },
  { value: 'moderate', label: 'Moderate — $35/sqft' },
  { value: 'extensive', label: 'Extensive — $40/sqft' },
  { value: 'heavy', label: 'Heavy — $45/sqft' },
  { value: 'gut', label: 'Complete Gut / Rebuild — $50/sqft' },
]

const DEAL_STATUS_CLS = { strong: 'temp-warm', flex: 'temp-nurture', nogo: 'temp-fire' }
const FINANCINGS = [
  ['cash', 'Cash'],
  ['hardMoney', 'Hard Money'],
  ['creditLine', 'Credit Line'],
]
// [ladder key on result.offerLadder, scenario key on flip.scenarios.*, label]
const OFFER_TIERS = [
  ['lao', 'atLAO', 'LAO (60%)'],
  ['tier2', 'atTier2', 'Tier 2 (62.5%)'],
  ['opening', 'atOpening', 'Opening (65%)'],
  ['tier4', 'atTier4', 'Tier 4 (70%)'],
  ['mao', 'atMAO', 'MAO (75%)'],
]

function flipStatusLine(flip) {
  if (flip.meetsTarget) return { cls: 'go-yes', text: '✓ Hits $60K target' }
  if (flip.meetsMin) return { cls: 'da-status-mid', text: '~ Meets $35K min' }
  return { cls: 'go-no', text: '✗ Below minimum' }
}

function money(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—'
  return `$${Math.round(Number(n)).toLocaleString('en-US')}`
}
function Go({ v }) {
  return <span className={v ? 'go-yes' : 'go-no'}>{v ? 'GO' : 'no'}</span>
}
function KV({ items }) {
  return (
    <div className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  )
}

const BLANK = {
  propertyAddress: '', arv: '', askingPrice: '', city: 'Gary',
  rehab: '', sqft: '', condition: '', rehabOverride: '',
  monthlyRent: '', isMLS: false, allowFlex: false,
}

export default function DealUnderwriter() {
  const [form, setForm] = useState(BLANK)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [savedRows, setSavedRows] = useState([])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const buildBody = useCallback(
    (persist) => {
      const body = {
        propertyAddress: form.propertyAddress.trim() || null,
        arv: Number(form.arv),
        askingPrice: Number(form.askingPrice),
        city: form.city.trim(),
        isMLS: !!form.isMLS,
        allowFlex: !!form.allowFlex,
        persist,
      }
      const numIf = (v) => (v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined)
      if (numIf(form.rehab) !== undefined) body.rehab = numIf(form.rehab)
      if (numIf(form.sqft) !== undefined) body.sqft = numIf(form.sqft)
      if (form.condition) body.condition = form.condition
      if (numIf(form.rehabOverride) !== undefined) body.rehabOverride = numIf(form.rehabOverride)
      if (numIf(form.monthlyRent) !== undefined) body.monthlyRent = numIf(form.monthlyRent)
      return body
    },
    [form]
  )

  // Same rule the edge function enforces.
  const hasRehab =
    form.rehab !== '' || (form.sqft !== '' && form.condition !== '')
  const formValid =
    form.arv !== '' && form.askingPrice !== '' && form.city.trim() !== '' && hasRehab

  async function invoke(persist) {
    const { data, error: fnErr } = await supabase.functions.invoke('analyze-deal', {
      body: buildBody(persist),
    })
    if (fnErr) throw new Error(fnErr.message || 'Edge function call failed')
    if (data?.error) throw new Error(data.error)
    return data
  }

  async function analyze(e) {
    e?.preventDefault()
    if (!formValid) return
    setLoading(true)
    setError('')
    setSavedNote('')
    try {
      const data = await invoke(false)
      setResult(data.result)
    } catch (err) {
      setError(err.message)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!result) return
    setSaving(true)
    setError('')
    try {
      const data = await invoke(true)
      setResult(data.result)
      setSavedNote(`Saved — deal_analyses row ${data.saved?.id?.slice(0, 8)}…`)
      fetchSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const fetchSaved = useCallback(async () => {
    const { data, error: qErr } = await supabase
      .from('deal_analyses')
      .select(
        'id, property_address, city, arv, rehab, asking_price, is_mls, allow_flex, deal_status, recommended_strategy, engine_version, analyzed_at'
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
  const rd = result?.rehabDetail

  const ladderItems = useMemo(
    () =>
      ladder
        ? [
            ['MAO (75% ARV − rehab)', money(ladder.mao)],
            ['Flex MAO (80% ARV − rehab)', money(ladder.flexMAO)],
            ['Flex ceiling (+$5k)', money(ladder.flexCeiling)],
            ['LAO — 60% of MAO', money(ladder.lao)],
            ['Tier 2 — 62.5%', money(ladder.tier2)],
            ['Opening — 65%', money(ladder.opening)],
            ['Tier 4 — 70%', money(ladder.tier4)],
          ]
        : [],
    [ladder]
  )

  return (
    <div className="da-layout">
      {/* ---------- Input form ---------- */}
      <form className="card" onSubmit={analyze}>
        <div className="da-form">
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span>Property address (optional)</span>
            <input
              type="text"
              value={form.propertyAddress}
              onChange={(e) => set('propertyAddress', e.target.value)}
              placeholder="1523 Adams St, Gary, IN 46407"
            />
          </label>

          <label className="field">
            <span>ARV</span>
            <input type="number" inputMode="numeric" value={form.arv}
              onChange={(e) => set('arv', e.target.value)} placeholder="180000" />
          </label>
          <label className="field">
            <span>Asking price</span>
            <input type="number" inputMode="numeric" value={form.askingPrice}
              onChange={(e) => set('askingPrice', e.target.value)} placeholder="60000" />
          </label>
          <label className="field">
            <span>City</span>
            <input type="text" list="da-cities" value={form.city}
              onChange={(e) => set('city', e.target.value)} />
            <datalist id="da-cities">
              {CITIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>

          <label className="field">
            <span>Rehab $ (direct)</span>
            <input type="number" inputMode="numeric" value={form.rehab}
              onChange={(e) => set('rehab', e.target.value)} placeholder="25000" />
          </label>
          <label className="field">
            <span>…or Sqft</span>
            <input type="number" inputMode="numeric" value={form.sqft}
              onChange={(e) => set('sqft', e.target.value)} placeholder="1200"
              disabled={form.rehab !== ''} />
          </label>
          <label className="field">
            <span>…and Condition</span>
            <select value={form.condition} onChange={(e) => set('condition', e.target.value)}
              disabled={form.rehab !== ''}>
              <option value="">—</option>
              {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Rehab override $ (beats sqft+condition)</span>
            <input type="number" inputMode="numeric" value={form.rehabOverride}
              onChange={(e) => set('rehabOverride', e.target.value)} placeholder="—"
              disabled={form.rehab !== ''} />
          </label>
          <label className="field">
            <span>Monthly rent (BRRRR — optional)</span>
            <input type="number" inputMode="numeric" value={form.monthlyRent}
              onChange={(e) => set('monthlyRent', e.target.value)} placeholder="1500" />
          </label>
          <div className="da-checks">
            <label className="da-check">
              <input type="checkbox" checked={form.isMLS}
                onChange={(e) => set('isMLS', e.target.checked)} />
              On-market (MLS) deal
            </label>
            <label className="da-check">
              <input type="checkbox" checked={form.allowFlex}
                onChange={(e) => set('allowFlex', e.target.checked)} />
              Allow flex pricing (80% ARV)
            </label>
          </div>
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
        {error && <div className="form-error" style={{ marginTop: 14 }}>{error}</div>}
      </form>

      {/* ---------- Result ---------- */}
      {result && (
        <div className="card da-layout">
          <div className="da-result-head">
            <span className={`temp ${DEAL_STATUS_CLS[result.dealStatus] || ''}`}>
              {result.dealStatus}
            </span>
            <span className="da-rec">→ {result.recommendedStrategy}</span>
            {result.inputs?.allowFlex && (
              <span className="temp temp-nurture">flex pricing allowed</span>
            )}
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{result.engineVersion}</span>
          </div>

          <div className="da-section">
            <h3>Inputs</h3>
            <KV
              items={[
                ['Address', result.inputs.propertyAddress || '—'],
                ['ARV', money(result.inputs.arv)],
                ['Asking', money(result.inputs.askingPrice)],
                ['City', result.inputs.city],
                [
                  'Rehab used',
                  rd
                    ? `${money(result.inputs.rehab)} (${rd.source}${rd.costPerSqft ? ` @ $${rd.costPerSqft}/sqft` : ''})`
                    : money(result.inputs.rehab),
                ],
                ['Buy box', flip.inBuyBox ? `In service area — ${flip.county} County` : 'Outside Lake/Porter service area'],
              ]}
            />
          </div>

          <div className="da-section">
            <h3>Offer ladder</h3>
            <KV items={ladderItems} />
          </div>

          <div className="da-section">
            <h3>Flip &nbsp;<Go v={flip.go} /></h3>

            <h3 style={{ marginTop: 4 }}>Offer → profit (net, after all costs)</h3>
            <div className="lead-table-wrap">
              <table className="lead-table">
                <thead>
                  <tr>
                    <th>Offer tier</th>
                    <th>Offer $</th>
                    {FINANCINGS.map(([k, label]) => <th key={k}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {OFFER_TIERS.map(([ladderKey, scKey, label]) => (
                    <tr key={scKey}>
                      <td className="cell-owner">{label}</td>
                      <td className="cell-num">{money(ladder[ladderKey])}</td>
                      {FINANCINGS.map(([fin]) => (
                        <td className="cell-num" key={fin}>
                          {money(flip.scenarios[fin][scKey])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="cell-owner">Asking Price</td>
                    <td className="cell-num">{money(result.inputs.askingPrice)}</td>
                    {FINANCINGS.map(([fin]) => (
                      <td className="cell-num" key={fin}>
                        {money(flip.scenarios[fin].atAsking)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {(() => {
              const s = flipStatusLine(flip)
              return (
                <p className={`da-status ${s.cls}`}>
                  {s.text}{' '}
                  <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                    (cash profit at asking {money(flip.scenarios.cash.atAsking)}; min $35K / target $60K keyed to the cash-at-asking figure)
                  </span>
                </p>
              )
            })()}

            <h3 style={{ marginTop: 14 }}>Financing fees @ asking</h3>
            <KV
              items={FINANCINGS.map(([fin, label]) => [
                label,
                money((flip.scenarios[fin].feesAtAsking || {}).total),
              ])}
            />

            <h3 style={{ marginTop: 14 }}>Flip cost line items</h3>
            <KV
              items={[
                ['Sell-side title fee', money(flip.sellTitleFee)],
                ['Buy-side title fee', money(flip.buyTitleFee)],
                ['Commission + concessions (6%)', money(flip.commissionAndConcessions)],
                ['Carry total (5.5 mo)', money(flip.carryTotal)],
                ['Total sell costs', money(flip.sellCosts)],
              ]}
            />
          </div>

          <div className="da-section">
            <h3>Wholesale &nbsp;<Go v={ws.go} /></h3>

            <h3 style={{ marginTop: 4 }}>Offer → assignment profit</h3>
            <div className="lead-table-wrap">
              <table className="lead-table">
                <thead>
                  <tr>
                    <th>Offer tier</th>
                    <th>Offer $</th>
                    <th>Assignment profit</th>
                  </tr>
                </thead>
                <tbody>
                  {OFFER_TIERS.map(([ladderKey, scKey, label]) => (
                    <tr key={scKey}>
                      <td className="cell-owner">{label}</td>
                      <td className="cell-num">{money(ladder[ladderKey])}</td>
                      <td className="cell-num">{money(ws[scKey])}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="cell-owner">Asking Price</td>
                    <td className="cell-num">{money(result.inputs.askingPrice)}</td>
                    <td className="cell-num">{money(ws.atAsking)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className={`da-status ${ws.atAsking >= 10000 ? 'go-yes' : 'go-no'}`}>
              {ws.atAsking >= 10000 ? '✓ Meets $10K wholesale min' : '✗ Below $10K wholesale min'}
              {' '}
              <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                (assignment profit at asking {money(ws.atAsking)})
              </span>
            </p>

            <h3 style={{ marginTop: 14 }}>Wholesale detail</h3>
            <KV
              items={[
                ['Sell price (MAO to end buyer)', money(ws.sellPrice)],
                ['Double-close @ asking', money(ws.doubleCloseAtAsking)],
                ['Buy-side title fee if double-close', money(ws.buyTitleFeeIfDoubleClose)],
                ['End-buyer profit', money(ws.endBuyerProfit)],
                ['TC fee', money(ws.tcFee)],
              ]}
            />
          </div>

          <div className="da-section">
            <h3>BRRRR &nbsp;{brrrr.available ? <Go v={brrrr.go} /> : null}</h3>
            {!brrrr.available ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{brrrr.note}</p>
            ) : (
              <KV
                items={[
                  ['All-in', money(brrrr.allIn)],
                  ['Refi loan (75% LTV)', money(brrrr.refiLoan)],
                  ['Refi costs (total)', money(brrrr.refiCosts)],
                  ['Buy-side title fee', money(brrrr.buyTitleFee)],
                  ['Refi title fee', money(brrrr.refiTitleFee)],
                  ['Refi origination', money(brrrr.refiOrigination)],
                  ['Appraisal fee', money(brrrr.appraisalFee)],
                  ['Monthly mortgage', money(brrrr.monthlyMortgage)],
                  ['Monthly expenses', money(brrrr.monthlyExpenses)],
                  ['Monthly cash flow', money(brrrr.monthlyCashFlow)],
                  ['Annual cash flow', money(brrrr.annualCashFlow)],
                  ['Cash out', money(brrrr.cashOut)],
                  ['Meets cash-out / cash-flow', `${brrrr.meetsCashOut ? '✓' : '✗'} / ${brrrr.meetsCashFlow ? '✓' : '✗'}`],
                ]}
              />
            )}
          </div>
        </div>
      )}

      {/* ---------- Saved analyses ---------- */}
      <div className="da-section">
        <h3>Saved analyses ({savedRows.length})</h3>
        {savedRows.length === 0 ? (
          <div className="empty"><span>No saved analyses yet.</span></div>
        ) : (
          <div className="lead-table-wrap">
            <table className="lead-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>City</th>
                  <th>ARV</th>
                  <th>Rehab</th>
                  <th>Asking</th>
                  <th>MLS</th>
                  <th>Flex</th>
                  <th>Status</th>
                  <th>Recommended</th>
                  <th>Analyzed</th>
                </tr>
              </thead>
              <tbody>
                {savedRows.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-owner">{r.property_address || '—'}</td>
                    <td>{r.city}</td>
                    <td className="cell-num">{money(r.arv)}</td>
                    <td className="cell-num">{money(r.rehab)}</td>
                    <td className="cell-num">{money(r.asking_price)}</td>
                    <td>{r.is_mls ? 'yes' : 'no'}</td>
                    <td>{r.allow_flex ? 'yes' : 'no'}</td>
                    <td>
                      <span className={`temp ${DEAL_STATUS_CLS[r.deal_status] || ''}`}>
                        {r.deal_status}
                      </span>
                    </td>
                    <td>{r.recommended_strategy}</td>
                    <td className="cell-num">
                      {new Date(r.analyzed_at).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
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
