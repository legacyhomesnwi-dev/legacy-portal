-- RECONSTRUCTED from live schema (original DDL predates this session, not
-- available). Verified against information_schema.columns for public.leads
-- on 2026-09-02: column order, types, nullability, and defaults all match
-- what's live in Supabase project ajjkcmxytylcrjopxade -- this is not a guess.
-- Paper-trail record only; the table already exists, so this is a no-op.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  parcel_number text,
  owner_name text not null,
  property_address text not null,
  city text,
  county text,
  source text,
  mailing_address text,
  is_absentee_owner boolean default false,
  is_out_of_state boolean default false,
  years_owned integer default 0,
  assessed_value numeric default 0,
  tax_amount_due numeric default 0,
  motivation_score integer default 0,
  motivation_reasons text,
  motivation_flags text,
  priority text default 'UNSCORED',
  stack_count integer default 0,
  lead_status text default 'New - Needs Skip Trace',
  deal_type text default 'TBD',
  scraped_date timestamptz,
  run_date text,
  record_type text default 'NEW',
  last_updated timestamptz default now(),
  score_history text,
  notes text,
  created_at timestamptz default now()
);
