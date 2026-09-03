// underwritingEngine.ts — ESM port of src/underwriting/underwritingEngine.js
// for the Deno edge function runtime. Logic is byte-for-byte identical to
// the Node version (commit afe127b) -- only the module syntax changed
// (module.exports/require -> export/import). If the Node engine's formulas
// ever change, this file must be updated to match, or the two will drift.

import { getBuyBoxCeiling } from './buyBoxConfig.ts';

export const ENGINE_VERSION = 'v1.0.0-extracted-from-dealunderwriter-v7-final';

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
const CARRY_TOTAL = CARRY_MO * HOLD_MO;

const TITLE = {
  buy: 1076.50,
  sellFlat: 1209.75,
  sellPerThousandARV: 3.56,
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
const BRRRR_REFI_MIN_ORIGINATION = 2300;
const BRRRR_APPRAISAL_FEE = 600;
const RENTAL_EXPENSE_RATIO = 0.45;

const WHOLESALE_REHAB_DISCOUNT = 0.90;
const END_BUYER_SELL_COST_PCT = 0.055;

function sellTitleTotal(arv: number) {
  return TITLE.sellFlat + arv * (TITLE.sellPerThousandARV / 1000);
}

function flipSellCosts(arv: number) {
  return arv * 0.05 + arv * 0.01 + sellTitleTotal(arv);
}

function hardMoneyCosts(purchasePrice: number) {
  const origination = Math.max(purchasePrice * HARD_MONEY_ORIGINATION_PCT, HARD_MONEY_MIN_ORIGINATION);
  const interest = HARD_MONEY_RATE * (HOLD_MO / 12) * purchasePrice;
  const total = origination + interest + HARD_MONEY_FEE + TITLE.buy;
  return { origination, interest, fee: HARD_MONEY_FEE, buyTitle: TITLE.buy, total };
}

function creditLineCosts(purchasePrice: number) {
  const interest = CREDIT_LINE_RATE * (HOLD_MO / 12) * purchasePrice;
  const total = interest + TITLE.buy;
  return { interest, buyTitle: TITLE.buy, total };
}

function cashCosts() {
  return { total: TITLE.buy, buyTitle: TITLE.buy };
}

function wholesaleAgentCost(assignmentFee: number, isMLS: boolean) {
  if (isMLS) return assignmentFee * 0.05 + 500;
  return assignmentFee * 0.05 + 500 + (assignmentFee * 0.05 + 500);
}

export function calcOfferLadder(arv: number, rehab: number) {
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

export function dealStatus(askingPrice: number, mao: number, flexCeiling: number) {
  if (askingPrice <= mao) return 'strong';
  if (askingPrice <= flexCeiling) return 'flex';
  return 'nogo';
}

function calcFlip({ arv, rehab, askingPrice, city, ladder, status }: any) {
  const sellCosts = flipSellCosts(arv);

  const profitAt = (purchasePrice: number, financing: string) => {
    const hm = financing === 'hardMoney' ? hardMoneyCosts(purchasePrice) : null;
    const cl = financing === 'creditLine' ? creditLineCosts(purchasePrice) : null;
    const cash = financing === 'cash' ? cashCosts() : null;
    const financingCost = (hm || cl || cash)!.total;
    return arv - purchasePrice - rehab - sellCosts - CARRY_TOTAL - financingCost;
  };

  const scenarios: Record<string, any> = {};
  for (const financing of ['cash', 'hardMoney', 'creditLine']) {
    scenarios[financing] = {
      atLAO: profitAt(ladder.lao, financing),
      atTier2: profitAt(ladder.tier2, financing),
      atOpening: profitAt(ladder.opening, financing),
      atTier4: profitAt(ladder.tier4, financing),
      atMAO: profitAt(ladder.mao, financing),
      atAsking: profitAt(askingPrice, financing),
    };
  }

  const buyBox = getBuyBoxCeiling(city);
  const inBuyBox = askingPrice <= buyBox.maxAskingPrice;
  const cashProfitAtAsking = scenarios.cash.atAsking;

  return {
    sellCosts,
    scenarios,
    meetsMin: cashProfitAtAsking >= FLIP_MIN,
    meetsTarget: cashProfitAtAsking >= FLIP_TARGET,
    inBuyBox,
    buyBoxCeiling: buyBox.maxAskingPrice,
    buyBoxCalibration: buyBox.calibration,
    go: cashProfitAtAsking >= FLIP_MIN && status !== 'nogo' && inBuyBox,
  };
}

function calcWholesale({ arv, rehab, askingPrice, city, isMLS, ladder, status }: any) {
  const wsRehab = rehab * WHOLESALE_REHAB_DISCOUNT;
  const sellPrice = arv * MAO_PCT - wsRehab;
  const endBuyerAllIn = sellPrice + wsRehab;
  const endBuyerProfit = arv - endBuyerAllIn - arv * END_BUYER_SELL_COST_PCT;

  const tcFee = isMLS ? 0 : 300;

  const profitAt = (purchasePrice: number) => {
    const assignmentFee = sellPrice - purchasePrice;
    const agentCom = wholesaleAgentCost(assignmentFee, isMLS);
    return sellPrice - purchasePrice - agentCom - tcFee;
  };

  const atAsking = profitAt(askingPrice);
  const doubleCloseAtAsking = atAsking - TITLE.buy;

  const buyBox = getBuyBoxCeiling(city);
  const inBuyBox = askingPrice <= buyBox.maxAskingPrice;

  return {
    wsRehab,
    sellPrice,
    endBuyerAllIn,
    endBuyerProfit,
    tcFee,
    atLAO: profitAt(ladder.lao),
    atTier2: profitAt(ladder.tier2),
    atOpening: profitAt(ladder.opening),
    atTier4: profitAt(ladder.tier4),
    atMAO: profitAt(ladder.mao),
    atAsking,
    doubleCloseAtAsking,
    inBuyBox,
    buyBoxCeiling: buyBox.maxAskingPrice,
    go: atAsking >= WHOLESALE_MIN && status !== 'nogo' && inBuyBox,
  };
}

function calcBRRRR({ arv, rehab, askingPrice, monthlyRent }: any) {
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

export function underwriteDeal(input: {
  arv: number; rehab: number; askingPrice: number; city: string;
  isMLS?: boolean; monthlyRent?: number | null;
}) {
  const { arv, rehab, askingPrice, city, isMLS = false, monthlyRent = null } = input;

  if (arv == null || rehab == null || askingPrice == null || !city) {
    throw new Error('underwriteDeal requires arv, rehab, askingPrice, and city at minimum.');
  }

  const ladder = calcOfferLadder(arv, rehab);
  const status = dealStatus(askingPrice, ladder.mao, ladder.flexCeiling);

  const flip = calcFlip({ arv, rehab, askingPrice, city, ladder, status });
  const wholesale = calcWholesale({ arv, rehab, askingPrice, city, isMLS, ladder, status });
  const brrrr = calcBRRRR({ arv, rehab, askingPrice, monthlyRent });

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
    inputs: { arv, rehab, askingPrice, city, isMLS, monthlyRent },
    dealStatus: status,
    offerLadder: ladder,
    strategies,
    recommendedStrategy,
    engineVersion: ENGINE_VERSION,
  };
}
