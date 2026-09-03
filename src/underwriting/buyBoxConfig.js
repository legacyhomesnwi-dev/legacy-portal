// buyBoxConfig.js
// Max asking price by city, from the locked buy box. This is a genuine data
// gap: only two endpoints are confirmed from memory (Gary $115,000, Cedar
// Lake $325,000). Every other city's ceiling below is INTERPOLATED, not
// confirmed -- flagged with calibration: 'provisional'. Replace with real
// numbers from the actual buy-box table whenever Justin provides it; nothing
// else in the engine needs to change when you do.

const BUY_BOX = {
  // ---- Confirmed (real numbers from memory) ----
  gary: { maxAskingPrice: 115000, calibration: 'confirmed' },
  'cedar lake': { maxAskingPrice: 325000, calibration: 'confirmed' },

  // ---- Provisional -- interpolated between the two confirmed endpoints
  // using the same submarket ordering as the cap-rate tiers. NOT verified. ----
  hammond: { maxAskingPrice: 120000, calibration: 'provisional' },
  'east chicago': { maxAskingPrice: 125000, calibration: 'provisional' },
  merrillville: { maxAskingPrice: 180000, calibration: 'provisional' },
  portage: { maxAskingPrice: 190000, calibration: 'provisional' },
  highland: { maxAskingPrice: 210000, calibration: 'provisional' },
  valparaiso: { maxAskingPrice: 240000, calibration: 'provisional' },
  chesterton: { maxAskingPrice: 250000, calibration: 'provisional' },
  munster: { maxAskingPrice: 270000, calibration: 'provisional' },
  'crown point': { maxAskingPrice: 280000, calibration: 'provisional' },
};

// Fallback for any city not in the table above -- deliberately conservative
// (lower bound) rather than optimistic, and clearly flagged as unclassified.
const FALLBACK = { maxAskingPrice: 150000, calibration: 'unclassified' };

function getBuyBoxCeiling(city) {
  const normalized = (city || '').trim().toLowerCase();
  return BUY_BOX[normalized] || FALLBACK;
}

module.exports = { BUY_BOX, FALLBACK, getBuyBoxCeiling };

