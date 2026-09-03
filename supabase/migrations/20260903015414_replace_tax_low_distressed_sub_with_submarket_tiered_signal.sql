update signal_definitions
set active = false,
    description = description || ' [SUPERSEDED by VAL_LOW_FOR_SUBMARKET]',
    updated_at = now()
where signal_type = 'TAX_LOW_DISTRESSED_SUB';

insert into signal_definitions
  (signal_type, category, correlation_group, description, default_base_weight, default_severity, freshness_curve, stack_eligible, min_confidence_required, status, active, signal_effect)
values
('VAL_LOW_FOR_SUBMARKET', 'tax', null,
 'Low valuation relative to submarket norm (tiered: Gary/Hammond/E.Chicago confirmed threshold; Merrillville/Portage/Highland and Valparaiso/Chesterton/Munster/Crown Point extrapolated; other cities fallback tier, lower confidence)',
 4, 2, '{"default":1.0}', true, 0.5, 'PARTIALLY_AVAILABLE', true, 'positive');
