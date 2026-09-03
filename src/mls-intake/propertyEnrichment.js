// propertyEnrichment.js
// Enriches a property from EXISTING data sources only -- currently just the
// `leads` table (Airtable-mirrored assessor/off-market data). Honest finding
// from Step 3 schema inspection: `leads` has NO sqft/beds/baths/year_built/
// garage/basement columns. This function will therefore correctly return
// those fields as UNKNOWN for nearly every property today -- that's accurate
// given what data actually exists, not a bug. Do not fabricate values.

const LEADS_ENRICHABLE_FIELDS = [
  'parcel_number',
  'assessed_value',
  'tax_amount_due',
  'years_owned',
  'owner_name',
  'is_absentee_owner',
  'is_out_of_state',
];

// Fields the analysis pipeline actually needs but `leads` cannot supply today.
const PHYSICAL_CHARACTERISTIC_FIELDS = ['sqft', 'beds', 'baths', 'year_built', 'property_type'];

function enrichFromLeadsMatch(leadsRow) {
  const fieldSources = {};
  const enriched = {};

  if (leadsRow) {
    for (const field of LEADS_ENRICHABLE_FIELDS) {
      if (leadsRow[field] != null) {
        enriched[field] = leadsRow[field];
        fieldSources[field] = {
          value: leadsRow[field],
          source: 'LEADS_TABLE', // downstream of county assessor / XSoft Engage per existing pipeline
          confidence: 'VERIFIED_SOURCE',
          updated_at: new Date().toISOString(),
        };
      }
    }
  }

  // Physical characteristics: explicitly mark UNKNOWN rather than omit --
  // this is what lets the readiness gate correctly report NEEDS_ENRICHMENT
  // with a specific missing-field list instead of silently proceeding.
  for (const field of PHYSICAL_CHARACTERISTIC_FIELDS) {
    if (enriched[field] == null) {
      fieldSources[field] = {
        value: null,
        source: 'UNKNOWN',
        confidence: null,
        updated_at: new Date().toISOString(),
      };
    }
  }

  return { enriched, fieldSources, matchedLeadsRow: !!leadsRow };
}

module.exports = { enrichFromLeadsMatch, LEADS_ENRICHABLE_FIELDS, PHYSICAL_CHARACTERISTIC_FIELDS };

