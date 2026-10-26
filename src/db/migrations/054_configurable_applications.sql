alter table public.corps_duties
  add column display_name text,
  add column minimum_rank public.ranger_rank not null default 'Ranger',
  add column assignment_mode text not null default 'general' check (assignment_mode in ('general', 'warden'));
update public.corps_duties set minimum_rank = 'Apprentice' where name in ('Craftsman', 'Courier');
update public.corps_duties set assignment_mode = 'warden' where name = 'Warden';

create table public.application_form_configs (
  key text primary key check (length(key) between 1 and 32),
  duty_id uuid references public.corps_duties(id),
  enabled boolean not null default true,
  minimum_rank public.ranger_rank not null,
  description text not null default '',
  questions jsonb check (questions is null or (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 5)),
  retired_role_ids text[] not null default '{}',
  clear_hold_roles boolean not null default false,
  revision uuid not null default gen_random_uuid(),
  updated_by_discord_user_id text not null,
  updated_at timestamptz not null default now()
);
create unique index application_form_configs_name_ci on public.application_form_configs(lower(key));
create table public.application_configuration_drafts (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  actor_discord_user_id text not null,
  payload jsonb not null,
  expires_at timestamptz not null default (now() + interval '15 minutes')
);
alter table public.application_form_configs enable row level security;
alter table public.application_configuration_drafts enable row level security;
revoke all on public.application_form_configs, public.application_configuration_drafts from public, anon, authenticated;
grant all on public.application_form_configs, public.application_configuration_drafts to service_role;

create function public.configure_application_form(
  draft_id_input uuid, guild_id_input text, actor_input text,
  description_input text, questions_input jsonb
) returns jsonb language plpgsql security invoker set search_path = public as $function$
declare
  draft application_configuration_drafts%rowtype;
  previous application_form_configs%rowtype;
  target_duty corps_duties%rowtype;
  source_duty corps_duties%rowtype;
  key_input text;
  role_input text;
  minimum_input ranger_rank;
  replaced text[];
  source_name text;
  old_roles text[] := '{}';
  affected_members jsonb;
  saved application_form_configs%rowtype;
  clear_holds boolean := false;
begin
  select * into draft from application_configuration_drafts
    where id = draft_id_input and guild_id = guild_id_input and actor_discord_user_id = actor_input
      and expires_at > now() for update;
  if not found then raise exception 'This configuration form expired. Run /application configure again.'; end if;
  key_input := draft.payload->>'key';
  role_input := draft.payload->>'role_id';
  minimum_input := (draft.payload->>'minimum_rank')::ranger_rank;
  select coalesce(array_agg(value), '{}') into replaced from jsonb_array_elements_text(draft.payload->'replaces');
  if questions_input is not null and (jsonb_typeof(questions_input) <> 'array'
      or jsonb_array_length(questions_input) not between 1 and 5) then
    raise exception 'Supply between one and five application questions.';
  end if;
  if questions_input is not null and exists (select 1 from jsonb_array_elements(questions_input) q
      where jsonb_typeof(q) <> 'string' or length(btrim(q #>> '{}')) not between 1 and 45) then
    raise exception 'Each question must contain 1 to 45 characters.';
  end if;
  if length(description_input) > 1000 then raise exception 'The description is too long.'; end if;
  select * into previous from application_form_configs where key = key_input for update;
  if previous.revision::text is distinct from draft.payload->>'expected_revision' then
    raise exception 'Someone changed this application while you were editing. Open the configuration again.';
  end if;
  old_roles := coalesce(previous.retired_role_ids, '{}');
  clear_holds := coalesce(previous.clear_hold_roles, false);
  if key_input in ('Marshal', 'Captain') then
    if role_input is not null or cardinality(replaced) > 0 then
      raise exception 'Leadership application routing and promotion votes cannot be replaced with a duty role.';
    end if;
    minimum_input := case when key_input = 'Captain' then 'Marshal'::ranger_rank else 'Ranger'::ranger_rank end;
  else
    select * into target_duty from corps_duties
      where id = (draft.payload->>'duty_id')::uuid for update;
    if not found and role_input is not null then
      select * into target_duty from corps_duties where discord_role_id = role_input and active for update;
    end if;
    if target_duty.id is null then
      if role_input is null then raise exception 'Select a Discord role for this duty.'; end if;
      insert into corps_duties (slug, name, display_name, description, discord_role_id,
        max_active_holders, requires_detail, active, minimum_rank, assignment_mode)
      values (draft.payload->>'slug', key_input, key_input, description_input, role_input,
        null, false, true, minimum_input, 'general') returning * into target_duty;
    else
      if draft.payload->>'builtin_target' is null and target_duty.assignment_mode = 'warden' then
        clear_holds := true;
        -- Keep every old Range appointment as history, then create one Guide
        -- appointment per member, carrying forward their areas of knowledge.
        with ended as (
          update ranger_duty_assignments set status = 'Ended', ended_at = now(),
            end_reason = 'Consolidated into ' || key_input || ' by ' || actor_input
          where duty_id = target_duty.id and status = 'Active' returning *
        )
        insert into ranger_duty_assignments (duty_id, ranger_id, assigned_by_discord_user_id,
          status, assignment_detail, started_at)
        select target_duty.id, ranger.id, actor_input, 'Active',
          string_agg(distinct ended.assignment_detail, ', ' order by ended.assignment_detail), min(ended.started_at)
        from ended join rangers ranger on ranger.id = ended.ranger_id
        where ranger.status in ('Active', 'On Leave') group by ranger.id;
        update rangers set assigned_hold = null, updated_at = now() where id in (
          select ranger_id from ranger_duty_assignments where duty_id = target_duty.id
            and status = 'Ended' and ended_at = now() and warden_scope = 'hold_primary');
      end if;
      if role_input is distinct from target_duty.discord_role_id then
        if exists (select 1 from corps_duties where discord_role_id = role_input and id <> target_duty.id and active) then
          raise exception 'That Discord role already belongs to another duty.';
        end if;
        old_roles := array_append(old_roles, target_duty.discord_role_id);
      end if;
      update corps_duties set
        display_name = case when draft.payload->>'builtin_target' is null then key_input else display_name end,
        description = description_input, discord_role_id = coalesce(role_input, discord_role_id),
        minimum_rank = minimum_input,
        assignment_mode = case when draft.payload->>'builtin_target' is null then 'general' else assignment_mode end,
        requires_detail = case when draft.payload->>'builtin_target' is null then false else requires_detail end,
        active = true, updated_at = now()
      where id = target_duty.id returning * into target_duty;
    end if;
  end if;
  foreach source_name in array replaced loop
    if source_name in ('Marshal', 'Captain', 'First Captain') then raise exception 'Leadership positions cannot be merged into duties.'; end if;
    select * into source_duty from corps_duties where name = source_name for update;
    if source_duty.id is not null and source_duty.id <> target_duty.id then
      -- Close old appointments but keep their original duty, dates and details.
      with ended as (
        update ranger_duty_assignments set status = 'Ended', ended_at = now(),
          end_reason = 'Consolidated into ' || key_input || ' by ' || actor_input
        where duty_id = source_duty.id and status = 'Active' returning *
      )
      insert into ranger_duty_assignments (duty_id, ranger_id, assigned_by_discord_user_id,
        status, assignment_detail, started_at)
      select target_duty.id, ranger.id, actor_input, 'Active', max(ended.assignment_detail), min(ended.started_at)
      from ended join rangers ranger on ranger.id = ended.ranger_id
      where ranger.status in ('Active', 'On Leave') and not exists (
        select 1 from ranger_duty_assignments current_assignment
        where current_assignment.duty_id = target_duty.id and current_assignment.ranger_id = ranger.id
          and current_assignment.status = 'Active')
      group by ranger.id on conflict do nothing;
      update duty_applications source set status = 'Withdrawn', reviewed_at = now(),
        reviewed_by_discord_user_id = actor_input
      where source.duty_id = source_duty.id and source.status = 'Pending' and exists (
        select 1 from duty_applications target where target.duty_id = target_duty.id
          and target.applicant_ranger_id = source.applicant_ranger_id and target.status = 'Pending');
      update duty_applications set duty_id = target_duty.id, warden_scope = null, parent_hold = null
        where duty_id = source_duty.id and status = 'Pending';
      update corps_duties set active = false, updated_at = now() where id = source_duty.id;
      old_roles := array_append(old_roles, source_duty.discord_role_id);
    end if;
    if source_name = 'Warden' then
      insert into application_form_configs (key, enabled, minimum_rank, updated_by_discord_user_id)
      values ('Hold Warden', false, 'Ranger', actor_input), ('Local Warden', false, 'Ranger', actor_input)
      on conflict (key) do update set enabled = false, revision = gen_random_uuid(), updated_at = now(), updated_by_discord_user_id = actor_input;
    else
      update application_form_configs set enabled = false, revision = gen_random_uuid(), updated_at = now(), updated_by_discord_user_id = actor_input
        where key = source_name;
      if not found then
        insert into application_form_configs (key, enabled, minimum_rank, updated_by_discord_user_id)
          values (source_name, false, 'Ranger', actor_input);
      end if;
    end if;
  end loop;
  insert into application_form_configs (key, duty_id, enabled, minimum_rank, description, questions, retired_role_ids, clear_hold_roles, updated_by_discord_user_id)
    values (key_input, target_duty.id, true, minimum_input, description_input, questions_input, old_roles, clear_holds, actor_input)
    on conflict (key) do update set duty_id = excluded.duty_id, enabled = true,
      minimum_rank = excluded.minimum_rank, description = excluded.description, questions = excluded.questions,
      retired_role_ids = excluded.retired_role_ids, clear_hold_roles = excluded.clear_hold_roles,
      revision = gen_random_uuid(), updated_by_discord_user_id = actor_input, updated_at = now()
    returning * into saved;
  select coalesce(jsonb_agg(distinct ranger.discord_user_id), '[]') into affected_members
    from ranger_duty_assignments assignment join rangers ranger on ranger.id = assignment.ranger_id
    where assignment.duty_id = target_duty.id and assignment.status = 'Active' and ranger.status in ('Active', 'On Leave');
  delete from application_configuration_drafts where id = draft.id;
  return jsonb_build_object('position', to_jsonb(saved), 'member_ids', affected_members,
    'role_id', target_duty.discord_role_id, 'old_role_ids', to_jsonb(old_roles), 'clear_hold_roles', clear_holds);
end;
$function$;
revoke all on function public.configure_application_form(uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.configure_application_form(uuid,text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
