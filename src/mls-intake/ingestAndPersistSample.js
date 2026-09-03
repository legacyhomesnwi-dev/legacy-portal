// ingestAndPersistSample.js
// MLS intake persist runner — same auth pattern as
// src/lead-scoring/scoreAndPersistSample.js and
// src/underwriting/scoreAndPersistSample.js: service role key only, refuses
// to run on a VITE_-prefixed key, setup message when absent.
//
// Reads the 4 real (PII-redacted) fixtures already committed in
// realFixtures.js, runs each through the full pipeline (parse -> match ->
// enrich -> readiness), and writes to properties/listings/listing_events/
// incoming_records. Idempotent by design: checks incoming_records for an
// existing external_record_id before inserting, so re-running this script
// is always safe and never creates duplicates -- matching the DB-level
// unique constraint that's the real backstop.
//
// This uses the ONE real enrichment result already verified this session
// (4173 Jackson St, Gary -- MLS/county sqft conflict, resolved via source
// priority) for the matching fixture; the other 3 correctly stay
// NEEDS_ENRICHMENT since no real lookup was performed for them.

const { createClient } = require('@supabase/supabase-js');
const { processMlsEmail, toEventType } = require('./ingestMlsEmail');
const { parseFlexmlsEmail, normalizeAddress } = require('./mlsEmailParser');
const { enrichProperty } = require('./enrichmentProviders');
const { evaluateMLSAnalysisReadiness } = require('./analysisReadinessGate');
const { REAL_FIXTURES } = require('./realFixtures');

// --- Auth setup, identical pattern to the other two persist runners ---
function loadEnv() {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.resolve(__dirname, '../../.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) env[match[1].trim()] = match[2].trim();
    }
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };

const viteServiceKeyNames = Object.keys(env).filter(
  (k) => k.startsWith('VITE_') && /SERVICE_ROLE/i.test(k)
);
if (viteServiceKeyNames.length > 0) {
  console.error(
    `Refusing to run: found a service-role-looking key under a VITE_ prefix (${viteServiceKeyNames.join(', ')}). ` +
    `Vite inlines VITE_* into the public browser bundle. Rename it to a non-VITE_ variable (e.g. SUPABASE_SERVICE_ROLE_KEY).`
  );
  process.exit(1);
}

const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.log(`
Missing SUPABASE_SERVICE_ROLE_KEY.

Get it from: Supabase Dashboard -> Project Settings -> API -> service_role key
Add to your local .env (repo root, already gitignored):

  SUPABASE_SERVICE_ROLE_KEY=your-key-here

Never paste this value in chat. This script will not run without it.
`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// --- One real enrichment lookup result, from actual research this session ---
const REAL_ENRICHMENT_LOOKUPS = {
  '837383': {
    mlsDescriptionSqft: 1232,
    publicRecordFinishedSqft: 616,
    beds: 3,
    baths: 1,
    yearBuilt: 1920,
    propertyType: 'Single Family Residential',
    lotSizeSqft: 3136,
    parcelNumber: '450828403013000004',
    retrievedAt: new Date().toISOString(),
    sourceUrl: 'https://www.redfin.com/IN/Gary/4173-Jackson-St-46408/home/132269302',
  },
};

async function run() {
  console.log(`\n=== MLS Intake Persist Runner — ${REAL_FIXTURES.length} real fixtures ===\n`);

  const propertyCache = {}; // normalized_address -> property row
  const listingCache = {}; // mls_number -> listing row

  for (const fixture of REAL_FIXTURES) {
    console.log(`--- ${fixture.label} ---`);

    // Idempotency check FIRST, before any processing.
    const { data: existingRecord } = await supabase
      .from('incoming_records')
      .select('id, processing_status')
      .eq('source_provider', 'FLEXMLS')
      .eq('external_record_id', fixture.messageId)
      .maybeSingle();

    if (existingRecord) {
      console.log(`  SKIPPED — already processed (incoming_record ${existingRecord.id}, status ${existingRecord.processing_status})\n`);
      continue;
    }

    const parsed = parseFlexmlsEmail(fixture);
    const normalizedAddr = normalizeAddress(parsed.street_address, parsed.city, parsed.state, parsed.zip);

    // Check for existing listing/property (DB-backed, not simulated)
    const { data: existingListing } = await supabase
      .from('listings')
      .select('id, property_id')
      .eq('mls_number', parsed.mls_number)
      .eq('source', 'FLEXMLS')
      .maybeSingle();

    const { data: existingProperty } = await supabase
      .from('properties')
      .select('id')
      .eq('normalized_address', normalizedAddr)
      .maybeSingle();

    let propertyId, listingId, matchResult, matchConfidence;

    if (existingListing) {
      propertyId = existingListing.property_id;
      listingId = existingListing.id;
      matchResult = 'MATCHED';
      matchConfidence = 'HIGH';
      console.log(`  MATCHED existing listing (MLS #${parsed.mls_number})`);
    } else {
      // Create property (or reuse if address already matched)
      if (existingProperty) {
        propertyId = existingProperty.id;
      } else {
        const { data: newProp, error: propErr } = await supabase
          .from('properties')
          .insert({
            normalized_address: normalizedAddr,
            street_address: parsed.street_address,
            city: parsed.city,
            state: parsed.state,
            zip: parsed.zip,
            county: 'Lake', // all 3 fixture cities are Lake County
          })
          .select()
          .single();
        if (propErr) throw propErr;
        propertyId = newProp.id;
      }

      const { data: newListing, error: listErr } = await supabase
        .from('listings')
        .insert({
          property_id: propertyId,
          mls_number: parsed.mls_number,
          source: 'FLEXMLS',
          saved_search_name: parsed.saved_search_name,
          status: parsed.listing_status,
          current_list_price: parsed.list_price,
          original_list_price: parsed.list_price,
          first_seen_at: parsed.received_at,
          last_seen_at: parsed.received_at,
          last_update_type: parsed.update_type,
          flexmls_url: parsed.flexmls_url,
          source_email_id: parsed.source_email_id,
        })
        .select()
        .single();
      if (listErr) throw listErr;
      listingId = newListing.id;
      matchResult = 'CREATED';
      matchConfidence = 'HIGH';
      console.log(`  CREATED new property + listing (MLS #${parsed.mls_number})`);
    }

    // If matched (price change / status update on existing listing), update it + log event
    if (matchResult === 'MATCHED') {
      const { data: currentListing } = await supabase.from('listings').select('*').eq('id', listingId).single();
      await supabase
        .from('listings')
        .update({
          current_list_price: parsed.list_price,
          status: parsed.listing_status,
          last_seen_at: parsed.received_at,
          last_update_type: parsed.update_type,
          updated_at: new Date().toISOString(),
        })
        .eq('id', listingId);

      await supabase.from('listing_events').insert({
        listing_id: listingId,
        event_type: toEventType(parsed.update_type),
        old_value: { price: currentListing.current_list_price },
        new_value: { price: parsed.list_price },
        received_at: parsed.received_at,
        source_email_id: parsed.source_email_id,
      });
    } else {
      await supabase.from('listing_events').insert({
        listing_id: listingId,
        event_type: toEventType(parsed.update_type),
        old_value: null,
        new_value: { price: parsed.list_price, status: parsed.listing_status },
        received_at: parsed.received_at,
        source_email_id: parsed.source_email_id,
      });
    }

    // Enrichment — real lookup if we have one, otherwise leads-only (will be UNKNOWN)
    const realLookup = REAL_ENRICHMENT_LOOKUPS[parsed.mls_number] || null;
    const { enriched, fieldSources } = enrichProperty({ leadsRow: null, publicRecordLookup: realLookup });

    if (Object.keys(enriched).length > 0) {
      await supabase
        .from('properties')
        .update({ ...enriched, field_sources: fieldSources, updated_at: new Date().toISOString() })
        .eq('id', propertyId);
      console.log(`  ENRICHED with real lookup data:`, Object.keys(enriched).join(', '));
    }

    const { data: propertyForReadiness } = await supabase.from('properties').select('*').eq('id', propertyId).single();
    const readiness = evaluateMLSAnalysisReadiness(
      { ...propertyForReadiness, normalized_address: normalizedAddr },
      { current_list_price: parsed.list_price }
    );

    const { error: incomingErr } = await supabase.from('incoming_records').insert({
      source_type: 'MLS_EMAIL',
      source_provider: 'FLEXMLS',
      external_record_id: fixture.messageId,
      received_at: parsed.received_at,
      raw_subject: parsed.subject,
      saved_search_name: parsed.saved_search_name,
      raw_address: [parsed.street_address, parsed.city, parsed.state, parsed.zip].filter(Boolean).join(', '),
      raw_price: parsed.list_price,
      raw_mls_number: parsed.mls_number,
      raw_status: parsed.listing_status,
      raw_update_type: parsed.update_type,
      raw_link: parsed.flexmls_url,
      processing_status: readiness.status,
      match_result: matchResult,
      match_confidence: matchConfidence,
      matched_property_id: propertyId,
      matched_listing_id: listingId,
      missing_fields: readiness.missing_fields,
      processed_at: new Date().toISOString(),
    });
    if (incomingErr) throw incomingErr;

    console.log(`  processing_status: ${readiness.status}${readiness.missing_fields.length ? ' (missing: ' + readiness.missing_fields.join(', ') + ')' : ''}\n`);
  }

  console.log('=== Done ===');
}

run().catch((e) => {
  console.error('Runner failed:', e);
  process.exit(1);
});

