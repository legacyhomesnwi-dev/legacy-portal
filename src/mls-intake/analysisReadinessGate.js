// analysisReadinessGate.js
// Deterministic readiness check -- no LLM involved. Evaluates whether a
// property+listing has enough real data to proceed to Deal Intelligence.
// Given the honest enrichment-source gap (leads table has no sqft/beds/
// baths), MOST properties will legitimately land on NEEDS_ENRICHMENT today.
// That's correct, not a failure of this function.

function evaluateMLSAnalysisReadiness(property, listing) {
  const missing = [];

  // Minimum requirements, per spec section 10.
  if (!property?.normalized_address) missing.push('normalized_address');
  if (!listing?.current_list_price) missing.push('current_list_price');
  if (!property?.property_type) missing.push('property_type');
  if (!property?.sqft) missing.push('sqft'); // required by rehab/comp logic (CONDITIONS calculator needs sqft)

  // Basic property characteristics -- beds/baths matter for comp quality
  // but aren't a hard blocker the way sqft is (sqft directly feeds the
  // existing rehab calculator); track as missing but don't hard-block solely on these two.
  const softMissing = [];
  if (property?.beds == null) softMissing.push('beds');
  if (property?.baths == null) softMissing.push('baths');

  if (missing.length > 0) {
    return {
      status: 'NEEDS_ENRICHMENT',
      missing_fields: missing,
      soft_missing_fields: softMissing,
      reason: `Missing required fields: ${missing.join(', ')}`,
    };
  }

  return {
    status: 'ANALYSIS_READY',
    missing_fields: [],
    soft_missing_fields: softMissing,
    reason: softMissing.length
      ? `Ready -- minor gaps (${softMissing.join(', ')}) won't block analysis but reduce comp confidence`
      : 'All required and soft fields present',
  };
}

module.exports = { evaluateMLSAnalysisReadiness };

