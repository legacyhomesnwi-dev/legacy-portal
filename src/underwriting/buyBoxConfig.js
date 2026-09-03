// buyBoxConfig.js
// Per Justin's direction: no per-city price ceiling for now. This is now a
// pure geographic check — is the property in Lake or Porter County at all —
// rather than a price-based gate. City lists sourced from Porter County's
// own government site (portercountyin.gov) and verified county records,
// not guessed or interpolated.

const LAKE_COUNTY_CITIES = [
  'gary', 'hammond', 'east chicago', 'hobart', 'lake station', 'whiting',
  'cedar lake', 'dyer', 'griffith', 'highland', 'lowell', 'merrillville',
  'munster', 'new chicago', 'schererville', 'schneider', 'st. john',
  'st john', 'winfield', 'crown point',
];

const PORTER_COUNTY_CITIES = [
  'beverly shores', 'burns harbor', 'chesterton', 'dune acres', 'hebron',
  'kouts', 'ogden dunes', 'pines', 'town of pines', 'portage', 'porter',
  'valparaiso',
];

function getBuyBoxInfo(city) {
  const normalized = (city || '').trim().toLowerCase();
  if (LAKE_COUNTY_CITIES.includes(normalized)) {
    return { inServiceArea: true, county: 'Lake' };
  }
  if (PORTER_COUNTY_CITIES.includes(normalized)) {
    return { inServiceArea: true, county: 'Porter' };
  }
  return { inServiceArea: false, county: null };
}

module.exports = { LAKE_COUNTY_CITIES, PORTER_COUNTY_CITIES, getBuyBoxInfo };


