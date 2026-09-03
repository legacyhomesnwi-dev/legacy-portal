const { underwriteDeal, calcOfferLadder, CONSTANTS } = require('./underwritingEngine');

console.log('\n=== SANITY CHECK: matches the worked example from your own chat history ===');
console.log('(ARV $200K, Rehab $30K standard -> $27K at 90% wholesale discount)');
const { calcWholesale, dealStatus } = require('./underwritingEngine');
const ladder = calcOfferLadder(200000, 30000);
const status = dealStatus(50000, ladder.mao, ladder.flexCeiling);
const wsCheck = calcWholesale({ arv: 200000, rehab: 30000, askingPrice: 50000, city: 'Gary', isMLS: false, ladder, status });
console.log('Wholesale sellPrice (MAO to end buyer):', wsCheck.sellPrice.toFixed(0), '(expected 123,000)');
console.log('Universal flip MAO (uses full rehab, different by design):', ladder.mao.toFixed(0));

console.log('\n=== GOLDEN DEALS ===\n');

const deals = [
  {
    label: '1) Gary flip — strong deal, should clear FLIP_TARGET ($60K)',
    input: { arv: 180000, rehab: 25000, askingPrice: 60000, city: 'Gary', isMLS: false },
  },
  {
    label: '2) Merrillville flip — clears min but not target',
    input: { arv: 160000, rehab: 30000, askingPrice: 85000, city: 'Merrillville', isMLS: false },
  },
  {
    label: '3) Crown Point — asking above flex ceiling (NO-GO)',
    input: { arv: 240000, rehab: 20000, askingPrice: 230000, city: 'Crown Point', isMLS: true },
  },
  {
    label: '4) East Chicago wholesale — off-market, should clear WS_MIN ($10K)',
    input: { arv: 150000, rehab: 20000, askingPrice: 55000, city: 'East Chicago', isMLS: false },
  },
  {
    label: '5) Gary asking OVER buy box ceiling ($115K) — should fail inBuyBox even if profitable',
    input: { arv: 220000, rehab: 15000, askingPrice: 125000, city: 'Gary', isMLS: false },
  },
  {
    label: '6) BRRRR — Hammond rental with monthly rent supplied',
    input: { arv: 140000, rehab: 20000, askingPrice: 70000, city: 'Hammond', isMLS: false, monthlyRent: 1500 },
  },
  {
    label: '7) No monthly rent supplied — BRRRR should report unavailable, not crash',
    input: { arv: 140000, rehab: 20000, askingPrice: 70000, city: 'Hammond', isMLS: false },
  },
];

for (const { label, input } of deals) {
  const result = underwriteDeal(input);
  console.log(label);
  console.log(`  Deal status: ${result.dealStatus} | Recommended: ${result.recommendedStrategy}`);
  console.log(
    `  Flip: go=${result.strategies.flip.go} meetsMin=${result.strategies.flip.meetsMin} meetsTarget=${result.strategies.flip.meetsTarget} inBuyBox=${result.strategies.flip.inBuyBox} (ceiling $${result.strategies.flip.buyBoxCeiling}, ${result.strategies.flip.buyBoxCalibration})`
  );
  console.log(`    Cash profit at asking: $${result.strategies.flip.scenarios.cash.atAsking.toFixed(0)}`);
  console.log(
    `  Wholesale: go=${result.strategies.wholesale.go} profit at asking=$${result.strategies.wholesale.atAsking.toFixed(0)}`
  );
  if (result.strategies.brrrr.available) {
    console.log(
      `  BRRRR: go=${result.strategies.brrrr.go} cashOut=$${result.strategies.brrrr.cashOut.toFixed(0)} monthlyCashFlow=$${result.strategies.brrrr.monthlyCashFlow.toFixed(0)}`
    );
  } else {
    console.log(`  BRRRR: ${result.strategies.brrrr.note}`);
  }
  console.log('');
}

console.log('=== CONSTANTS CHECK (should match confirmed locked parameters) ===');
console.log('FLIP_MIN:', CONSTANTS.FLIP_MIN, '(expect 35000)');
console.log('FLIP_TARGET:', CONSTANTS.FLIP_TARGET, '(expect 60000)');
console.log('LAO_PCT:', CONSTANTS.LAO_PCT, '(expect 0.60)');
console.log('TIER2_PCT:', CONSTANTS.TIER2_PCT, '(expect 0.625)');
console.log('OPENING_PCT:', CONSTANTS.OPENING_PCT, '(expect 0.65)');
console.log('TIER4_PCT:', CONSTANTS.TIER4_PCT, '(expect 0.70)');

