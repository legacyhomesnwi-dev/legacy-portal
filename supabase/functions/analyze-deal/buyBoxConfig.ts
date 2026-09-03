// buyBoxConfig.ts — ESM port of src/underwriting/buyBoxConfig.js for Deno.
// Same data, same honest gap: only Gary and Cedar Lake are confirmed real
// numbers, everything else is a provisional interpolation. Keep this in
// sync manually with the Node version until there's a shared package.

export const BUY_BOX: Record<string, { maxAskingPrice: number; calibration: string }> = {
  gary: { maxAskingPrice: 115000, calibration: 'confirmed' },
  'cedar lake': { maxAskingPrice: 325000, calibration: 'confirmed' },

  hammond: { maxAskingPrice: 120000, calibration: 'provisional' },
  'east chicago': { maxAskingPrice: 125000, calibration: 'provisional' },
  merrillville: { maxAskingPrice: 180000, calibration: 'provisional' },
  portage: { maxAskingPrice: 190000, calibration: 'provisional' },
  highland: { maxAskingPrice: 210000, calibration: 'provisional' },
  valparaiso: { maxAskingPrice: 240000, calibration: 'provisional' },
  chesterton: { maxAskingPrice: 250000, calibration: 'provisional' },
  munster: { maxAskingPrice: 270000, calibration: 'provisional' },
  'crown point': { maxAskingPrice: 280000, calibration: 'provisional' },
};

const FALLBACK = { maxAskingPrice: 150000, calibration: 'unclassified' };

export function getBuyBoxCeiling(city: string | undefined) {
  const normalized = (city || '').trim().toLowerCase();
  return BUY_BOX[normalized] || FALLBACK;
}
