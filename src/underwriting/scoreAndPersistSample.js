// scoreAndPersistSample.js
// One-shot: run a handful of SAMPLE deals through underwriteDeal() and persist
// each result to the `deal_analyses` audit table in Supabase.
//
// SAMPLE DATA ONLY. Every deal below is fabricated test data, not a real lead.
// Rows are inserted with property_id = null so nothing links to live lead data.
// Safe to re-run: it appends new audit rows each time, never overwrites.
//
//   cd src/underwriting && node scoreAndPersistSample.js
//
// AUTH: the 5 engine tables (including deal_analyses) now have Row Level
// Security enabled with NO policies, so the anon key gets permission-denied on
// insert. This backend/dev script must use the SERVICE ROLE key, which bypasses
// RLS. That key is read from SUPABASE_SERVICE_ROLE_KEY in the repo-root .env
// (which is gitignored).
//
// It MUST NOT be a VITE_-prefixed var: Vite inlines every VITE_* value into the
// public frontend bundle. The service role key is a full-access secret and can
// never ship to the browser. URL is not secret; VITE_SUPABASE_URL is fine as a
// fallback.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { underwriteDeal } = require('./underwritingEngine');

// --- minimal .env reader (repo root); avoids a dotenv dependency ---
function loadEnv() {
  const envPath = path.resolve(__dirname, '../../.env');
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SERVICE_ROLE_KEY) {
  console.error(
    'Refusing to run: a service role key is set under a VITE_-prefixed name.\n' +
      'Vite bundles VITE_* vars into public frontend JS. Move it to a plain\n' +
      'SUPABASE_SERVICE_ROLE_KEY var (Node-only) and remove the VITE_ one.'
  );
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL / VITE_SUPABASE_URL in repo-root .env');
  process.exit(1);
}
if (!SUPABASE_KEY) {
  console.error(
    'Missing SUPABASE_SERVICE_ROLE_KEY in repo-root .env.\n' +
      'Supabase dashboard -> Project Settings -> API -> service_role (secret).\n' +
      'Add it as SUPABASE_SERVICE_ROLE_KEY=... (NOT a VITE_ name). The anon key\n' +
      'no longer works here: RLS is enabled on the engine tables with no policies.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- SAMPLE deals: fabricated, chosen to cover a mix of outcomes ---
const SAMPLE_DEALS = [
  {
    label: 'SAMPLE 1 — strong flip (Gary)',
    input: { arv: 180000, rehab: 25000, askingPrice: 60000, city: 'Gary', isMLS: false },
  },
  {
    label: 'SAMPLE 2 — wholesale-only (Gary, flip misses FLIP_MIN)',
    input: { arv: 120000, rehab: 35000, askingPrice: 42000, city: 'Gary', isMLS: false },
  },
  {
    label: 'SAMPLE 3 — no-go (asking above flex ceiling, Merrillville)',
    input: { arv: 150000, rehab: 20000, askingPrice: 130000, city: 'Merrillville', isMLS: true },
  },
  {
    label: 'SAMPLE 4 — BRRRR with monthly rent supplied (Gary)',
    input: { arv: 200000, rehab: 25000, askingPrice: 60000, city: 'Gary', isMLS: false, monthlyRent: 2200 },
  },
  {
    label: 'SAMPLE 5 — flex status (Highland, flip clears min not target)',
    input: { arv: 230000, rehab: 15000, askingPrice: 158000, city: 'Highland', isMLS: false },
  },
];

function toRow(input, result) {
  return {
    property_id: null, // SAMPLE data — deliberately unlinked from real leads
    arv: input.arv,
    rehab: input.rehab,
    asking_price: input.askingPrice,
    city: input.city,
    is_mls: input.isMLS ?? false,
    monthly_rent: input.monthlyRent ?? null,
    deal_status: result.dealStatus,
    recommended_strategy: result.recommendedStrategy,
    offer_ladder: result.offerLadder,
    flip_result: result.strategies.flip,
    wholesale_result: result.strategies.wholesale,
    brrrr_result: result.strategies.brrrr,
    engine_version: result.engineVersion,
  };
}

async function main() {
  const rows = [];
  for (const { label, input } of SAMPLE_DEALS) {
    const result = underwriteDeal(input);
    rows.push(toRow(input, result));
    console.log(label);
    console.log(
      `  status=${result.dealStatus}  recommended=${result.recommendedStrategy}`
    );
    console.log(
      `  MAO=$${result.offerLadder.mao.toFixed(0)}  flexCeiling=$${result.offerLadder.flexCeiling.toFixed(0)}` +
        `  flip.go=${result.strategies.flip.go}  wholesale.go=${result.strategies.wholesale.go}` +
        `  brrrr=${result.strategies.brrrr.available ? 'go=' + result.strategies.brrrr.go : 'n/a'}`
    );
  }

  const { data, error } = await supabase
    .from('deal_analyses')
    .insert(rows)
    .select('id, city, arv, asking_price, deal_status, recommended_strategy, analyzed_at');

  if (error) {
    console.error('\nInsert failed:', error.message, error.details || '');
    process.exit(1);
  }

  console.log(`\nInserted ${data.length} row(s) into deal_analyses:`);
  for (const d of data) {
    console.log(
      `  ${d.id}  ${d.city.padEnd(13)} ARV $${d.arv}  ask $${d.asking_price}  →  ${d.deal_status} / ${d.recommended_strategy}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
