// scoringEngine.js
// PropFlowREI Lead Scoring Agent — deterministic scoring engine, v1.0.0.
//
// Pure functions only. No LLM call anywhere in this file. Reads signal
// definitions from the registry (signalRegistrySnapshot.js locally; Supabase
// signal_definitions table in production) rather than hard-coding weights —
// tuning a weight is a data change, not a code change.
//
// Implements, in order: entity match confidence -> signal evaluation ->
// effective value -> chain resolution -> category totals with caps ->
// cross-category stack bonus -> negative/suppression handling -> 0-100
// normalization -> tier -> sub-scores -> explainability -> output schema.

const { SIGNAL_REGISTRY } = require('./signalRegistrySnapshot');
const { EXTRACTORS } = require('./signalExtractors');

const SCORING_VERSION = 'v1.0.0';
const AGENT_VERSION = 'lead-scorer-v1.0.0';

// Calibrated so a genuinely severe, multi-category distress property lands
// at or near 100. Will be recalibrated by the Learning System once real
// outcome data exists — never silently, always via the version/approval
// pipeline in the architecture doc.
const REALISTIC_CEILING = 46;

// Per-category ceiling prevents one category (e.g. a huge lien stack) from
// single-handedly dominating the score.
const CATEGORY_CAP = 18;

// Cross-category stack bonus tiers: rewards independent corroboration across
// different distress categories, not just signal count within one category.
const CROSS_CATEGORY_BONUS = { 1: 0, 2: 3, 3: 6, 4: 10 }; // 4+ categories all get the tier-4 bonus

const MATCH_CONFIDENCE_FACTOR = { HIGH: 1.0, MEDIUM: 0.6, LOW: 0.25 };

// ---------------------------------------------------------------------------
// Entity match confidence
// ---------------------------------------------------------------------------
// V1: a simple, honest heuristic. Property records with a parcel number are
// treated as HIGH confidence (parcel numbers are unique and authoritative in
// Lake/Porter County assessor data). Records matched only on owner name +
// city are MEDIUM. Anything else is LOW and gets flagged for human review.
function computeMatchConfidence(property) {
  if (property.parcelNumber) return 'HIGH';
  if (property.ownerName && property.city) return 'MEDIUM';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------
// If a signal instance has no eventDate, treat it as maximally fresh (1.0) —
// most of today's live signals (assessed value, tax due, code violations)
// represent a current state rather than a dated event, so there's nothing to
// decay. Dated signals (sheriff sale, foreclosure filings) should always
// carry an eventDate once their scrapers exist.
function computeFreshness(eventDate, freshnessCurve) {
  if (!eventDate) return 1.0;
  const days = Math.floor((Date.now() - new Date(eventDate).getTime()) / 86400000);
  if (freshnessCurve.default !== undefined) return freshnessCurve.default;
  for (const [band, factor] of Object.entries(freshnessCurve)) {
    const [lo, hiRaw] = band.split('-');
    const hi = hiRaw === undefined || hiRaw === '' || band.endsWith('+') ? Infinity : Number(hiRaw);
    const loNum = Number(lo.replace('+', ''));
    if (days >= loNum && days <= hi) return factor;
  }
  return 0.15; // fell off the end of every band defined -> treat as stale
}

// ---------------------------------------------------------------------------
// Urgency multiplier — only applies to deadline-bound signals with a
// daysUntilEvent field supplied (e.g. sheriff sale, tax sale). Capped so it
// can never itself cause runaway inflation.
// ---------------------------------------------------------------------------
const URGENCY_ELIGIBLE = new Set(['LEGAL_SHERIFF_SALE_SCHEDULED', 'TAX_SALE_SCHEDULED']);
function computeUrgencyMultiplier(signalType, daysUntilEvent) {
  if (!URGENCY_ELIGIBLE.has(signalType) || daysUntilEvent == null) return 1.0;
  if (daysUntilEvent <= 30) return 1.3;
  if (daysUntilEvent <= 60) return 1.15;
  if (daysUntilEvent <= 90) return 1.05;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Step 1: evaluate every active registered signal against the property
// ---------------------------------------------------------------------------
function evaluateSignals(property, registry = SIGNAL_REGISTRY, extractors = EXTRACTORS) {
  const matchConfidence = computeMatchConfidence(property);
  const matchFactor = MATCH_CONFIDENCE_FACTOR[matchConfidence];

  const fired = [];
  for (const def of registry) {
    if (!def.active) continue;
    const test = extractors[def.signal_type];
    if (!test) continue; // no data source wired yet -- cannot fire, by design
    let isFired = false;
    let extractorConfidence = null; // extractors can optionally report their own confidence
    try {
      const result = test(property);
      if (result && typeof result === 'object') {
        isFired = !!result.fired;
        extractorConfidence = result.confidence ?? null;
      } else {
        isFired = !!result;
      }
    } catch (e) {
      isFired = false;
    }
    if (!isFired) continue;

    const eventDate = property[`${def.signal_type}__eventDate`] || null;
    const daysUntilEvent = property[`${def.signal_type}__daysUntilEvent`] ?? null;
    // Priority: explicit per-property override > extractor-reported confidence > default
    const signalConfidence = property[`${def.signal_type}__confidence`] ?? extractorConfidence ?? 0.85;
    const sourceReliability = property[`${def.signal_type}__reliability`] ?? defaultReliabilityFor(def.status);

    const freshness = computeFreshness(eventDate, def.freshness_curve);
    const urgency = computeUrgencyMultiplier(def.signal_type, daysUntilEvent);

    const effectiveValue =
      def.default_base_weight * signalConfidence * sourceReliability * freshness * matchFactor * urgency;

    fired.push({
      signal_type: def.signal_type,
      category: def.category,
      correlation_group: def.correlation_group,
      description: def.description,
      base_weight: def.default_base_weight,
      stack_eligible: def.stack_eligible,
      signal_effect: def.signal_effect,
      signal_confidence: signalConfidence,
      source_reliability: sourceReliability,
      freshness,
      urgency,
      effective_value: effectiveValue,
      match_confidence: matchConfidence,
    });
  }
  return { fired, matchConfidence };
}

function defaultReliabilityFor(status) {
  // Live, currently-wired sources (assessor scrapes, code violation scraper)
  // are treated as high reliability. Anything not yet live shouldn't be
  // firing in the first place (no extractor), but keep a sane default.
  if (status === 'CURRENTLY_AVAILABLE') return 0.9;
  if (status === 'DATA_SOURCE_NEEDED') return 0.75;
  return 0.6;
}

// ---------------------------------------------------------------------------
// Step 2: suppression check — DO_NOT_CONTACT (or any 'suppress' signal)
// short-circuits everything else.
// ---------------------------------------------------------------------------
function checkSuppression(fired) {
  const suppressors = fired.filter((s) => s.signal_effect === 'suppress');
  return suppressors.length > 0 ? suppressors : null;
}

// ---------------------------------------------------------------------------
// Step 3: chain resolution — within a correlation_group, take the MAX
// effective value among stack_eligible=false members (the "stage" signals),
// then add stack_eligible=true members in that same group as modifiers on
// top, plus a small progression bonus if 2+ distinct signals in the group fired.
// Groups with no stack_eligible=false members (e.g. LIEN_STACK) are treated
// as pure accumulation -- every member adds fully, per spec.
// ---------------------------------------------------------------------------
const PURE_ACCUMULATION_GROUPS = new Set(['LIEN_STACK']);

function resolveChains(positiveSignals) {
  const byGroup = {};
  const independent = [];

  for (const s of positiveSignals) {
    if (!s.correlation_group) {
      independent.push(s);
    } else {
      (byGroup[s.correlation_group] = byGroup[s.correlation_group] || []).push(s);
    }
  }

  const chainContributions = []; // { correlation_group, category, value, members }

  for (const [group, members] of Object.entries(byGroup)) {
    if (PURE_ACCUMULATION_GROUPS.has(group)) {
      const value = members.reduce((sum, m) => sum + m.effective_value, 0);
      chainContributions.push({
        correlation_group: group,
        category: members[0].category,
        value,
        members,
        mode: 'accumulation',
      });
      continue;
    }

    const stages = members.filter((m) => m.stack_eligible === false);
    const modifiers = members.filter((m) => m.stack_eligible === true);

    const maxStageValue = stages.length ? Math.max(...stages.map((m) => m.effective_value)) : 0;
    const modifierValue = modifiers.reduce((sum, m) => sum + m.effective_value, 0);

    const distinctFired = members.length;
    const progressionBonus = distinctFired >= 2 ? maxStageValue * 0.1 : 0;

    const value = maxStageValue + modifierValue + progressionBonus;
    // category: use whichever stage-member's category is highest weight (chains are single-category in this registry)
    const category = (stages[0] || modifiers[0]).category;

    chainContributions.push({ correlation_group: group, category, value, members, mode: 'chain' });
  }

  return { chainContributions, independent };
}

// ---------------------------------------------------------------------------
// Step 4: category totals with caps, then cross-category stack bonus
// ---------------------------------------------------------------------------
function computeCategoryTotals(chainContributions, independent) {
  const totals = {}; // category -> raw sum before cap
  for (const c of chainContributions) {
    totals[c.category] = (totals[c.category] || 0) + c.value;
  }
  for (const s of independent) {
    totals[s.category] = (totals[s.category] || 0) + s.effective_value;
  }

  const cappedTotals = {};
  for (const [cat, val] of Object.entries(totals)) {
    cappedTotals[cat] = Math.min(val, CATEGORY_CAP);
  }

  const categoriesWithSignal = Object.keys(cappedTotals).filter((c) => cappedTotals[c] > 0).length;
  const crossCategoryBonus = CROSS_CATEGORY_BONUS[Math.min(categoriesWithSignal, 4)] || 0;

  return { cappedTotals, categoriesWithSignal, crossCategoryBonus };
}

// ---------------------------------------------------------------------------
// Sub-scores (Section 7 of architecture doc) — each is its own 0-100
// normalization over the categories/signals that feed it, kept visible
// and separate from the overall Motivation Score, never silently blended.
// ---------------------------------------------------------------------------
const SUBSCORE_CATEGORY_MAP = {
  property_distress_score: ['condition', 'occupancy'],
  owner_motivation_score: ['ownership'],
  financial_distress_score: ['tax', 'legal'],
  seller_intent_score: [], // Category 12 (seller engagement) -- no live source yet, always 0/null until wired
  transaction_feasibility_score: [], // computed separately below (equity/title complexity)
  data_confidence_score: null, // computed separately below
};
const SUBSCORE_CEILING = 18; // one category's worth -- sub-scores are intentionally narrower in scope than the overall score

function computeSubScores(cappedTotals, fired, matchConfidence) {
  const sub = {};
  for (const [key, cats] of Object.entries(SUBSCORE_CATEGORY_MAP)) {
    if (cats === null) continue;
    const raw = cats.reduce((sum, c) => sum + (cappedTotals[c] || 0), 0);
    sub[key] = Math.min(100, Math.round((raw / SUBSCORE_CEILING) * 100 * 10) / 10);
  }

  // Urgency score: pulled from any fired signal's urgency multiplier > 1.0
  const urgencySignals = fired.filter((s) => s.urgency > 1.0);
  sub.urgency_score = urgencySignals.length
    ? Math.min(100, Math.round(Math.max(...urgencySignals.map((s) => (s.urgency - 1) / 0.3)) * 100))
    : 0;

  // Transaction feasibility: free-and-clear / long-hold raise it, title
  // complexity signals lower it. Kept separate from Motivation entirely.
  const feasibilitySignals = fired.filter((s) =>
    ['OWN_FREE_AND_CLEAR', 'OWN_LONG_HOLD'].includes(s.signal_type)
  );
  const complexitySignals = fired.filter((s) => s.correlation_group === 'TITLE_COMPLEXITY');
  const feasibilityRaw =
    feasibilitySignals.reduce((sum, s) => sum + s.effective_value, 0) -
    complexitySignals.reduce((sum, s) => sum + s.effective_value, 0);
  sub.transaction_feasibility_score = Math.max(0, Math.min(100, Math.round(50 + feasibilityRaw * 8)));

  // Contactability: tracked separately, never leaks into Motivation.
  sub.contactability_score = null; // no phone/email validation source wired yet

  // Data confidence: average of confidence x reliability x match factor
  // across everything that fired; 100 = every fired signal was high-trust.
  if (fired.length === 0) {
    sub.data_confidence = 0;
  } else {
    const avg =
      fired.reduce(
        (sum, s) => sum + s.signal_confidence * s.source_reliability * MATCH_CONFIDENCE_FACTOR[matchConfidence],
        0
      ) / fired.length;
    sub.data_confidence = Math.round(avg * 100 * 10) / 10;
  }

  return sub;
}

// ---------------------------------------------------------------------------
// Data completeness: what fraction of the CURRENTLY_AVAILABLE + DATA_SOURCE_NEEDED
// registry could even be checked against this property record (i.e. does an
// extractor exist AND does the property object carry the relevant field at
// all, fired or not). Low completeness should suppress false confidence in a
// LOW score -- a property we know almost nothing about is not the same as a
// property confirmed to have no distress.
// ---------------------------------------------------------------------------
function computeDataCompleteness(property, registry = SIGNAL_REGISTRY, extractors = EXTRACTORS) {
  const relevant = registry.filter(
    (d) =>
      d.active &&
      ['CURRENTLY_AVAILABLE', 'PARTIALLY_AVAILABLE', 'DATA_SOURCE_NEEDED'].includes(d.status) &&
      extractors[d.signal_type]
  );
  if (relevant.length === 0) return 0;
  // "checkable" = the property object has at least one of the fields the
  // extractor would look at. We approximate this by running the extractor in
  // a try/catch and checking whether any referenced property key is present
  // and not undefined -- simplest reliable proxy without per-signal field lists.
  let checkable = 0;
  for (const d of relevant) {
    const fn = extractors[d.signal_type].toString();
    const keys = [...fn.matchAll(/p\.(\w+)/g)].map((m) => m[1]);
    const anyPresent = keys.some((k) => property[k] !== undefined);
    if (anyPresent) checkable++;
  }
  return Math.round((checkable / relevant.length) * 100 * 10) / 10;
}

// ---------------------------------------------------------------------------
// Tier mapping (0-100 scale, decided 2026-09-02)
// ---------------------------------------------------------------------------
function tierFromScore(score, dataCompleteness) {
  if (dataCompleteness < 15) return 'INSUFFICIENT_DATA';
  if (score >= 90) return 'FIRE';
  if (score >= 75) return 'HOT';
  if (score >= 55) return 'WARM';
  if (score >= 35) return 'NURTURE';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------
function buildExplanation({ motivationScore, tier, dataConfidence, fired, negativeFired, chainContributions, crossCategoryBonus, categoriesWithSignal }) {
  const primary = fired
    .filter((s) => s.signal_effect === 'positive')
    .sort((a, b) => b.effective_value - a.effective_value)
    .slice(0, 5)
    .map((s) => `+ ${s.description}`);

  const lines = [
    `MOTIVATION SCORE: ${motivationScore}`,
    `TIER: ${tier}`,
    `CONFIDENCE: ${dataConfidence}%`,
    '',
    'PRIMARY SIGNALS:',
    ...(primary.length ? primary : ['(none fired)']),
  ];

  if (categoriesWithSignal >= 2) {
    lines.push(
      '',
      'STACKING EFFECT:',
      `${categoriesWithSignal} independent distress categories fired, contributing a +${crossCategoryBonus} cross-category bonus.`
    );
  }

  if (negativeFired.length) {
    lines.push('', 'NEGATIVE SIGNALS:', ...negativeFired.map((s) => `- ${s.description}`));
  } else {
    lines.push('', 'NEGATIVE SIGNALS:', 'None material.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
function scoreLead(property, options = {}) {
  const registry = options.registry || SIGNAL_REGISTRY;
  const extractors = options.extractors || EXTRACTORS;

  const { fired, matchConfidence } = evaluateSignals(property, registry, extractors);

  // --- Suppression short-circuit ---
  const suppressors = checkSuppression(fired);
  if (suppressors) {
    return {
      property_id: property.id || null,
      owner_id: property.ownerId || null,
      motivation_score: null,
      motivation_tier: 'SUPPRESSED',
      human_review_required: false,
      human_review_reason: [],
      negative_signals: suppressors.map((s) => s.description),
      recommended_priority: 'DO_NOT_CONTACT',
      recommended_next_action: 'Do not contact. Suppressed by: ' + suppressors.map((s) => s.description).join('; '),
      score_explanation: `SUPPRESSED — ${suppressors.map((s) => s.description).join('; ')}`,
      scoring_version: SCORING_VERSION,
      agent_version: AGENT_VERSION,
      scored_at: new Date().toISOString(),
    };
  }

  const positiveFired = fired.filter((s) => s.signal_effect === 'positive');
  const negativeFired = fired.filter((s) => s.signal_effect === 'negative');

  const { chainContributions, independent } = resolveChains(positiveFired);
  const { cappedTotals, categoriesWithSignal, crossCategoryBonus } = computeCategoryTotals(
    chainContributions,
    independent
  );

  const positiveRawTotal = Object.values(cappedTotals).reduce((a, b) => a + b, 0) + crossCategoryBonus;
  const negativeDeduction = negativeFired.reduce((sum, s) => sum + Math.abs(s.effective_value), 0);
  const rawTotal = Math.max(0, positiveRawTotal - negativeDeduction);

  const motivationScore = Math.min(100, Math.round((rawTotal / REALISTIC_CEILING) * 100 * 10) / 10);

  const dataCompleteness = computeDataCompleteness(property, registry, extractors);
  const tier = tierFromScore(motivationScore, dataCompleteness);

  const subScores = computeSubScores(cappedTotals, positiveFired, matchConfidence);

  const humanReviewReasons = [];
  if (matchConfidence === 'LOW') humanReviewReasons.push('Low entity match confidence');
  const conflicting = negativeFired.filter((n) =>
    positiveFired.some((p) => p.correlation_group && p.correlation_group === n.correlation_group)
  );
  if (conflicting.length) humanReviewReasons.push('Conflicting signals within the same correlation group');
  if (dataCompleteness < 15) humanReviewReasons.push('Data completeness too low for reliable scoring');

  const explanation = buildExplanation({
    motivationScore,
    tier,
    dataConfidence: subScores.data_confidence,
    fired: positiveFired,
    negativeFired,
    chainContributions,
    crossCategoryBonus,
    categoriesWithSignal,
  });

  return {
    property_id: property.id || null,
    owner_id: property.ownerId || null,

    motivation_score: motivationScore,
    motivation_tier: tier,

    property_distress_score: subScores.property_distress_score,
    owner_motivation_score: subScores.owner_motivation_score,
    financial_distress_score: subScores.financial_distress_score,
    seller_intent_score: subScores.seller_intent_score,
    urgency_score: subScores.urgency_score,
    transaction_feasibility_score: subScores.transaction_feasibility_score,
    contactability_score: subScores.contactability_score,

    data_confidence: subScores.data_confidence,
    data_completeness: dataCompleteness,

    primary_signals: positiveFired
      .sort((a, b) => b.effective_value - a.effective_value)
      .slice(0, 5)
      .map((s) => s.description),
    secondary_signals: positiveFired
      .sort((a, b) => b.effective_value - a.effective_value)
      .slice(5)
      .map((s) => s.description),
    negative_signals: negativeFired.map((s) => s.description),

    signal_stacks: chainContributions.map((c) => ({
      correlation_group: c.correlation_group,
      category: c.category,
      contribution: Math.round(c.value * 100) / 100,
      mode: c.mode,
      members: c.members.map((m) => m.description),
    })),

    conflicting_signals: conflicting.map((s) => s.description),
    expired_signals: [], // populated once real event dates + freshness curves reduce a signal to 0

    missing_information: registry
      .filter((d) => d.active && d.status !== 'CURRENTLY_AVAILABLE' && !extractors[d.signal_type])
      .map((d) => d.description)
      .slice(0, 8),
    recommended_data_pulls: registry
      .filter((d) => d.status === 'DATA_SOURCE_NEEDED')
      .map((d) => d.description)
      .slice(0, 5),

    recommended_priority: tier,
    recommended_next_action:
      tier === 'FIRE' || tier === 'HOT'
        ? 'Immediate high-priority acquisition outreach.'
        : tier === 'WARM'
        ? 'Queue for standard outreach cadence.'
        : tier === 'INSUFFICIENT_DATA'
        ? 'Pull additional data before prioritizing.'
        : 'Low priority — monitor for new signals.',

    human_review_required: humanReviewReasons.length > 0,
    human_review_reason: humanReviewReasons,

    score_explanation: explanation,

    scoring_version: SCORING_VERSION,
    agent_version: AGENT_VERSION,

    scored_at: new Date().toISOString(),
  };
}

module.exports = {
  scoreLead,
  evaluateSignals,
  computeMatchConfidence,
  SCORING_VERSION,
  AGENT_VERSION,
  REALISTIC_CEILING,
};
