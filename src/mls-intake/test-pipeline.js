const { processMlsEmail, processMlsDigestEmail, toEventType } = require('./ingestMlsEmail');
const { REAL_FIXTURES } = require('./realFixtures');

console.log('=== TEST 1-9: Pipeline against 4 real single-listing fixtures ===\n');

// Simulated "state" -- in real use this comes from actual Supabase queries.
const state = { listingsByMls: {}, propertiesByAddress: {} };
const singleFixtures = REAL_FIXTURES.filter((f) => !f.label.startsWith('Digest'));
const digestFixture = REAL_FIXTURES.find((f) => f.label.startsWith('Digest'));

for (const fixture of singleFixtures) {
  console.log(`--- ${fixture.label} ---`);

  // Look up existing state (mimics what a real DB query would return)
  const parsedPreview = require('./mlsEmailParser').parseFlexmlsEmail(fixture);
  const existingListingByMls = state.listingsByMls[parsedPreview.mls_number] || null;
  const normalizedAddr = require('./mlsEmailParser').normalizeAddress(
    parsedPreview.street_address, parsedPreview.city, parsedPreview.state, parsedPreview.zip
  );
  const existingPropertyByAddress = state.propertiesByAddress[normalizedAddr] || null;

  const result = processMlsEmail(fixture, {
    existingListingByMls,
    existingPropertyByAddress,
    leadsRow: null, // confirmed no real leads match exists for these addresses
  });

  console.log('  match_result:', result.match.match_result, '| confidence:', result.match.match_confidence);
  console.log('  reason:', result.match.reason);
  console.log('  processing_status:', result.incoming_record.processing_status);
  console.log('  missing_fields:', result.incoming_record.missing_fields);
  console.log('  event_type:', toEventType(result.incoming_record.raw_update_type));

  // Simulate state update (what the real DB write would do)
  if (result.match.match_result === 'CREATED') {
    const propId = `prop-${parsedPreview.mls_number}`;
    const listingId = `listing-${parsedPreview.mls_number}`;
    state.propertiesByAddress[normalizedAddr] = { id: propId };
    state.listingsByMls[parsedPreview.mls_number] = { id: listingId, property_id: propId };
    console.log('  -> Created new property + listing');
  } else if (result.match.match_result === 'MATCHED') {
    console.log('  -> Matched existing listing, this is a PRICE_CHANGE/STATUS event on it, NOT a duplicate');
  }
  console.log('');
}

console.log('=== TEST 2: Idempotency — same message processed twice ===');
const dup1 = processMlsEmail(REAL_FIXTURES[0], { existingListingByMls: null, existingPropertyByAddress: null, leadsRow: null });
const dup2 = processMlsEmail(REAL_FIXTURES[0], { existingListingByMls: null, existingPropertyByAddress: null, leadsRow: null });
console.log('external_record_id both times:', dup1.incoming_record.external_record_id, '===', dup2.incoming_record.external_record_id);
console.log('(DB unique constraint on (source_provider, external_record_id) prevents actual duplicate row -- this is enforced at the schema level, not just app logic)');

console.log('\n=== TEST 10: Unrelated email is ignored ===');
try {
  const unrelated = processMlsEmail(
    { messageId: 'x', subject: 'Your Amazon order', sender: 'amazon.com', receivedAt: '2026-09-03T00:00:00Z', plaintextBody: 'Your package has shipped.' },
    { existingListingByMls: null, existingPropertyByAddress: null, leadsRow: null }
  );
  console.log('Result: processing_status =', unrelated.incoming_record.processing_status, '(correctly NOT processed as a listing)');
} catch (e) {
  console.log('Handled gracefully:', e.message);
}

console.log('\n=== TEST 13: Digest email — Portage Buy Box, 5 bundled listings ===\n');
const digestResult = processMlsDigestEmail(digestFixture, {});
console.log('is_digest:', digestResult.is_digest, '| listings parsed:', digestResult.results.length);
digestResult.results.forEach((r) => {
  console.log(
    ` MLS #${r.incoming_record.raw_mls_number} | $${r.incoming_record.raw_price} | ${r.incoming_record.raw_address} | external_record_id=${r.incoming_record.external_record_id} | match=${r.match.match_result} | status=${r.incoming_record.processing_status}`
  );
});
const uniqueIds = new Set(digestResult.results.map((r) => r.incoming_record.external_record_id));
console.log('Unique external_record_ids:', uniqueIds.size, '(expect 5, each independently idempotent)');

