-- The selected role may be new rather than the original Warden role. Preserve
-- every Range in that consolidation path too, and retire its Hold appointments.
do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.configure_application_form(uuid,text,text,text,jsonb)'::regprocedure);
  definition := replace(definition, 'max(ended.assignment_detail)',
    'string_agg(distinct ended.assignment_detail, '', '' order by ended.assignment_detail)');
  definition := replace(definition,
    $old$    if source_duty.id is not null and source_duty.id <> target_duty.id then
      -- Close old appointments$old$,
    $new$    if source_duty.id is not null and source_duty.id <> target_duty.id then
      if source_duty.assignment_mode = 'warden' then
        clear_holds := true;
        update rangers set assigned_hold = null, updated_at = now() where id in (
          select ranger_id from ranger_duty_assignments where duty_id = source_duty.id
            and status = 'Active' and warden_scope = 'hold_primary');
      end if;
      -- Close old appointments$new$);
  execute definition;
end;
$migration$;
