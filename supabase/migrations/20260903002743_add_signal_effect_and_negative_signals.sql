alter table signal_definitions
  add column if not exists signal_effect text not null default 'positive'
  check (signal_effect in ('positive', 'negative', 'suppress'));

insert into signal_definitions
  (signal_type, category, correlation_group, description, default_base_weight, default_severity, freshness_curve, stack_eligible, min_confidence_required, status, active, signal_effect)
values
('DISQ_DO_NOT_CONTACT', 'negative', null, 'Do-not-contact / opt-out / legal outreach restriction on file', 0, 4, '{"default":1.0}', true, 0.9, 'CURRENTLY_AVAILABLE', true, 'suppress'),
('DISQ_RECENT_ARMS_LENGTH_SALE', 'negative', null, 'Recent arm''s-length sale on record (not distressed)', -6, 2, '{"0-180":1.0,"181-365":0.6,"365+":0.2}', true, 0.6, 'DATA_SOURCE_NEEDED', true, 'negative'),
('DISQ_ACTIVE_MARKET_LISTING', 'negative', null, 'Active retail listing at or near market price', -5, 2, '{"default":1.0}', true, 0.6, 'FUTURE', true, 'negative'),
('DISQ_ALREADY_SOLD', 'negative', null, 'Property already sold since lead was scraped', -8, 3, '{"default":1.0}', true, 0.7, 'DATA_SOURCE_NEEDED', true, 'negative'),
('DISQ_FORECLOSURE_DISMISSED_RECENT', 'negative', 'FORECLOSURE_CHAIN', 'Foreclosure case dismissed within last 6 months', -3, 1, '{"0-180":1.0,"181+":0.3}', true, 0.6, 'FUTURE', true, 'negative');
