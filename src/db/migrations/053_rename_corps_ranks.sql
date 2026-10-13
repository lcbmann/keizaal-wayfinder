-- Deploy together with the rank-name update. Keep existing enum identities,
-- role IDs, rank ordering, grants, and history intact.
do $migration$
declare
  names record;
  routine record;
  definition text;
begin
  for names in select * from (values
    ('Ranger Commander', 'First Captain'),
    ('Ranger Captain', 'Captain'),
    ('Ranger Marshal', 'Marshal')
  ) as mapping(old_name, new_name)
  loop
    if exists (
      select 1 from pg_enum
      where enumtypid = 'public.ranger_rank'::regtype and enumlabel = names.old_name
    ) then
      execute format('alter type public.ranger_rank rename value %L to %L', names.old_name, names.new_name);
    end if;
  end loop;

  -- Function bodies are stored as source text, unlike enum-valued columns and
  -- parsed constraints. Replacing in place preserves ownership and permissions.
  for routine in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prosrc ~ 'Ranger (Commander|Captain|Marshal)'
  loop
    definition := pg_get_functiondef(routine.oid);
    definition := replace(replace(replace(definition,
      'Ranger Commander', 'First Captain'), 'Ranger Captain', 'Captain'), 'Ranger Marshal', 'Marshal');
    execute definition;
  end loop;
end;
$migration$;

-- Only translate exact structured values, not names, notes, or free-form prose.
create or replace function pg_temp.rename_corps_rank_json(value jsonb)
returns jsonb language plpgsql as $function$
declare
  result jsonb;
begin
  case jsonb_typeof(value)
    when 'string' then
      return to_jsonb(case value #>> '{}'
        when 'Ranger Commander' then 'First Captain'
        when 'Ranger Captain' then 'Captain'
        when 'Ranger Marshal' then 'Marshal'
        when 'ranger-commander' then 'first-captain'
        when 'ranger-captain' then 'captain'
        when 'ranger-marshal' then 'marshal'
        else value #>> '{}' end);
    when 'array' then
      select coalesce(jsonb_agg(pg_temp.rename_corps_rank_json(element) order by ordinal), '[]'::jsonb)
        into result from jsonb_array_elements(value) with ordinality as elements(element, ordinal);
      return result;
    when 'object' then
      select coalesce(jsonb_object_agg(key, pg_temp.rename_corps_rank_json(element)), '{}'::jsonb)
        into result from jsonb_each(value) as elements(key, element);
      return result;
    else return value;
  end case;
end;
$function$;

do $profiles$
declare
  column_record record;
begin
  for column_record in
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
      and table_name in ('atlas_ranger_accounts', 'atlas_ranger_directory',
        'atlas_discord_device_links', 'atlas_discord_link_codes')
      and column_name in ('discord_profile', 'roles') and udt_name = 'jsonb'
  loop
    execute format('update public.%I set %I = pg_temp.rename_corps_rank_json(%I)
      where %I::text ~ %L', column_record.table_name, column_record.column_name,
      column_record.column_name, column_record.column_name,
      'Ranger (Commander|Captain|Marshal)|ranger-(commander|captain|marshal)');
  end loop;
end;
$profiles$;

drop function pg_temp.rename_corps_rank_json(jsonb);
notify pgrst, 'reload schema';
