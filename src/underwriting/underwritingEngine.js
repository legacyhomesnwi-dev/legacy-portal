// underwritingEngine.js
// Deterministic financial engine extracted from DealUnderwriter v7 FINAL
// (chat: "AI agent for real estate deal analysis and pricing"). Pure
// functions only -- no LLM calls, no AI math. This is the ONE SOURCE OF
// TRUTH for underwriting calculations, per the master architecture. The
// eventual Underwriting Agent (Phase 7) interprets these outputs; it never
// recalculates them.
//
// Locked parameters (confirmed 2026-09-02, memory edit #1):
//   Flip min profit = $35,000 | Flip target = $60,000
//   Offer ladder (% of MAO): LAO=60%, Tier2=62.5%, Opening=65%, Tier4=70%
//   MAO = ARV × 75% - rehab

const { getBuyBoxInfo } = require('./buyBoxConfig');

const ENGINE_VERSION = 'v1.0.0-extracted-from-dealunderwriter-v7-final';

// ---------------------------------------------------------------------------
// Locked constants
// ---------------------------------------------------------------------------
const MAO_PCT = 0.75;
const FLEX_PCT = 0.80;
const FLEX_BUFFER = 5000;

const LAO_PCT = 0.60;
const TIER2_PCT = 0.625;
const OPENING_PCT = 0.65;
const TIER4_PCT = 0.70;

const FLIP_MIN = 35000;
const FLIP_TARGET = 60000;
const WHOLESALE_MIN = 10000;
const BRRRR_CASHOUT_MIN = 25000;

const CARRY_MO = 400;
const HOLD_MO = 5.5;
const CARRY_TOTAL = CARRY_MO * HOLD_MO; // $2,200

const TITLE = {
  buy: 1076.50,
  sellFlat: 1209.75,
  sellPerThousandARV: 3.56, // ARV x 0.00356
  refi: 1533.25,
};

const HARD_MONEY_RATE = 0.105;
const HARD_MONEY_FEE = 999;
const HARD_MONEY_MIN_ORIGINATION = 2300;
const HARD_MONEY_ORIGINATION_PCT = 0.01;

const CREDIT_LINE_RATE = 0.07;

const BRRRR_REFI_LTV = 0.75;
const BRRRR_REFI_RATE = 0.075;
const BRRRR_REFI_TERM_YEARS = 30;
const BRRRR_REFI_ORIGINATION_PCT = 0.01;
const BRRRR_REFI_MIN_ORIGINATION = 2300; // mirrors hard-money-style floor, as found in source
const BRRRR_APPRAISAL_FEE = 600;
const RENTAL_EXPENSE_RATIO = 0.45;

const WHOLESALE_ASSIGNMENT_TARGET = 25000; // reference target, not a hard input
const WHOLESALE_REHAB_DISCOUNT = 0.90; // buyer's rehab estimate, 10% off standard
const END_BUYER_SELL_COST_PCT = 0.055;

// ---------------------------------------------------------------------------
// Rehab-by-condition calculator — the piece that was missing from the
// original extraction. Matches DealUnderwriter v7 FINAL's 7-tier scale
// exactly (verified from chat history, confirmed locked parameters).
// ---------------------------------------------------------------------------
const CONDITIONS = [
  { label: 'Turnkey', value: 'turnkey', costPerSqft: 7.50 },
  { label: 'Cosmetic', value: 'cosmetic', costPerSqft: 12.50 },
  { label: 'Light', value: 'light', costPerSqft: 25.00 },
  { label: 'Moderate', value: 'moderate', costPerSqft: 35.00 },
  { label: 'Extensive', value: 'extensive', costPerSqft: 40.00 },
  { label: 'Heavy', value: 'heavy', costPerSqft: 45.00 },
  { label: 'Complete Gut / Rebuild', value: 'gut', costPerSqft: 50.00 },
];

function calcRehabFromCondition({ sqft, condition, rehabOverride }) {
  if (rehabOverride != null && rehabOverride !== '') {
    return { rehab: parseFloat(rehabOverride), source: 'override' };
  }
  const conditionObj = CONDITIONS.find((c) => c.value === condition);
  if (!conditionObj) {
    throw new Error(
      `Unknown condition "${condition}". Must be one of: ${CONDITIONS.map((c) => c.value).join(', ')}`
    );
  }
  if (sqft == null) {
    throw new Error('sqft is required when rehab is not directly provided or overridden.');
  }
  return { rehab: sqft * conditionObj.costPerSqft, source: 'condition', costPerSqft: conditionObj.costPerSqft };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function sellTitleTotal(arv) {
  return TITLE.sellFlat + arv * (TITLE.sellPerThousandARV / 1000);
}

function flipSellCosts(arv) {
  // 5% commission + 1% concessions + sell-side title
  return arv * 0.05 + arv * 0.01 + sellTitleTotal(arv);
}

function hardMoneyCosts(purchasePrice) {
  const origination = Math.max(purchasePrice * HARD_MONEY_ORIGINATION_PCT, HARD_MONEY_MIN_ORIGINATION);
  const interest = HARD_MONEY_RATE * (HOLD_MO / 12) * purchasePrice;
  const total = origination + interest + HARD_MONEY_FEE + TITLE.buy;
  return { origination, interest, fee: HARD_MONEY_FEE, buyTitle: TITLE.buy, total };
}

function creditLineCosts(purchasePrice) {
  const interest = CREDIT_LINE_RATE * (HOLD_MO / 12) * purchasePrice;
  const total = interest + TITLE.buy;
  return { interest, buyTitle: TITLE.buy, total };
}

function cashCosts() {
  return { total: TITLE.buy, buyTitle: TITLE.buy };
}

function wholesaleAgentCost(assignmentFee, isMLS) {
  if (isMLS) {
    // MLS source: no buy-side commission, disp agent = 5% of fee + $500
    return assignmentFee * 0.05 + 500;
  }
  // Off-market: acq agent 5%+$500 + disp agent 5%+$500
  return assignmentFee * 0.05 + 500 + (assignmentFee * 0.05 + 500);
}

// ---------------------------------------------------------------------------
// Universal offer ladder (shared across all three strategies)
// ---------------------------------------------------------------------------
function calcOfferLadder(arv, rehab) {
  const mao = arv * MAO_PCT - rehab;
  const flexMAO = arv * FLEX_PCT - rehab;
  const flexCeiling = flexMAO + FLEX_BUFFER;

  return {
    mao,
    flexMAO,
    flexCeiling,
    lao: mao * LAO_PCT,
    tier2: mao * TIER2_PCT,
    opening: mao * OPENING_PCT,
    tier4: mao * TIER4_PCT,
  };
}

function dealStatus(askingPrice, mao, flexCeiling, allowFlex = false) {
  if (askingPrice <= mao) return 'strong';
  if (allowFlex && askingPrice <= flexCeiling) return 'flex';
  return 'nogo';
}

// ---------------------------------------------------------------------------
// FLIP
// ---------------------------------------------------------------------------
function calcFlip({ arv, rehab, askingPrice, city, ladder, status }) {
  const sellCosts = flipSellCosts(arv);
  const sellTitleFee = sellTitleTotal(arv);
  const commissionAndConcessions = sellCosts - sellTitleFee; // 5% + 1%

  const profitAt = (purchasePrice, financing) => {
    const hm = financing === 'hardMoney' ? hardMoneyCosts(purchasePrice) : null;
    const cl = financing === 'creditLine' ? creditLineCosts(purchasePrice) : null;
    const cash = financing === 'cash' ? cashCosts() : null;
    const financingCost = (hm || cl || cash).total;
    return arv - purchasePrice - rehab - sellCosts - CARRY_TOTAL - financingCost;
  };

  const scenarios = {};
  for (const financing of ['cash', 'hardMoney', 'creditLine']) {
    const feeBreakdown = financing === 'hardMoney' ? hardMoneyCosts(askingPrice) : financing === 'creditLine' ? creditLineCosts(askingPrice) : cashCosts();
    scenarios[financing] = {
      atLAO: profitAt(ladder.lao, financing),
      atTier2: profitAt(ladder.tier2, financing),
      atOpening: profitAt(ladder.opening, financing),
      atTier4: profitAt(ladder.tier4, financing),
      atMAO: profitAt(ladder.mao, financing),
      atAsking: profitAt(askingPrice, financing),
      feesAtAsking: feeBreakdown, // buyTitle + (origination/interest/fee if financed)
    };
  }

  const buyBox = getBuyBoxInfo(city);
  const inBuyBox = buyBox.inServiceArea;
  const cashProfitAtAsking = scenarios.cash.atAsking;

  return {
    sellCosts,
    sellTitleFee,
    commissionAndConcessions,
    buyTitleFee: TITLE.buy,
    carryTotal: CARRY_TOTAL,
    scenarios,
    meetsMin: cashProfitAtAsking >= FLIP_MIN,
    meetsTarget: cashProfitAtAsking >= FLIP_TARGET,
    inBuyBox,
    county: buyBox.county,
    go: cashProfitAtAsking >= FLIP_MIN && status !== 'nogo' && inBuyBox,
  };
}

// ---------------------------------------------------------------------------
// WHOLESALE
// ---------------------------------------------------------------------------
function calcWholesale({ arv, rehab, askingPrice, city, isMLS, ladder, status }) {
  const wsRehab = rehab * WHOLESALE_REHAB_DISCOUNT;
  const sellPrice = arv * MAO_PCT - wsRehab; // MAO offered to end buyer
  const endBuyerAllIn = sellPrice + wsRehab;
  const endBuyerProfit = arv - endBuyerAllIn - arv * END_BUYER_SELL_COST_PCT;

  const tcFee = isMLS ? 0 : 300; // TC fee applies to off-market only

  const profitAt = (purchasePrice) => {
    const assignmentFee = sellPrice - purchasePrice;
    const agentCom = wholesaleAgentCost(assignmentFee, isMLS);
    return sellPrice - purchasePrice - agentCom - tcFee;
  };

  const atAsking = profitAt(askingPrice);
  const doubleCloseAtAsking = atAsking - TITLE.buy; // if assignment isn't possible

  const buyBox = getBuyBoxInfo(city);
  const inBuyBox = buyBox.inServiceArea;

  return {
    wsRehab,
    sellPrice,
    endBuyerAllIn,
    endBuyerProfit,
    tcFee,
    buyTitleFeeIfDoubleClose: TITLE.buy,
    atLAO: profitAt(ladder.lao),
    atTier2: profitAt(ladder.tier2),
    atOpening: profitAt(ladder.opening),
    atTier4: profitAt(ladder.tier4),
    atMAO: profitAt(ladder.mao),
    atAsking,
    doubleCloseAtAsking,
    inBuyBox,
    county: buyBox.county,
    go: atAsking >= WHOLESALE_MIN && status !== 'nogo' && inBuyBox,
  };
}

// ---------------------------------------------------------------------------
// BRRRR
// ---------------------------------------------------------------------------
function calcBRRRR({ arv, rehab, askingPrice, monthlyRent }) {
  if (!monthlyRent) {
    return { available: false, note: 'Enter monthly rent to unlock BRRRR analysis.' };
  }

  const allIn = askingPrice + rehab + TITLE.buy + CARRY_TOTAL;
  const refiLoan = arv * BRRRR_REFI_LTV;
  const refiOrigination = Math.max(refiLoan * BRRRR_REFI_ORIGINATION_PCT, BRRRR_REFI_MIN_ORIGINATION);
  const refiCosts = TITLE.refi + refiOrigination + BRRRR_APPRAISAL_FEE;

  const monthlyRate = BRRRR_REFI_RATE / 12;
  const numPayments = BRRRR_REFI_TERM_YEARS * 12;
  const monthlyMortgage =
    (refiLoan * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  const monthlyExpenses = monthlyRent * RENTAL_EXPENSE_RATIO;
  const monthlyCashFlow = monthlyRent - monthlyMortgage - monthlyExpenses;
  const annualCashFlow = monthlyCashFlow * 12;

  const cashOut = refiLoan - allIn - refiCosts;

  return {
    available: true,
    allIn,
    refiLoan,
    refiCosts,
    buyTitleFee: TITLE.buy,
    refiTitleFee: TITLE.refi,
    refiOrigination,
    appraisalFee: BRRRR_APPRAISAL_FEE,
    monthlyMortgage,
    monthlyExpenses,
    monthlyCashFlow,
    annualCashFlow,
    cashOut,
    meetsCashOut: cashOut >= BRRRR_CASHOUT_MIN,
    meetsCashFlow: monthlyCashFlow > 0,
    go: cashOut >= BRRRR_CASHOUT_MIN && monthlyCashFlow > 0,
  };
}

// ---------------------------------------------------------------------------
// Main entry point — runs all three strategies simultaneously
// ---------------------------------------------------------------------------
function underwriteDeal(input) {
  const { arv, askingPrice, city, isMLS = false, monthlyRent = null, allowFlex = false, propertyAddress = null } = input;
  let { rehab } = input;

  // Accept either a direct rehab dollar amount, OR sqft + condition (with
  // optional override) — matches how the original tool actually works.
  let rehabDetail = null;
  if (rehab == null) {
    rehabDetail = calcRehabFromCondition({
      sqft: input.sqft,
      condition: input.condition,
      rehabOverride: input.rehabOverride,
    });
    rehab = rehabDetail.rehab;
  }

  if (arv == null || rehab == null || askingPrice == null || !city) {
    throw new Error('underwriteDeal requires arv, rehab (or sqft+condition), askingPrice, and city at minimum.');
  }

  const ladder = calcOfferLadder(arv, rehab);
  // Flex (80% ARV) tier is NEVER applied automatically -- it only activates
  // when allowFlex is explicitly passed true (Justin's manual override).
  // Default behavior is strictly MAO (75% ARV) or nogo, nothing in between.
  const status = dealStatus(askingPrice, ladder.mao, ladder.flexCeiling, allowFlex);

  const flip = calcFlip({ arv, rehab, askingPrice, city, ladder, status });
  const wholesale = calcWholesale({ arv, rehab, askingPrice, city, isMLS, ladder, status });
  const brrrr = calcBRRRR({ arv, rehab, askingPrice, monthlyRent });

  // Route to wholesale if flip capacity is presumably exceeded -- capacity
  // tracking itself lives outside this pure function (in the pipeline that
  // calls it), so this engine just reports both and lets the caller route.
  const strategies = { flip, wholesale, brrrr };
  const recommendedStrategy =
    flip.go && flip.meetsTarget
      ? 'flip'
      : flip.go
      ? 'flip (meets min, below target)'
      : wholesale.go
      ? 'wholesale'
      : brrrr.available && brrrr.go
      ? 'brrrr'
      : 'none — no strategy clears its minimum';

  return {
    inputs: { arv, rehab, askingPrice, city, isMLS, monthlyRent, propertyAddress, allowFlex },
    rehabDetail,
    dealStatus: status,
    offerLadder: ladder,
    strategies,
    recommendedStrategy,
    engineVersion: ENGINE_VERSION,
  };
}

module.exports = {
  underwriteDeal,
  calcOfferLadder,
  calcFlip,
  calcWholesale,
  calcBRRRR,
  calcRehabFromCondition,
  dealStatus,
  flipSellCosts,
  hardMoneyCosts,
  creditLineCosts,
  sellTitleTotal,
  CONDITIONS,
  ENGINE_VERSION,
  // Constants exported for transparency/testing, not for callers to mutate
  CONSTANTS: {
    MAO_PCT, FLEX_PCT, FLEX_BUFFER,
    LAO_PCT, TIER2_PCT, OPENING_PCT, TIER4_PCT,
    FLIP_MIN, FLIP_TARGET, WHOLESALE_MIN, BRRRR_CASHOUT_MIN,
    CARRY_MO, HOLD_MO, CARRY_TOTAL, TITLE,
    HARD_MONEY_RATE, HARD_MONEY_FEE, HARD_MONEY_MIN_ORIGINATION, HARD_MONEY_ORIGINATION_PCT,
    CREDIT_LINE_RATE,
    BRRRR_REFI_LTV, BRRRR_REFI_RATE, BRRRR_REFI_TERM_YEARS, BRRRR_APPRAISAL_FEE, RENTAL_EXPENSE_RATIO,
  },
};

