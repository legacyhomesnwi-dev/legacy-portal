-- RECONSTRUCTED from live schema (original DDL predates this session, not
-- available). Verified against information_schema.columns for public.leads
-- on 2026-09-02. Column order and types match exactly what's live in
-- Supabase project ajjkcmxytylcrjopxade -- this is not a guess.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  parcel_number text,
  owner_name text not null,
  property_address text not null,
  city text,
  county text,
  source text,
  mailing_address text,
  is_absentee_owner boolean,
  is_out_of_state boolean,
  years_owned integer,
  assessed_value numeric,
  tax_amount_due numeric,
  motivation_score integer,
  motivation_reasons text,
  motivation_flags text,
  priority text,
  stack_count integer,
  lead_status text,
  deal_type text,
  scraped_date timestamptz,
  run_date text,
  record_type text,
  last_updated timestamptz,
  score_history text,
  notes text,
  created_at timestamptz default now()
);
