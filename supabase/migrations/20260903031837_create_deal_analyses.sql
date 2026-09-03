-- Audit-trail table for underwriting engine output.
-- Mirrors the lead_scores pattern: one row per computation, never overwritten.
--
-- Applied to project ajjkcmxytylcrjopxade on 2026-09-03 via the Supabase MCP
-- (migration version 20260903031837). This file is the repo record of that
-- change; it reflects the actual current schema pulled from the database.
create table public.deal_analyses (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.leads(id),
  arv numeric not null,
  rehab numeric not null,
  asking_price numeric not null,
  city text not null,
  is_mls boolean not null default false,
  monthly_rent numeric,
  deal_status text not null check (deal_status in ('strong', 'flex', 'nogo')),
  recommended_strategy text not null,
  offer_ladder jsonb not null,        -- mao, flexMAO, flexCeiling, lao, tier2, opening, tier4
  flip_result jsonb not null,
  wholesale_result jsonb not null,
  brrrr_result jsonb,
  engine_version text not null,
  analyzed_at timestamptz not null default now()
);

comment on table public.deal_analyses is
  'One row per underwriting computation from underwritingEngine.js. Never overwritten — full history preserved for auditing and backtesting. engine_version is the traceability handle (the engine is a deterministic calculator, not a versioned agent).';

create index deal_analyses_property_id_idx on public.deal_analyses (property_id);
create index deal_analyses_analyzed_at_idx on public.deal_analyses (analyzed_at desc);
