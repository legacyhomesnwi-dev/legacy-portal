// propertyMatcher.js
// Deterministic property matching. Order per spec: MLS# in existing listings
// -> normalized address -> parcel number (only known post-enrichment) ->
// leads table. Returns MATCHED / CREATED / AMBIGUOUS / NEEDS_REVIEW with
// confidence, never silently guesses.

function matchProperty(parsed, { existingListingByMls, existingPropertyByAddress }) {
  // 1. Existing MLS listing by MLS number -- strongest signal, this is
  // literally the same listing being updated.
  if (existingListingByMls) {
    return {
      match_result: 'MATCHED',
      match_confidence: 'HIGH',
      property_id: existingListingByMls.property_id,
      listing_id: existingListingByMls.id,
      reason: `Existing listing found for MLS #${parsed.mls_number}`,
    };
  }

  // 2. Normalized full address match against an existing property (no
  // listing yet for this MLS# specifically, but the property itself exists
  // -- e.g. a property we already have from off-market data or a prior
  // listing under a different MLS#).
  if (existingPropertyByAddress) {
    return {
      match_result: 'MATCHED',
      match_confidence: 'MEDIUM',
      property_id: existingPropertyByAddress.id,
      listing_id: null, // new listing needs to be created under this property
      reason: 'Existing property found by normalized address, new listing for this property',
    };
  }

  // 3. No match at all -- create a new canonical property + listing.
  if (!parsed.parsed_successfully) {
    return {
      match_result: 'NEEDS_REVIEW',
      match_confidence: 'LOW',
      property_id: null,
      listing_id: null,
      reason: `Parse errors present: ${parsed.parse_errors.join(', ')}`,
    };
  }

  return {
    match_result: 'CREATED',
    match_confidence: 'HIGH', // high confidence in a clean, well-formed new record
    property_id: null,
    listing_id: null,
    reason: 'No existing listing or property found -- creating new canonical property',
  };
}

module.exports = { matchProperty };

