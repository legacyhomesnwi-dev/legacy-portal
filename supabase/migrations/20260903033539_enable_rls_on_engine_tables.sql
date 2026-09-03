-- Locks down all 5 engine tables. No policies added for anon/authenticated ->
-- default deny for those roles. service_role bypasses RLS automatically in
-- Postgres/Supabase (has BYPASSRLS), so backend scripts and n8n workflows
-- keep working IF they use the service role key instead of the anon key.
--
-- This intentionally does NOT add authenticated-user read policies yet --
-- the portal has no real auth/login built. Add those once Supabase Auth
-- and role-based access actually ship (per the 10-stage portal build order).
--
-- Applied directly against project ajjkcmxytylcrjopxade on 2026-09-03
-- (migration version 20260903033539). This file is the repo record of that
-- change so the paper trail is complete, not just the changes made through
-- the local Claude session.

alter table public.signal_definitions enable row level security;
alter table public.signals            enable row level security;
alter table public.lead_scores        enable row level security;
alter table public.agent_versions     enable row level security;
alter table public.deal_analyses      enable row level security;
