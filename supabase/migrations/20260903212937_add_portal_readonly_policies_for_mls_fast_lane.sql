create policy "anon_read_properties" on public.properties for select to anon using (true);
create policy "anon_read_listings" on public.listings for select to anon using (true);
create policy "anon_read_listing_events" on public.listing_events for select to anon using (true);
create policy "anon_read_incoming_records" on public.incoming_records for select to anon using (true);

alter publication supabase_realtime add table public.properties;
alter publication supabase_realtime add table public.listings;
alter publication supabase_realtime add table public.listing_events;
alter publication supabase_realtime add table public.incoming_records;
