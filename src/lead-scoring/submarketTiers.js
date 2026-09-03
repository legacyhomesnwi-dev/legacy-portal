// submarketTiers.js
// Config-driven submarket calibration for valuation-based distress signals.
// This replaces the old hardcoded 3-city special case (Gary/Hammond/East
// Chicago only) with a tier lookup that covers every city Justin operates
// in — even the ones with no precise threshold yet.
//
// IMPORTANT — CALIBRATION STATUS:
// Tier 1 threshold ($80,000) matches the original TAX_LOW_DISTRESSED_SUB
// cutoff, which was a real number Justin used. Tiers 2, 3, and the fallback
// are EXTRAPOLATED placeholders based on the cap-rate ordering only (higher
// cap rate = lower typical value), NOT real buy-box data. They should be
// treated as provisional until Justin supplies the full per-city buy-box
// price ceiling table — at which point this file gets updated with real
// numbers and nothing else in the engine changes.

const SUBMARKET_TIERS = {
  TIER_1_HIGH_DISTRESS: {
    cities: ['gary', 'hammond', 'east chicago'],
    capRateRange: '9.5-10%',
    lowValueThreshold: 80000, // REAL — matches original locked buy-box logic
    calibration: 'confirmed',
  },
  TIER_2_MID: {
    cities: ['merrillville', 'portage', 'highland'],
    capRateRange: '8.5-9%',
    lowValueThreshold: 130000, // PLACEHOLDER — extrapolated, not confirmed
    calibration: 'provisional',
  },
  TIER_3_LOW_DISTRESS: {
    cities: ['valparaiso', 'chesterton', 'munster', 'crown point'],
    capRateRange: '7.5-8%',
    lowValueThreshold: 200000, // PLACEHOLDER — extrapolated, not confirmed
    calibration: 'provisional',
  },
  FALLBACK_UNCLASSIFIED: {
    // Any Lake/Porter city not in one of the three named tiers above —
    // e.g. Cedar Lake, which the cap-rate tiers never covered in the first
    // place. This is the honest gap: we know almost nothing about what
    // "low value" means here, so the threshold is a rough blended guess
    // and confidence should be scored lower when this tier is used.
    cities: [],
    capRateRange: 'unknown',
    lowValueThreshold: 150000, // PLACEHOLDER — rough blend, low confidence
    calibration: 'unclassified',
  },
};

function getSubmarketTier(city) {
  const normalized = (city || '').trim().toLowerCase();
  for (const [tierName, tier] of Object.entries(SUBMARKET_TIERS)) {
    if (tier.cities.includes(normalized)) {
      return { tierName, ...tier };
    }
  }
  return { tierName: 'FALLBACK_UNCLASSIFIED', ...SUBMARKET_TIERS.FALLBACK_UNCLASSIFIED };
}

module.exports = { SUBMARKET_TIERS, getSubmarketTier };
