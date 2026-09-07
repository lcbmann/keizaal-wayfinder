-- Access-path audit: these tables are used by Wayfinder's service-role client.
-- Atlas app/field-atlas code does not access them. The only public function
-- referencing them is the invoker trigger enforce_supply_contribution_quota.
-- No Atlas table, policy, or browser RPC is changed here.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'alliance_headquarters','alliance_headquarters_deliveries','alliance_headquarters_publications',
    'alliance_headquarters_topic_channels','alliance_intel_publications','alliance_intel_settings',
    'alliance_report_topic_publications','alliance_reports','alliance_topic_mirrors',
    'apprenticeship_preferences','apprenticeships','corps_duties','duty_applications',
    'ranger_duty_assignments','supply_assignment_items','supply_assignments','supply_contributions'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role',table_name);
  end loop;
end;
$$;
