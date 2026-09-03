// ingestMlsEmail.js
// Orchestrates: parse -> match -> enrich -> readiness. Pure logic, no
// direct DB calls (those happen in the caller, same separation as the
// scoring/underwriting engines -- keeps this testable without a live DB).

const { parseFlexmlsEmail, normalizeAddress } = require('./mlsEmailParser');
const { matchProperty } = require('./propertyMatcher');
const { enrichFromLeadsMatch } = require('./propertyEnrichment');
const { evaluateMLSAnalysisReadiness } = require('./analysisReadinessGate');

const PIPELINE_VERSION = 'v1.0.0';

function processMlsEmail(rawEmail, existingData) {
  // existingData = { existingListingByMls, existingPropertyByAddress, leadsRow }
  const parsed = parseFlexmlsEmail(rawEmail);

  if (!parsed.parsed_successfully) {
    return {
      incoming_record: {
        ...toIncomingRecordFields(parsed),
        processing_status: 'NEEDS_REVIEW',
        match_result: 'NEEDS_REVIEW',
        match_confidence: 'LOW',
        error: `Parse errors: ${parsed.parse_errors.join(', ')}`,
      },
      pipeline_version: PIPELINE_VERSION,
    };
  }

  const normalizedAddress = normalizeAddress(parsed.street_address, parsed.city, parsed.state, parsed.zip);
  const match = matchProperty(parsed, existingData);

  const { enriched, fieldSources, matchedLeadsRow } = enrichFromLeadsMatch(existingData.leadsRow);

  const propertyForReadiness = {
    normalized_address: normalizedAddress,
    property_type: enriched.property_type || null,
    sqft: enriched.sqft || null,
    beds: enriched.beds || null,
    baths: enriched.baths || null,
  };
  const listingForReadiness = { current_list_price: parsed.list_price };

  const readiness = evaluateMLSAnalysisReadiness(propertyForReadiness, listingForReadiness);

  const finalStatus = readiness.status; // ANALYSIS_READY or NEEDS_ENRICHMENT

  return {
    incoming_record: {
      ...toIncomingRecordFields(parsed),
      processing_status: finalStatus,
      match_result: match.match_result,
      match_confidence: match.match_confidence,
      missing_fields: readiness.missing_fields,
    },
    match,
    normalized_address: normalizedAddress,
    enrichment: { enriched, fieldSources, matchedLeadsRow },
    readiness,
    pipeline_version: PIPELINE_VERSION,
  };
}

function toIncomingRecordFields(parsed) {
  return {
    source_type: 'MLS_EMAIL',
    source_provider: 'FLEXMLS',
    external_record_id: parsed.source_email_id,
    received_at: parsed.received_at,
    raw_subject: parsed.subject,
    saved_search_name: parsed.saved_search_name,
    raw_address: [parsed.street_address, parsed.city, parsed.state, parsed.zip].filter(Boolean).join(', '),
    raw_price: parsed.list_price,
    raw_mls_number: parsed.mls_number,
    raw_status: parsed.listing_status,
    raw_update_type: parsed.update_type,
    raw_link: parsed.flexmls_url,
  };
}

// Maps a raw update_type string to the listing_events enum.
function toEventType(updateType) {
  const map = {
    'New Listing': 'NEW_LISTING',
    'Price Change': 'PRICE_CHANGE',
    'Back On Market': 'BACK_ON_MARKET',
    'Status Change': 'STATUS_CHANGE',
  };
  return map[updateType] || 'LISTING_UPDATE';
}

module.exports = { processMlsEmail, toEventType, PIPELINE_VERSION };

