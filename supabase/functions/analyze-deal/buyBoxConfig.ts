// buyBoxConfig.ts — ESM port. No price ceiling per Justin's direction —
// pure geographic check against real Lake/Porter County municipality lists
// (sourced from portercountyin.gov and verified county records).

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

export function getBuyBoxInfo(city: string | undefined) {
  const normalized = (city || '').trim().toLowerCase();
  if (LAKE_COUNTY_CITIES.includes(normalized)) return { inServiceArea: true, county: 'Lake' };
  if (PORTER_COUNTY_CITIES.includes(normalized)) return { inServiceArea: true, county: 'Porter' };
  return { inServiceArea: false, county: null };
}

