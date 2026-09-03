-- Read-only access for the portal's anon key, scoped to exactly what the
-- Lead Manager page needs: leads and lead_scores, SELECT only. Everything
-- else (signal_definitions, signals, agent_versions, deal_analyses) stays
-- fully locked -- no portal page reads those yet.
--
-- Also enables real-time on both tables so the portal can subscribe to
-- live inserts/updates instead of only fetching on page load.

create policy "anon_read_leads"
  on public.leads for select
  to anon
  using (true);

create policy "anon_read_lead_scores"
  on public.lead_scores for select
  to anon
  using (true);

alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.lead_scores;
