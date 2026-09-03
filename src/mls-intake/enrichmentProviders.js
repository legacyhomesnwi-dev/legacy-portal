// enrichmentProviders.js
// Pluggable PropertyEnrichmentProvider architecture. Each provider implements
// the same interface; the orchestrator calls them in priority order per
// field (not globally -- county assessor may win for year_built while MLS
// wins for current sqft/beds/baths, per spec section 7).
//
// HONEST ARCHITECTURE NOTE: automated bulk scraping of Zillow/Redfin/
// Realtor.com is NOT implemented here, because those sites restrict
// automated access in their Terms of Service. What IS implemented:
// - LeadsTableProvider: fully automated, queries our own existing data
// - PublicRecordLookupProvider: status 'MANUAL_ASSISTED' -- populated from
//   a real, individual, interactive lookup (the kind of one-off research
//   a human or an AI assistant does in a single session), NOT an automated
//   scraper hitting these sites at volume. This is the correct line per
//   the spec's own instruction: "If a source cannot legally or technically
//   be automated, use the next available provider rather than trying to
//   circumvent restrictions."
// - Future automated replacement: a LICENSED property-data API (ATTOM,
//   CoreLogic, or similar), which explicitly permits automated access.
//   This provider slot exists and is ready for that swap -- nothing else
//   in the system needs to change when it happens.

// ---------------------------------------------------------------------------
// Source priority hierarchy. Field-specific -- NOT one global ranking, per
// spec section 7 ("do not assume one source is best for every field").
// ---------------------------------------------------------------------------
const SOURCE_PRIORITY = {
  // Field -> ordered list of sources, highest priority first
  sqft: ['MLS_LISTING_DESCRIPTION', 'PUBLIC_LISTING_REDFIN', 'COUNTY_ASSESSOR_VIA_REDFIN', 'LEADS_TABLE'],
  beds: ['MLS_LISTING_DESCRIPTION', 'PUBLIC_LISTING_REDFIN', 'COUNTY_ASSESSOR_VIA_REDFIN', 'LEADS_TABLE'],
  baths: ['MLS_LISTING_DESCRIPTION', 'PUBLIC_LISTING_REDFIN', 'COUNTY_ASSESSOR_VIA_REDFIN', 'LEADS_TABLE'],
  year_built: ['COUNTY_ASSESSOR_VIA_REDFIN', 'LEADS_TABLE', 'PUBLIC_LISTING_REDFIN'],
  parcel_number: ['COUNTY_ASSESSOR_VIA_REDFIN', 'LEADS_TABLE'],
  lot_size: ['COUNTY_ASSESSOR_VIA_REDFIN', 'PUBLIC_LISTING_REDFIN', 'LEADS_TABLE'],
  property_type: ['MLS_LISTING_DESCRIPTION', 'PUBLIC_LISTING_REDFIN', 'COUNTY_ASSESSOR_VIA_REDFIN'],
  garage: ['PUBLIC_LISTING_REDFIN', 'COUNTY_ASSESSOR_VIA_REDFIN'],
  basement: ['PUBLIC_LISTING_REDFIN', 'COUNTY_ASSESSOR_VIA_REDFIN'],
};

function resolveFieldConflict(field, candidates) {
  // candidates: [{ value, source, confidence, retrieved_at }, ...]
  if (candidates.length === 0) {
    return { value: null, source: 'UNKNOWN', confidence: null, conflict: null };
  }
  if (candidates.length === 1) {
    return { ...candidates[0], conflict: null };
  }

  const priorityOrder = SOURCE_PRIORITY[field] || [];
  const sorted = [...candidates].sort((a, b) => {
    const aIdx = priorityOrder.indexOf(a.source);
    const bIdx = priorityOrder.indexOf(b.source);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  const winner = sorted[0];
  const conflicting = sorted.slice(1).filter((c) => c.value !== winner.value);

  return {
    ...winner,
    conflict: conflicting.length
      ? { winning_value: winner.value, winning_source: winner.source, other_candidates: conflicting }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Provider: existing leads table (fully automated)
// ---------------------------------------------------------------------------
function leadsTableProvider(leadsRow) {
  if (!leadsRow) return {};
  const candidates = {};
  const fieldMap = { parcel_number: 'parcel_number' }; // leads table only overlaps on parcel_number for these physical fields
  for (const [propField, leadsField] of Object.entries(fieldMap)) {
    if (leadsRow[leadsField] != null) {
      candidates[propField] = [{
        value: leadsRow[leadsField],
        source: 'LEADS_TABLE',
        confidence: 'VERIFIED_SOURCE',
        retrieved_at: new Date().toISOString(),
      }];
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Provider: public record lookup (MANUAL_ASSISTED status -- see note above)
// Takes pre-fetched lookup results rather than performing its own HTTP
// calls, so this module stays testable and honest about its data source.
// ---------------------------------------------------------------------------
function publicRecordLookupProvider(lookupResult) {
  // lookupResult shape: { mlsDescriptionSqft, publicRecordFinishedSqft,
  //   beds, baths, yearBuilt, propertyType, lotSizeSqft, parcelNumber,
  //   garage, basement, retrievedAt, sourceUrl }
  if (!lookupResult) return {};

  const candidates = {};
  const retrieved_at = lookupResult.retrievedAt || new Date().toISOString();

  if (lookupResult.mlsDescriptionSqft != null) {
    (candidates.sqft = candidates.sqft || []).push({
      value: lookupResult.mlsDescriptionSqft,
      source: 'MLS_LISTING_DESCRIPTION',
      confidence: 'MEDIUM', // marketing copy, not a verified structured field
      retrieved_at,
    });
  }
  if (lookupResult.publicRecordFinishedSqft != null) {
    (candidates.sqft = candidates.sqft || []).push({
      value: lookupResult.publicRecordFinishedSqft,
      source: 'COUNTY_ASSESSOR_VIA_REDFIN',
      confidence: 'VERIFIED_SOURCE',
      retrieved_at,
    });
  }
  if (lookupResult.beds != null) {
    candidates.beds = [{ value: lookupResult.beds, source: 'PUBLIC_LISTING_REDFIN', confidence: 'VERIFIED_SOURCE', retrieved_at }];
  }
  if (lookupResult.baths != null) {
    candidates.baths = [{ value: lookupResult.baths, source: 'PUBLIC_LISTING_REDFIN', confidence: 'VERIFIED_SOURCE', retrieved_at }];
  }
  if (lookupResult.yearBuilt != null) {
    candidates.year_built = [{ value: lookupResult.yearBuilt, source: 'COUNTY_ASSESSOR_VIA_REDFIN', confidence: 'VERIFIED_SOURCE', retrieved_at }];
  }
  if (lookupResult.propertyType != null) {
    candidates.property_type = [{ value: lookupResult.propertyType, source: 'PUBLIC_LISTING_REDFIN', confidence: 'VERIFIED_SOURCE', retrieved_at }];
  }
  if (lookupResult.lotSizeSqft != null) {
    candidates.lot_size = [{ value: lookupResult.lotSizeSqft, source: 'COUNTY_ASSESSOR_VIA_REDFIN', confidence: 'VERIFIED_SOURCE', retrieved_at }];
  }
  if (lookupResult.parcelNumber != null) {
    candidates.parcel_number = [{ value: lookupResult.parcelNumber, source: 'COUNTY_ASSESSOR_VIA_REDFIN', confidence: 'VERIFIED_SOURCE', retrieved_at }];
  }
  // garage/basement intentionally omitted when source shows blank ("—")
  // rather than fabricating false/absent -- per "do not invent unavailable values"

  return candidates;
}

// ---------------------------------------------------------------------------
// Orchestrator: runs providers in order, merges candidates per field,
// resolves conflicts via priority rules.
// ---------------------------------------------------------------------------
function enrichProperty({ leadsRow, publicRecordLookup }) {
  const providerResults = [
    leadsTableProvider(leadsRow),
    publicRecordLookupProvider(publicRecordLookup),
  ];

  const allFields = new Set();
  for (const result of providerResults) {
    Object.keys(result).forEach((f) => allFields.add(f));
  }

  const fieldSources = {};
  const enriched = {};

  for (const field of allFields) {
    const candidates = providerResults.flatMap((r) => r[field] || []);
    const resolved = resolveFieldConflict(field, candidates);
    fieldSources[field] = resolved;
    if (resolved.value != null) enriched[field] = resolved.value;
  }

  return { enriched, fieldSources };
}

module.exports = { enrichProperty, resolveFieldConflict, SOURCE_PRIORITY, leadsTableProvider, publicRecordLookupProvider };

