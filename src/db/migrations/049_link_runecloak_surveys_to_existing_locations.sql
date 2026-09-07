-- A row remains the applicant's original survey. Linked surveys share their
-- location's Forum thread, but have their own message and Atlas reference.
alter table public.runecloak_research_sites
  add column if not exists existing_site_id uuid references public.runecloak_research_sites(id) on delete restrict;
create index if not exists runecloak_research_sites_existing_site_idx
  on public.runecloak_research_sites(existing_site_id);
alter table public.runecloak_research_sites
  add constraint runecloak_survey_not_own_location check (existing_site_id is distinct from id);

create or replace function public.accept_runecloak_survey(
  guild_id_input text,
  application_id_input uuid,
  actor_discord_user_id_input text,
  existing_site_id_input uuid default null
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  application runecloak_applications%rowtype;
  survey runecloak_research_sites%rowtype;
  destination runecloak_research_sites%rowtype;
  review_channel text;
begin
  select application_review_channel_id into review_channel from runecloak_settings where guild_id = guild_id_input;
  select * into application from runecloak_applications where id = application_id_input for update;
  if not found or review_channel is null or application.review_channel_id is distinct from review_channel then
    raise exception 'Choose an application in this server.';
  end if;
  select * into survey from runecloak_research_sites where application_id = application.id for update;
  if not found then raise exception 'The applicant must submit a survey first.'; end if;
  if application.status = 'Approved' then
    if survey.existing_site_id is distinct from existing_site_id_input then
      raise exception 'This survey was already accepted into another location. Refresh the review.';
    end if;
    return jsonb_build_object('already_approved', true);
  end if;
  if application.status <> 'Survey Submitted' or survey.status not in ('Proposed', 'Approved') then
    raise exception 'Only a submitted survey can be accepted.';
  end if;
  if existing_site_id_input is not null then
    if existing_site_id_input = survey.id then raise exception 'Choose a different existing location.'; end if;
    select * into destination from runecloak_research_sites where id = existing_site_id_input for update;
    if not found or destination.status <> 'Approved' or destination.existing_site_id is not null then
      raise exception 'Choose an approved research location, not an additional survey.';
    end if;
    if not exists (select 1 from runecloak_applications a where a.id = destination.application_id
      and a.review_channel_id = review_channel and a.status = 'Approved') then
      raise exception 'Choose an approved location in this server.';
    end if;
    if survey.forum_thread_id is not null then
      raise exception 'This survey already has a location post. Accept it as a new location.';
    end if;
  end if;
  update runecloak_research_sites set
    status = 'Approved', existing_site_id = existing_site_id_input,
    reviewed_by_discord_user_id = actor_discord_user_id_input, reviewed_at = now()
  where id = survey.id;
  perform approve_runecloak_admission(guild_id_input, application.id, actor_discord_user_id_input);
  insert into runecloak_audit_events (guild_id, entity_type, entity_id, action, actor_discord_user_id, before_snapshot, after_snapshot)
  values (guild_id_input, 'research_site', survey.id, 'survey_location_accepted', actor_discord_user_id_input,
    jsonb_build_object('status', survey.status),
    jsonb_build_object('existing_site_id', existing_site_id_input, 'atlas_reference', survey.atlas_reference));
  return jsonb_build_object('already_approved', false);
end;
$$;
revoke execute on function public.accept_runecloak_survey(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.accept_runecloak_survey(text, uuid, text, uuid) to service_role;
