alter table public.deal_analyses
  add column if not exists property_address text,
  add column if not exists allow_flex boolean not null default false;

comment on column public.deal_analyses.allow_flex is
  'Whether the 80% ARV flex tier was manually enabled for this analysis. Default false — deals never auto-extend past 75% ARV MAO unless explicitly overridden.';
