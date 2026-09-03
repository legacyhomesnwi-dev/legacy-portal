// scoreAndPersistSample.js
// One-shot: pull the SAMPLE_TEST_DATA leads from Supabase, run each through
// scoreLead(), and persist the results to the `lead_scores` audit table.
//
// Parity with src/underwriting/scoreAndPersistSample.js. Unlike the
// underwriting side (where deal_analyses.property_id is nullable and sample
// rows are unlinked), lead_scores.property_id is NOT NULL and FK-enforced —
// so this runner scores EXISTING sample leads rather than inventing new ones.
// It never inserts into `leads`. `lead_scores` is append-only, so re-running
// just adds fresh score rows for the same leads (full history preserved).
//
//   cd src/lead-scoring && node scoreAndPersistSample.js
//
// AUTH: the engine tables (leads, signals, lead_scores, ...) now have Row Level
// Security enabled with NO policies, so the anon key gets permission-denied.
// This backend/dev script uses the SERVICE ROLE key (bypasses RLS), read from
// SUPABASE_SERVICE_ROLE_KEY in the repo-root .env (gitignored).
//
// It MUST NOT be a VITE_-prefixed var: Vite inlines every VITE_* value into the
// public frontend bundle, and the service role key is a full-access secret.
// URL is not secret; VITE_SUPABASE_URL is fine as a fallback.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { scoreLead } = require('./scoringEngine');
const { mapLeadToProperty } = require('./mapLeadToProperty');

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

// Which sample leads to score. These already exist in Supabase from earlier
// this session (owner names: Smith Family Trust, John and Mary Doe, Riverside
// Holdings LLC, Robert Johnson, Patricia Lee).
const SAMPLE_SOURCE = 'SAMPLE_TEST_DATA';

// Map a scoreLead() result to a lead_scores row.
function toScoreRow(propertyId, s) {
  return {
    property_id: propertyId,
    motivation_score: s.motivation_score,
    motivation_tier: s.motivation_tier,
    property_distress_score: s.property_distress_score ?? null,
    owner_motivation_score: s.owner_motivation_score ?? null,
    financial_distress_score: s.financial_distress_score ?? null,
    seller_intent_score: s.seller_intent_score ?? null,
    urgency_score: s.urgency_score ?? null,
    transaction_feasibility_score: s.transaction_feasibility_score ?? null,
    contactability_score: s.contactability_score ?? null,
    data_confidence: s.data_confidence ?? null,
    data_completeness: s.data_completeness ?? null,
    primary_signals: s.primary_signals ?? null,
    secondary_signals: s.secondary_signals ?? null,
    negative_signals: s.negative_signals ?? null,
    signal_stacks: s.signal_stacks ?? null,
    conflicting_signals: s.conflicting_signals ?? null,
    expired_signals: s.expired_signals ?? null,
    missing_information: s.missing_information ?? null,
    recommended_data_pulls: s.recommended_data_pulls ?? null,
    recommended_priority: s.recommended_priority ?? null,
    recommended_next_action: s.recommended_next_action ?? null,
    human_review_required: s.human_review_required ?? false,
    human_review_reason: s.human_review_reason ?? null,
    score_explanation: s.score_explanation ?? null,
    scoring_version: s.scoring_version,
    agent_version: s.agent_version,
  };
}

async function main() {
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, parcel_number, owner_name, city, assessed_value, tax_amount_due, years_owned, is_absentee_owner, is_out_of_state')
    .eq('source', SAMPLE_SOURCE)
    .order('created_at');

  if (leadsErr) {
    console.error('Failed to load sample leads:', leadsErr.message, leadsErr.details || '');
    process.exit(1);
  }
  if (!leads || leads.length === 0) {
    console.error(`No leads found with source='${SAMPLE_SOURCE}'. Nothing to score.`);
    process.exit(1);
  }

  const rows = [];
  const skipped = [];
  for (const lead of leads) {
    const property = mapLeadToProperty(lead);
    const s = scoreLead(property);

    // lead_scores.motivation_tier is CHECK-constrained to the six real tiers;
    // scoreLead() also has a 'SUPPRESSED' path (DO_NOT_CONTACT) that returns a
    // different shape. None of the current sample leads trigger it, but guard
    // rather than fail the whole batch on a constraint violation.
    if (s.motivation_tier === 'SUPPRESSED') {
      skipped.push({ owner: lead.owner_name, reason: 'SUPPRESSED (not modeled in lead_scores)' });
      continue;
    }

    rows.push(toScoreRow(lead.id, s));
    console.log(
      `${lead.owner_name.padEnd(22)} ${String(lead.city).padEnd(13)} ` +
        `score=${s.motivation_score}  tier=${s.motivation_tier}  ` +
        `completeness=${s.data_completeness}  review=${s.human_review_required}`
    );
  }

  if (skipped.length) {
    console.log('\nSkipped:');
    for (const sk of skipped) console.log(`  ${sk.owner} — ${sk.reason}`);
  }
  if (rows.length === 0) {
    console.error('\nNothing to insert.');
    process.exit(1);
  }

  const { data, error } = await supabase
    .from('lead_scores')
    .insert(rows)
    .select('score_id, property_id, motivation_score, motivation_tier, scored_at');

  if (error) {
    console.error('\nInsert failed:', error.message, error.details || '');
    process.exit(1);
  }

  const ownerById = Object.fromEntries(leads.map((l) => [l.id, l.owner_name]));
  console.log(`\nInserted ${data.length} row(s) into lead_scores:`);
  for (const d of data) {
    console.log(
      `  ${d.score_id}  ${String(ownerById[d.property_id]).padEnd(22)} ` +
        `${d.motivation_tier} (${d.motivation_score})`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
