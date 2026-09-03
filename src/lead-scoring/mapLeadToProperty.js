// mapLeadToProperty.js
// Maps a public.leads table row (snake_case, values may arrive as strings from
// PostgREST) into the property object shape scoreLead() expects (camelCase plus
// one derived field). Kept as its own module — same separation-of-concerns as
// the underwriting side keeping buyBoxConfig.js separate: this is data-shaping,
// not scoring logic.

// Owner-name patterns implying a non-individual owner (estate / trust / LLC /
// corporation). Case-insensitive, word-boundary anchored so "Trustworthy Homes"
// or "Corporate Woods Dr" don't false-positive.
const ENTITY_OWNER_RE = /\b(LLC|L\.L\.C\.|TRUST|ESTATE OF|INC|CORP)\b/i;

function num(v) {
  return v === null || v === undefined || v === '' ? undefined : Number(v);
}

function mapLeadToProperty(lead) {
  const ownerIsEntity = ENTITY_OWNER_RE.test(lead.owner_name || '');

  const property = {
    // identity / entity-match-confidence inputs
    id: lead.id,
    parcelNumber: lead.parcel_number ?? undefined,
    ownerName: lead.owner_name ?? undefined,
    city: lead.city ?? undefined,

    // derived: is the owner an estate / trust / LLC / corp?
    ownerIsEstateTrustOrLLC: ownerIsEntity,

    // pass-through signal inputs (coerced to number where numeric)
    assessedValue: num(lead.assessed_value),
    taxAmountDue: num(lead.tax_amount_due),
    yearsOwned: num(lead.years_owned),
    isAbsenteeOwner: lead.is_absentee_owner ?? undefined,
    isOutOfState: lead.is_out_of_state ?? undefined,
  };

  // Confidence dampener: a name-regex hit is a strong indicator, not a
  // confirmed entity classification, so tell the engine to weight this one
  // signal at 0.8 instead of its 0.85 default.
  if (ownerIsEntity) {
    property['OWN_ESTATE_TRUST_LLC__confidence'] = 0.8;
  }

  return property;
}

module.exports = { mapLeadToProperty, ENTITY_OWNER_RE };
