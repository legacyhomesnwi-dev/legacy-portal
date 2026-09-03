create policy "anon_read_deal_analyses"
  on public.deal_analyses for select
  to anon
  using (true);

alter publication supabase_realtime add table public.deal_analyses;
