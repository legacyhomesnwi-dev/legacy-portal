// mlsEmailParser.js
// Parses the ACTUAL verified Flexmls listing-alert email format (plain text
// body). Verified against 4 real emails from listingupdates@flexmail.flexmls.com
// to the agent inbox on 2026-09-03. Do not add fields that
// weren't actually observed -- beds/baths/sqft/year_built/garage/basement/
// remarks/photos/listing agent are NOT present in this email format.
//
// Real body structure (confirmed across New Listing / Price Change / Back
// On Market variants):
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
//   {agent signature block — name / brokerage / address / email / phone / license}

const UPDATE_TYPES = ['New Listing', 'Price Change', 'Back On Market', 'Status Change'];

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

module.exports = { parseFlexmlsEmail, normalizeAddress, UPDATE_TYPES };

