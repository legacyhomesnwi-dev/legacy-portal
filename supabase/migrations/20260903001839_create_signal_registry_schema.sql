-- ============================================================
-- PropFlowREI Lead Scoring Agent — Signal Registry Schema
-- Motivation Score scale: 0-100 (decided 2026-09-02)
-- References public.leads(id) as the property record — no separate
-- properties/owners tables exist yet, so person_id is a free-text
-- field for now rather than a foreign key.
-- ============================================================

create table if not exists signal_definitions (
  signal_type text primary key,
  category text not null,
  correlation_group text,
  description text,
  default_base_weight numeric not null,
  default_severity smallint,
  freshness_curve jsonb,
  stack_eligible boolean not null default true,
  min_confidence_required numeric not null default 0.5,
  status text not null check (status in (
    'CURRENTLY_AVAILABLE', 'PARTIALLY_AVAILABLE', 'READY_TO_ADD',
    'DATA_SOURCE_NEEDED', 'FUTURE', 'NOT_APPROPRIATE'
  )),
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table signal_definitions is
  'Registry of every distress/motivation signal the scoring engine knows about. Add new signals by inserting rows here, not by editing scoring code.';

create table if not exists signals (
  signal_id uuid primary key default gen_random_uuid(),
  property_id uuid not null references leads(id) on delete cascade,
  person_id text,
  signal_type text not null references signal_definitions(signal_type),
  signal_category text not null,
  correlation_group text,
  source_name text not null,
  source_record_id text,
  source_url_or_reference text,
  observed_at timestamptz not null default now(),
  event_date date,
  expires_at date,
  raw_value jsonb,
  base_weight numeric not null,
  severity smallint,
  source_reliability numeric not null check (source_reliability between 0 and 1),
  signal_confidence numeric not null check (signal_confidence between 0 and 1),
  match_confidence text check (match_confidence in ('HIGH', 'MEDIUM', 'LOW')),
  stacking_group text,
  geographic_scope text,
  metadata jsonb,
  verified boolean not null default false,
  verification_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_signals_property_id on signals(property_id);
create index if not exists idx_signals_signal_type on signals(signal_type);
create index if not exists idx_signals_correlation_group on signals(correlation_group);

comment on table signals is
  'One row per observed signal instance. Full audit trail: source, confidence, freshness inputs, match confidence.';

create table if not exists lead_scores (
  score_id uuid primary key default gen_random_uuid(),
  property_id uuid not null references leads(id) on delete cascade,
  motivation_score numeric check (motivation_score between 0 and 100),
  motivation_tier text check (motivation_tier in (
    'FIRE', 'HOT', 'WARM', 'NURTURE', 'LOW', 'INSUFFICIENT_DATA'
  )),
  property_distress_score numeric,
  owner_motivation_score numeric,
  financial_distress_score numeric,
  seller_intent_score numeric,
  urgency_score numeric,
  transaction_feasibility_score numeric,
  contactability_score numeric,
  data_confidence numeric,
  data_completeness numeric,
  primary_signals jsonb,
  secondary_signals jsonb,
  negative_signals jsonb,
  signal_stacks jsonb,
  conflicting_signals jsonb,
  expired_signals jsonb,
  missing_information jsonb,
  recommended_data_pulls jsonb,
  recommended_priority text,
  recommended_next_action text,
  human_review_required boolean not null default false,
  human_review_reason jsonb,
  score_explanation text,
  scoring_version text not null,
  agent_version text not null,
  scored_at timestamptz not null default now()
);

create index if not exists idx_lead_scores_property_id on lead_scores(property_id);
create index if not exists idx_lead_scores_scored_at on lead_scores(scored_at);

comment on table lead_scores is
  'One row per score computation. Never overwritten — full history preserved for auditing and backtesting.';

create table if not exists agent_versions (
  agent_id text not null,
  version text not null,
  prompt_version text,
  scoring_model_version text,
  signal_registry_version text,
  weights_version text,
  deployed_at timestamptz,
  approved_by text,
  performance_metrics jsonb,
  status text not null check (status in (
    'DRAFT', 'TESTING', 'CANDIDATE', 'ACTIVE', 'RETIRED', 'ROLLED_BACK'
  )),
  created_at timestamptz not null default now(),
  primary key (agent_id, version)
);

comment on table agent_versions is
  'Version history for the Lead Scoring Agent. No production scoring change ships without a row here moving to ACTIVE status, which requires human approval.';
