// mlsEmailParser.js
// Parses the ACTUAL verified Flexmls listing-alert email format (plain text
// body). Verified against real emails from listingupdates@flexmail.flexmls.com
// to the agent inbox on 2026-09-03. Do not add fields that weren't actually
// observed -- beds/baths/sqft/year_built/garage/basement/remarks/photos/
// listing agent are NOT present in this email format.
//
// Real body structure (confirmed across New Listing / Price Change / Back
// On Market / Status Change variants):
//
//   {saved_search_name}
//
//   {saved_search_name}
//
//   {update_type}
//   ${price}
//   {street address}, {city}, {state} {zip}
//   {status} - MLS #{mls_number}
//
//   Update:
//
//   Follow this link to view the listing in flexmls: {flexmls_url}
//
//   {agent signature block -- redacted, not needed for parsing}

const UPDATE_TYPES = ['New Listing', 'Price Change', 'Back On Market', 'Status Change'];

// Digest emails bundle multiple listings into one message (e.g. periodic
// "here's everything currently matching your saved search" rather than a
// single triggered event). Detected by a distinct marker phrase that never
// appears in single-listing emails.
function isDigestFormat(plaintextBody) {
  return /Listings for ["\u201c]Subscription/.test(plaintextBody);
}

// Parses a digest email into an ARRAY of individual listing entries, since
// one email genuinely contains multiple properties. Each entry gets the
// same shape as a single-listing parse result would, EXCEPT there is no
// per-listing update_type in this format -- Flexmls doesn't tell us whether
// each entry is new/changed/etc. in a digest, so update_type is explicitly
// 'Digest Listing' rather than guessing.
function parseFlexmlsDigestEmail({ messageId, subject, sender, receivedAt, plaintextBody }) {
  if (!plaintextBody) {
    throw new Error('Empty email body -- cannot parse.');
  }

  const savedSearchName = subject?.trim() || null;
  const urlMatch = plaintextBody.match(/(https:\/\/www\.flexmls\.com\/notifications\.html\?[^\s]+)/);
  const flexmlsUrl = urlMatch ? urlMatch[1] : null;

  // Each listing entry: $PRICE \n ADDRESS, CITY, STATE ZIP \n STATUS - MLS #NUMBER
  const entryPattern = /\$([\d,]+\.\d{2})\n(.+?),\s*([A-Za-z .]+),\s*([A-Z]{2})\s+(\d{5})\n(.+?)\s*-\s*MLS #(\d+)/g;

  const listings = [];
  let match;
  while ((match = entryPattern.exec(plaintextBody)) !== null) {
    listings.push({
      list_price: parseFloat(match[1].replace(/,/g, '')),
      street_address: match[2].trim(),
      city: match[3].trim(),
      state: match[4].trim(),
      zip: match[5].trim(),
      listing_status: match[6].trim(),
      mls_number: match[7].trim(),
      update_type: 'Digest Listing',
    });
  }

  return {
    source_email_id: messageId,
    received_at: receivedAt,
    sender,
    subject,
    saved_search_name: savedSearchName,
    flexmls_url: flexmlsUrl,
    listings,
    is_digest: true,
    parse_errors: listings.length === 0 ? ['digest format detected but zero listing entries extracted'] : [],
    parsed_successfully: listings.length > 0,
  };
}

function parseFlexmlsEmail({ messageId, subject, sender, receivedAt, plaintextBody }) {
  if (!plaintextBody) {
    throw new Error('Empty email body -- cannot parse.');
  }

  const savedSearchName = subject?.trim() || null;

  // Update type: first line matching a known type, appears near the top
  // after the saved-search-name is repeated twice.
  let updateType = null;
  for (const type of UPDATE_TYPES) {
    if (plaintextBody.includes(type)) {
      updateType = type;
      break;
    }
  }

  // Price: "$XXX,XXX.XX" pattern
  const priceMatch = plaintextBody.match(/\$([\d,]+\.\d{2})/);
  const listPrice = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

  // Address: "{street}, {city}, {state} {zip}" -- appears on its own line
  const addressMatch = plaintextBody.match(/^(.+?),\s*([A-Za-z .]+),\s*([A-Z]{2})\s+(\d{5})$/m);
  const streetAddress = addressMatch ? addressMatch[1].trim() : null;
  const city = addressMatch ? addressMatch[2].trim() : null;
  const state = addressMatch ? addressMatch[3].trim() : null;
  const zip = addressMatch ? addressMatch[4].trim() : null;

  // Status + MLS#: "{Status} - MLS #{number}"
  const statusMlsMatch = plaintextBody.match(/^(.+?)\s*-\s*MLS #(\d+)/m);
  const listingStatus = statusMlsMatch ? statusMlsMatch[1].trim() : null;
  const mlsNumber = statusMlsMatch ? statusMlsMatch[2].trim() : null;

  // Flexmls URL
  const urlMatch = plaintextBody.match(/(https:\/\/www\.flexmls\.com\/notifications\.html\?[^\s]+)/);
  const flexmlsUrl = urlMatch ? urlMatch[1] : null;

  const errors = [];
  if (!updateType) errors.push('update_type not found');
  if (!listPrice) errors.push('price not found');
  if (!streetAddress) errors.push('address not found');
  if (!mlsNumber) errors.push('mls_number not found');

  return {
    source_email_id: messageId,
    received_at: receivedAt,
    sender,
    subject,
    saved_search_name: savedSearchName,
    update_type: updateType,
    list_price: listPrice,
    street_address: streetAddress,
    city,
    state,
    zip,
    mls_number: mlsNumber,
    listing_status: listingStatus,
    flexmls_url: flexmlsUrl,
    raw_email_reference: messageId,
    parse_errors: errors,
    parsed_successfully: errors.length === 0,
  };
}

function normalizeAddress(streetAddress, city, state, zip) {
  if (!streetAddress) return null;
  // Simple normalization: uppercase, strip extra whitespace, standardize
  // common abbreviations. Not a full USPS-standardization library -- good
  // enough for exact-match against similarly-normalized existing records.
  const clean = (s) =>
    (s || '')
      .toUpperCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\bAVENUE\b/g, 'AVE')
      .replace(/\bSTREET\b/g, 'ST')
      .replace(/\bPLACE\b/g, 'PL')
      .replace(/\bPLAZA\b/g, 'PLZ')
      .replace(/\bDRIVE\b/g, 'DR')
      .replace(/\bROAD\b/g, 'RD')
      .replace(/\bCOURT\b/g, 'CT')
      .replace(/\.\b/g, '');
  return `${clean(streetAddress)}, ${clean(city)}, ${clean(state)} ${(zip || '').trim()}`;
}

module.exports = { parseFlexmlsEmail, normalizeAddress, UPDATE_TYPES, isDigestFormat, parseFlexmlsDigestEmail };

