// ingestMlsEmail.js
// Orchestrates: parse -> match -> enrich -> readiness. Pure logic, no
// direct DB calls (those happen in the caller, same separation as the
// scoring/underwriting engines -- keeps this testable without a live DB).

const { parseFlexmlsEmail, parseFlexmlsDigestEmail, isDigestFormat, normalizeAddress } = require('./mlsEmailParser');
const { matchProperty } = require('./propertyMatcher');
const { enrichFromLeadsMatch } = require('./propertyEnrichment');
const { evaluateMLSAnalysisReadiness } = require('./analysisReadinessGate');

const PIPELINE_VERSION = 'v1.1.0'; // v1.1.0 adds digest-format support

// Digest emails bundle multiple listings into one message. Each bundled
// listing is processed through the exact same match -> enrich -> readiness
// pipeline as a single-listing email, but with a composite idempotency key
// (`${messageId}::${mlsNumber}`) since incoming_records models one row per
// property, not one row per email -- a 5-listing digest becomes 5 rows,
// each independently idempotent and traceable back to the source email.
function processMlsDigestEmail(rawEmail, existingDataByMls) {
  // existingDataByMls: { [mlsNumber]: { existingListingByMls, existingPropertyByAddress, leadsRow } }
  const parsed = parseFlexmlsDigestEmail(rawEmail);

  if (!parsed.parsed_successfully) {
    return {
      results: [{
        incoming_record: {
          source_type: 'MLS_EMAIL',
          source_provider: 'FLEXMLS',
          external_record_id: rawEmail.messageId,
          received_at: rawEmail.receivedAt,
          raw_subject: rawEmail.subject,
          processing_status: 'NEEDS_REVIEW',
          match_result: 'NEEDS_REVIEW',
          match_confidence: 'LOW',
          error: `Digest parse errors: ${parsed.parse_errors.join(', ')}`,
        },
      }],
      pipeline_version: PIPELINE_VERSION,
      is_digest: true,
    };
  }

  const results = parsed.listings.map((entry) => {
    const normalizedAddress = normalizeAddress(entry.street_address, entry.city, entry.state, entry.zip);
    const existing = (existingDataByMls && existingDataByMls[entry.mls_number]) || {};

    const entryParsed = {
      source_email_id: `${rawEmail.messageId}::${entry.mls_number}`,
      received_at: rawEmail.receivedAt,
      subject: rawEmail.subject,
      saved_search_name: parsed.saved_search_name,
      update_type: entry.update_type,
      list_price: entry.list_price,
      street_address: entry.street_address,
      city: entry.city,
      state: entry.state,
      zip: entry.zip,
      mls_number: entry.mls_number,
      listing_status: entry.listing_status,
      flexmls_url: parsed.flexmls_url,
      parsed_successfully: true,
    };

    const match = matchProperty(entryParsed, existing);
    const { enriched, fieldSources, matchedLeadsRow } = enrichFromLeadsMatch(existing.leadsRow);

    const propertyForReadiness = {
      normalized_address: normalizedAddress,
      property_type: enriched.property_type || null,
      sqft: enriched.sqft || null,
      beds: enriched.beds || null,
      baths: enriched.baths || null,
    };
    const readiness = evaluateMLSAnalysisReadiness(propertyForReadiness, { current_list_price: entry.list_price });

    return {
      incoming_record: {
        source_type: 'MLS_EMAIL',
        source_provider: 'FLEXMLS',
        external_record_id: entryParsed.source_email_id,
        received_at: entryParsed.received_at,
        raw_subject: entryParsed.subject,
        saved_search_name: entryParsed.saved_search_name,
        raw_address: [entry.street_address, entry.city, entry.state, entry.zip].filter(Boolean).join(', '),
        raw_price: entry.list_price,
        raw_mls_number: entry.mls_number,
        raw_status: entry.listing_status,
        raw_update_type: entry.update_type,
        raw_link: parsed.flexmls_url,
        processing_status: readiness.status,
        match_result: match.match_result,
        match_confidence: match.match_confidence,
        missing_fields: readiness.missing_fields,
      },
      match,
      normalized_address: normalizedAddress,
      enrichment: { enriched, fieldSources, matchedLeadsRow },
      readiness,
    };
  });

  return { results, pipeline_version: PIPELINE_VERSION, is_digest: true };
}

function processMlsEmail(rawEmail, existingData) {
  if (isDigestFormat(rawEmail.plaintextBody)) {
    return processMlsDigestEmail(rawEmail, existingData.existingDataByMls || {});
  }
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

module.exports = { processMlsEmail, processMlsDigestEmail, toEventType, PIPELINE_VERSION };

