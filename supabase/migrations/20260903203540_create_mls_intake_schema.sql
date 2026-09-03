-- ============================================================
-- MLS Intake + Property Enrichment schema (Step 3)
-- Reuses leads table for enrichment source (no separate provenance
-- table -- field-level lineage folded into properties.field_sources jsonb
-- to avoid overbuilding per directive).
-- ============================================================

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  parcel_number text,
  normalized_address text not null,
  street_address text not null,
  city text,
  state text default 'IN',
  zip text,
  county text,
  property_type text,
  beds integer,
  baths numeric,
  sqft integer,
  lot_size numeric,
  year_built integer,
  garage text,
  basement text,
  owner_name text,
  field_sources jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_properties_normalized_address on public.properties(normalized_address);
create index if not exists idx_properties_parcel_number on public.properties(parcel_number);

comment on table public.properties is
  'Canonical property entity, decoupled from listings and leads. field_sources tracks per-field provenance (MLS_PROVIDED / ASSESSOR_PROVIDED / MANUAL / INFERRED / UNKNOWN) so we always know where a value came from.';

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  mls_number text not null,
  source text not null default 'FLEXMLS',
  saved_search_name text,
  status text,
  current_list_price numeric,
  original_list_price numeric,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_update_type text,
  flexmls_url text,
  source_email_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mls_number, source)
);
create index if not exists idx_listings_property_id on public.listings(property_id);
create index if not exists idx_listings_mls_number on public.listings(mls_number);

comment on table public.listings is
  'One row per MLS listing (by mls_number + source), updated in place as new emails arrive. Price/status history lives in listing_events, not by overwriting this row silently.';

create table if not exists public.listing_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  event_type text not null check (event_type in (
    'NEW_LISTING', 'PRICE_CHANGE', 'BACK_ON_MARKET', 'STATUS_CHANGE', 'LISTING_UPDATE'
  )),
  old_value jsonb,
  new_value jsonb,
  received_at timestamptz not null,
  source_email_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_listing_events_listing_id on public.listing_events(listing_id);

comment on table public.listing_events is
  'Append-only history of every listing update. Never overwritten -- this is what lets us detect and react to price changes (e.g. re-trigger analysis).';

create table if not exists public.incoming_records (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'MLS_EMAIL',
  source_provider text not null default 'FLEXMLS',
  external_record_id text not null,
  received_at timestamptz not null,
  raw_subject text,
  saved_search_name text,
  raw_address text,
  raw_price numeric,
  raw_mls_number text,
  raw_status text,
  raw_update_type text,
  raw_link text,
  processing_status text not null default 'RECEIVED' check (processing_status in (
    'RECEIVED', 'PARSED', 'MATCHING', 'MATCHED', 'PROPERTY_CREATED',
    'ENRICHING', 'ENRICHED', 'NEEDS_ENRICHMENT', 'NEEDS_REVIEW',
    'ANALYSIS_READY', 'ANALYSIS_QUEUED', 'ERROR', 'RETRY', 'COMPLETE'
  )),
  match_result text check (match_result in ('MATCHED', 'CREATED', 'AMBIGUOUS', 'NEEDS_REVIEW')),
  match_confidence text check (match_confidence in ('HIGH', 'MEDIUM', 'LOW')),
  matched_property_id uuid references public.properties(id),
  matched_listing_id uuid references public.listings(id),
  missing_fields jsonb,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source_provider, external_record_id)
);
create index if not exists idx_incoming_records_status on public.incoming_records(processing_status);
create index if not exists idx_incoming_records_mls_number on public.incoming_records(raw_mls_number);

comment on table public.incoming_records is
  'Front door for every external record before matching/promotion. UNIQUE(source_provider, external_record_id) enforces idempotency at the DB level.';
