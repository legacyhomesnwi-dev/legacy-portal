const { scoreLead } = require('./scoringEngine');

const testCases = [
  {
    label: '1) Gary — estate-owned, tax delinquent, boarded, high-confidence match',
    property: {
      id: 'test-1',
      parcelNumber: '45-08-12-345-001',
      city: 'Gary',
      ownerIsEstateTrustOrLLC: true,
      assessedValue: 32000,
      taxAmountDue: 4100,
      taxYearsDelinquent: 3,
      isAbsenteeOwner: true,
      yearsOwned: 27,
      boardedWindowsOrDoors: true,
      openCodeViolations: 2,
    },
  },
  {
    label: '2) Crown Point — well-kept, no distress, FULLY scraped record (control)',
    // In production every property touched by Daily Scraper v11 gets every
    // live field populated, even when false/zero -- this fixture reflects
    // that so the completeness check can correctly tell "confirmed clean"
    // apart from "we don't know" (that distinction is the point of Case 8).
    property: {
      id: 'test-2',
      parcelNumber: '45-11-01-002-009',
      city: 'Crown Point',
      assessedValue: 245000,
      ownerIsEstateTrustOrLLC: false,
      isAbsenteeOwner: false,
      isOutOfState: false,
      yearsOwned: 6,
      taxAmountDue: 0,
      taxYearsDelinquent: 0,
      openCodeViolations: 0,
      boardedWindowsOrDoors: false,
      overgrownOrNeglected: false,
      condemned: false,
      highViolationDensityBlock: false,
      highRentalDensityBlock: false,
    },
  },
  {
    label: '3) East Chicago — LLC + very low value + violations stacked + probate (chain test)',
    property: {
      id: 'test-3',
      parcelNumber: '45-07-04-100-002',
      city: 'East Chicago',
      ownerIsEstateTrustOrLLC: true,
      assessedValue: 28000,
      openCodeViolations: 4,
      isOutOfState: true,
      probateFiled: true, // PROBATE_CHAIN: should take MAX(estate_trust_llc, probate), not sum both
    },
  },
  {
    label: '4) Gary — SEVERE: sheriff sale + condemned + vacant + tax sale (4 categories, cross-category bonus)',
    property: {
      id: 'test-4',
      parcelNumber: '45-08-19-777-003',
      city: 'Gary',
      assessedValue: 21000,
      taxAmountDue: 2200,
      sheriffSaleScheduled: true,
      LEGAL_SHERIFF_SALE_SCHEDULED__daysUntilEvent: 25, // urgency multiplier test
      condemned: true,
      isVacant: true,
      taxSaleScheduled: true,
    },
  },
  {
    label: '5) DO_NOT_CONTACT test — otherwise FIRE-level signals, must suppress entirely',
    property: {
      id: 'test-5',
      parcelNumber: '45-08-19-777-004',
      city: 'Gary',
      ownerIsEstateTrustOrLLC: true,
      assessedValue: 18000,
      condemned: true,
      sheriffSaleScheduled: true,
      doNotContact: true,
    },
  },
  {
    label: '6) Negative signal test — code violation present but property already sold',
    property: {
      id: 'test-6',
      parcelNumber: '45-08-19-777-005',
      city: 'Hammond',
      assessedValue: 60000,
      openCodeViolations: 2,
      propertyAlreadySold: true,
    },
  },
  {
    label: '7) LOW match confidence — no parcel number, name+city only',
    property: {
      id: 'test-7',
      ownerName: 'J. Smith',
      city: 'Merrillville',
      assessedValue: 40000,
      taxAmountDue: 1500,
    },
  },
  {
    label: '8) Nearly empty record — should read as INSUFFICIENT_DATA, not LOW',
    property: {
      id: 'test-8',
      city: 'Valparaiso',
    },
  },
  {
    label: '9) Valparaiso @ $150K — Tier 3 (provisional): absentee/out-of-state, long hold, light tax + 1 violation',
    // Fleshed out so the record clears the data-completeness gate and scores a
    // real tier. Point: a mid-market suburb the OLD 3-city check ignored entirely
    // now contributes VAL_LOW_FOR_SUBMARKET at provisional (0.55) confidence as
    // part of an otherwise ordinary tired-landlord profile.
    property: {
      id: 'test-9',
      parcelNumber: '64-05-11-100-002',
      city: 'Valparaiso',
      assessedValue: 150000, // < Tier 3 threshold ($200K)
      // full live-scrape block (Daily Scraper v11 populates every field, even when clean)
      ownerIsEstateTrustOrLLC: false,
      isAbsenteeOwner: true,
      isOutOfState: true,
      yearsOwned: 24,
      taxAmountDue: 900,
      taxYearsDelinquent: 1,
      openCodeViolations: 1,
      boardedWindowsOrDoors: false,
      overgrownOrNeglected: false,
      condemned: false,
      highViolationDensityBlock: false,
      highRentalDensityBlock: false,
      isVacant: false,
      noHomesteadExemption: true,
    },
  },
  {
    label: '10) Merrillville @ $95K — Tier 2 (provisional): LLC-owned, vacant, 2yr tax delinquent, 3 violations',
    // Matched pair with Case 11 — identical distress profile, different submarket.
    // Merrillville is a named Tier 2 city, so VAL_LOW_FOR_SUBMARKET fires at 0.55.
    property: {
      id: 'test-10',
      parcelNumber: '45-12-08-300-001',
      city: 'Merrillville',
      assessedValue: 95000, // < Tier 2 threshold ($130K)
      ownerIsEstateTrustOrLLC: true,
      isAbsenteeOwner: true,
      isOutOfState: false,
      yearsOwned: 15,
      taxAmountDue: 1800,
      taxYearsDelinquent: 2,
      openCodeViolations: 3,
      boardedWindowsOrDoors: false,
      overgrownOrNeglected: false,
      condemned: false,
      highViolationDensityBlock: false,
      highRentalDensityBlock: false,
      isVacant: true,
      noHomesteadExemption: true,
    },
  },
  {
    label: '11) Cedar Lake @ $110K — fallback tier (unclassified): same distress as Case 10, weaker submarket confidence',
    // Cedar Lake is in no named cap-rate tier, so it lands in FALLBACK_UNCLASSIFIED
    // and VAL_LOW_FOR_SUBMARKET fires at only 0.35. Everything else is identical to
    // Case 10 — the 10-vs-11 score gap is purely the submarket-confidence effect.
    property: {
      id: 'test-11',
      parcelNumber: '45-09-22-050-004',
      city: 'Cedar Lake',
      assessedValue: 110000, // < fallback threshold ($150K)
      ownerIsEstateTrustOrLLC: true,
      isAbsenteeOwner: true,
      isOutOfState: false,
      yearsOwned: 15,
      taxAmountDue: 1800,
      taxYearsDelinquent: 2,
      openCodeViolations: 3,
      boardedWindowsOrDoors: false,
      overgrownOrNeglected: false,
      condemned: false,
      highViolationDensityBlock: false,
      highRentalDensityBlock: false,
      isVacant: true,
      noHomesteadExemption: true,
    },
  },
];

console.log('\n=== SCORING ENGINE v1 — TEST RUN ===\n');

const summary = testCases.map(({ label, property }) => {
  const r = scoreLead(property);
  return {
    Case: label,
    Score: r.motivation_score,
    Tier: r.motivation_tier,
    'Match Conf.': r.human_review_required ? '(review)' : '-',
    'Data Compl.': r.data_completeness,
    'Categories Fired': r.signal_stacks ? r.signal_stacks.length + Object.keys({}).length : '-',
  };
});
console.table(summary);

console.log('\n--- Full detail: chain resolution test (Case 3 — PROBATE_CHAIN should not double-count) ---\n');
const case3 = scoreLead(testCases[2].property);
console.log('Signal stacks:', JSON.stringify(case3.signal_stacks, null, 2));
console.log('Score:', case3.motivation_score, '| Tier:', case3.motivation_tier);

console.log('\n--- Full detail: severe case with urgency multiplier + cross-category bonus (Case 4) ---\n');
const case4 = scoreLead(testCases[3].property);
console.log(case4.score_explanation);
console.log('\nSignal stacks:', JSON.stringify(case4.signal_stacks, null, 2));

console.log('\n--- Full detail: suppression test (Case 5) ---\n');
console.log(JSON.stringify(scoreLead(testCases[4].property), null, 2));

console.log('\n--- Full detail: negative signal deduction (Case 6) ---\n');
const case6 = scoreLead(testCases[5].property);
console.log('Score:', case6.motivation_score, '(should be pulled down hard by DISQ_ALREADY_SOLD)');
console.log('Negative signals:', case6.negative_signals);

console.log('\n--- Full detail: low match confidence -> human review (Case 7) ---\n');
const case7 = scoreLead(testCases[6].property);
console.log('Human review required:', case7.human_review_required, '| Reasons:', case7.human_review_reason);

console.log('\n--- Full detail: insufficient data (Case 8) ---\n');
const case8 = scoreLead(testCases[7].property);
console.log('Score:', case8.motivation_score, '| Tier:', case8.motivation_tier, '| Data completeness:', case8.data_completeness);

console.log('\n--- Submarket tier coverage test (Cases 9, 10, 11) ---\n');
console.log('Under the OLD TAX_LOW_DISTRESSED_SUB signal, none of these three cities would ever fire — only Gary/Hammond/East Chicago were checked.\n');
const SUBMARKET_SIGNAL = 'Low valuation relative to submarket norm (tiered)';
const submarketRows = [8, 9, 10].map((i) => {
  const r = scoreLead(testCases[i].property);
  const fired = r.primary_signals.concat(r.secondary_signals || []).includes(SUBMARKET_SIGNAL);
  return {
    Case: testCases[i].label.split(' — ')[0],
    Score: r.motivation_score,
    Tier: r.motivation_tier,
    'Data Compl.': r.data_completeness,
    VAL_LOW_FOR_SUBMARKET: fired ? 'fired' : 'did not fire',
  };
});
console.table(submarketRows);

const c10 = scoreLead(testCases[9].property);
const c11 = scoreLead(testCases[10].property);
console.log(
  'Matched-pair check (10 vs 11) — identical distress, different submarket:\n' +
    `  Merrillville (Tier 2, 0.55 conf): ${c10.motivation_score} ${c10.motivation_tier}\n` +
    `  Cedar Lake   (fallback, 0.35 conf): ${c11.motivation_score} ${c11.motivation_tier}\n` +
    `  Delta of ${Math.round((c10.motivation_score - c11.motivation_score) * 10) / 10} pt is purely the submarket-confidence effect.`
);
