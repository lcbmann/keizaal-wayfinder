create table if not exists corps_qualifications (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text unique not null,
  description text not null,
  emoji text,
  discord_role_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runecloak_settings (
  guild_id text primary key,
  category_id text not null,
  information_channel_id text not null,
  discussion_channel_id text not null,
  expedition_forum_id text not null,
  dashboard_message_id text,
  organizer_role_id text,
  learner_role_id text,
  qualification_role_id text not null,
  program_state text not null default 'Organizing' check (
    program_state in ('Organizing', 'Admissions Open', 'Registration Pending', 'Registered', 'Paused')
  ),
  registration_reference text,
  registration_confirmed_by_discord_user_id text,
  registration_confirmed_at timestamptz,
  minimum_roster_size integer not null default 20 check (minimum_roster_size > 0),
  quorum_percent integer not null default 51 check (quorum_percent between 1 and 100),
  point_target integer not null default 8000 check (point_target > 0),
  configured_by_discord_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runecloak_team_assignments (
  id uuid primary key default gen_random_uuid(),
  ranger_id uuid not null references rangers(id) on delete cascade,
  assignment_kind text not null check (assignment_kind in ('organizer', 'authorized_marshal')),
  active boolean not null default true,
  assigned_by_discord_user_id text not null,
  assigned_at timestamptz not null default now(),
  ended_by_discord_user_id text,
  ended_at timestamptz,
  end_reason text
);

create table if not exists runecloak_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_ranger_id uuid not null references rangers(id) on delete cascade,
  rank_snapshot ranger_rank not null,
  status text not null default 'Submitted' check (
    status in ('Submitted', 'Survey Requested', 'Survey Submitted', 'Revision Requested', 'Approved', 'Denied', 'Withdrawn')
  ),
  reason text not null,
  experience text,
  availability text not null,
  loyalties_conflicts text,
  review_note text,
  reviewed_by_discord_user_id text,
  reviewed_at timestamptz,
  strongbox_channel_id text,
  strongbox_message_id text,
  strongbox_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runecloak_research_sites (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references runecloak_applications(id) on delete cascade,
  ranger_id uuid not null references rangers(id) on delete cascade,
  name text not null,
  hold_region text not null,
  atlas_reference text not null,
  report_url text not null,
  structured_report_id uuid references structured_trailmark_reports(id) on delete set null,
  resonance_description text not null,
  screenshot_url text,
  status text not null default 'Proposed' check (
    status in ('Draft', 'Proposed', 'Revision Requested', 'Approved', 'Rejected', 'Retired')
  ),
  review_note text,
  reviewed_by_discord_user_id text,
  reviewed_at timestamptz,
  forum_thread_id text,
  forum_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runecloak_spells (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text unique not null,
  sequence integer unique not null,
  prerequisite_spell_id uuid references runecloak_spells(id) on delete restrict,
  study_summary text not null,
  default_target_points integer not null default 8000 check (default_target_points > 0),
  active boolean not null default true,
  external_approval_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runecloak_cycles (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  spell_id uuid not null references runecloak_spells(id) on delete restrict,
  label text not null,
  sequence integer not null,
  status text not null default 'Draft' check (
    status in ('Draft', 'Locked', 'Awaiting Moonshadow Start', 'Active', 'Awaiting Moonshadow Grant', 'Completed', 'Cancelled')
  ),
  minimum_roster_size integer not null check (minimum_roster_size > 0),
  quorum_percent integer not null check (quorum_percent between 1 and 100),
  point_target integer not null check (point_target > 0),
  locked_roster_count integer,
  required_stage_attendance integer,
  roster_hash text,
  locked_by_discord_user_id text,
  locked_at timestamptz,
  start_reference text,
  started_by_discord_user_id text,
  started_at timestamptz,
  grant_reference text,
  grant_confirmed_by_discord_user_id text,
  grant_confirmed_at timestamptz,
  verified_points integer not null default 0,
  created_by_discord_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (guild_id, sequence)
);

create table if not exists runecloak_cycle_members (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references runecloak_cycles(id) on delete cascade,
  ranger_id uuid not null references rangers(id) on delete restrict,
  application_id uuid not null references runecloak_applications(id) on delete restrict,
  rank_snapshot ranger_rank,
  status_snapshot ranger_status,
  participation_status text not null default 'Selected' check (
    participation_status in ('Selected', 'Active', 'Withdrawn', 'Ineligible', 'Completed', 'Study Incomplete')
  ),
  selected_by_discord_user_id text not null,
  selected_at timestamptz not null default now(),
  status_reason text,
  status_changed_by_discord_user_id text,
  status_changed_at timestamptz,
  final_valid_stages_attended integer,
  final_required_attendance integer,
  prior_attendance_credits integer not null default 0,
  cycle_attendance_credits integer not null default 0,
  retained_attendance_credits integer not null default 0,
  final_contributed_points integer not null default 0,
  final_result text,
  spell_confirmed_at timestamptz,
  unique (cycle_id, ranger_id)
);

create table if not exists runecloak_spell_progress (
  ranger_id uuid not null references rangers(id) on delete cascade,
  spell_id uuid not null references runecloak_spells(id) on delete restrict,
  required_attendance_credits integer not null check (required_attendance_credits > 0),
  verified_attendance_credits integer not null default 0 check (verified_attendance_credits >= 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  completion_cycle_id uuid references runecloak_cycles(id) on delete set null,
  confirmed_by_discord_user_id text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ranger_id, spell_id)
);

create table if not exists runecloak_stages (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references runecloak_cycles(id) on delete cascade,
  sequence integer not null,
  cooldown_label text not null,
  cooldown_starts_at timestamptz,
  cooldown_ends_at timestamptz,
  title text not null,
  theme text not null,
  notes text,
  status text not null default 'Draft' check (status in ('Draft', 'Open', 'Ready for Review', 'Valid', 'Invalid')),
  required_unique_attendance integer not null,
  actual_unique_attendance integer not null default 0,
  verified_points integer not null default 0,
  validated_by_discord_user_id text,
  validated_at timestamptz,
  validation_reason text,
  forum_thread_id text,
  forum_message_id text,
  created_by_discord_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, sequence),
  unique (cycle_id, cooldown_label)
);

create table if not exists runecloak_sessions (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references runecloak_stages(id) on delete cascade,
  regional_slot text not null check (regional_slot in ('EU', 'NA')),
  planned_at timestamptz,
  actual_at timestamptz,
  research_site_id uuid references runecloak_research_sites(id) on delete set null,
  leader_discord_user_id text,
  lesson_summary text,
  study_method text,
  recording_url text,
  moonshadow_reference text,
  status text not null default 'Planned' check (status in ('Planned', 'Submitted', 'Verified', 'Cancelled')),
  logged_by_discord_user_id text,
  verified_by_discord_user_id text,
  verification_basis text check (verification_basis is null or verification_basis in ('present', 'recording_review')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_id, regional_slot),
  unique (id, stage_id)
);

create table if not exists runecloak_session_participation (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references runecloak_stages(id) on delete cascade,
  session_id uuid not null,
  ranger_id uuid not null references rangers(id) on delete restrict,
  participation_kind text not null default 'learner' check (participation_kind in ('learner', 'support', 'observer')),
  status text not null default 'provisional' check (status in ('provisional', 'verified', 'rejected')),
  roll_value integer check (roll_value is null or roll_value between 1 and 100),
  evidence_url text,
  submitted_by_discord_user_id text not null,
  submitted_at timestamptz not null default now(),
  verified_by_discord_user_id text,
  verified_at timestamptz,
  correction_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, ranger_id),
  foreign key (session_id, stage_id) references runecloak_sessions(id, stage_id) on delete cascade
);

create table if not exists ranger_qualifications (
  id uuid primary key default gen_random_uuid(),
  qualification_id uuid not null references corps_qualifications(id) on delete restrict,
  ranger_id uuid not null references rangers(id) on delete cascade,
  source_cycle_id uuid references runecloak_cycles(id) on delete set null,
  awarded_by_discord_user_id text not null,
  awarded_at timestamptz not null default now(),
  revoked_by_discord_user_id text,
  revoked_at timestamptz,
  revocation_reason text
);

create table if not exists runecloak_audit_events (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_discord_user_id text not null,
  reason text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  source_url text,
  created_at timestamptz not null default now()
);

insert into corps_qualifications (slug, name, description, emoji, discord_role_id)
values (
  'ranger-runecloak',
  'Ranger Runecloak',
  'A Ranger qualified through verified field research and a Moonshadow-confirmed Runecloak study cycle.',
  ':runecloak:',
  '1543999251820839073'
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    emoji = excluded.emoji,
    discord_role_id = excluded.discord_role_id,
    active = true,
    updated_at = now();

insert into runecloak_spells (slug, name, sequence, study_summary, default_target_points, external_approval_note)
values (
  'oakflesh',
  'Oakflesh',
  1,
  'Natural resilience, bark, root, stone, living structure, field movement, and temporary runic focuses.',
  8000,
  'Moonshadow registration and final grant confirmation are required.'
)
on conflict (slug) do update
set study_summary = excluded.study_summary,
    default_target_points = excluded.default_target_points,
    external_approval_note = excluded.external_approval_note,
    active = true,
    updated_at = now();

insert into runecloak_spells (slug, name, sequence, prerequisite_spell_id, study_summary, default_target_points, external_approval_note)
select
  'lesser-ward',
  'Lesser Ward',
  2,
  oakflesh.id,
  'Limited field defense against hostile magic after completion of Oakflesh.',
  8000,
  'Moonshadow registration and final grant confirmation are required.'
from runecloak_spells oakflesh
where oakflesh.slug = 'oakflesh'
on conflict (slug) do update
set prerequisite_spell_id = excluded.prerequisite_spell_id,
    study_summary = excluded.study_summary,
    default_target_points = excluded.default_target_points,
    external_approval_note = excluded.external_approval_note,
    active = true,
    updated_at = now();

create unique index if not exists runecloak_team_one_active_assignment
on runecloak_team_assignments(ranger_id, assignment_kind)
where active = true;

create unique index if not exists runecloak_one_open_application
on runecloak_applications(applicant_ranger_id)
where status in ('Submitted', 'Survey Requested', 'Survey Submitted', 'Revision Requested', 'Approved');

create unique index if not exists runecloak_one_current_site_per_application
on runecloak_research_sites(application_id)
where status <> 'Retired';

create unique index if not exists runecloak_one_official_cycle
on runecloak_cycles(guild_id)
where status in ('Locked', 'Awaiting Moonshadow Start', 'Active', 'Awaiting Moonshadow Grant');

create unique index if not exists runecloak_one_roll_per_stage
on runecloak_session_participation(stage_id, ranger_id)
where roll_value is not null and status <> 'rejected';

create unique index if not exists ranger_one_active_qualification
on ranger_qualifications(qualification_id, ranger_id)
where revoked_at is null;

create index if not exists runecloak_applications_status_idx
on runecloak_applications(status, created_at);

create index if not exists runecloak_sites_status_idx
on runecloak_research_sites(status, created_at);

create index if not exists runecloak_cycles_status_idx
on runecloak_cycles(guild_id, status, sequence);

create index if not exists runecloak_participation_stage_idx
on runecloak_session_participation(stage_id, status, participation_kind);

create index if not exists runecloak_audit_entity_idx
on runecloak_audit_events(entity_type, entity_id, created_at);

alter table honors_ledger_entries
drop constraint if exists honors_ledger_entries_source_type_check;

alter table honors_ledger_entries
add constraint honors_ledger_entries_source_type_check
check (source_type in ('medal_award', 'promotion', 'qualification'));

alter table corps_qualifications enable row level security;
alter table runecloak_settings enable row level security;
alter table runecloak_team_assignments enable row level security;
alter table runecloak_applications enable row level security;
alter table runecloak_research_sites enable row level security;
alter table runecloak_spells enable row level security;
alter table runecloak_cycles enable row level security;
alter table runecloak_cycle_members enable row level security;
alter table runecloak_spell_progress enable row level security;
alter table runecloak_stages enable row level security;
alter table runecloak_sessions enable row level security;
alter table runecloak_session_participation enable row level security;
alter table ranger_qualifications enable row level security;
alter table runecloak_audit_events enable row level security;

drop trigger if exists set_corps_qualifications_updated_at on corps_qualifications;
create trigger set_corps_qualifications_updated_at before update on corps_qualifications
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_settings_updated_at on runecloak_settings;
create trigger set_runecloak_settings_updated_at before update on runecloak_settings
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_applications_updated_at on runecloak_applications;
create trigger set_runecloak_applications_updated_at before update on runecloak_applications
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_research_sites_updated_at on runecloak_research_sites;
create trigger set_runecloak_research_sites_updated_at before update on runecloak_research_sites
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_spells_updated_at on runecloak_spells;
create trigger set_runecloak_spells_updated_at before update on runecloak_spells
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_cycles_updated_at on runecloak_cycles;
create trigger set_runecloak_cycles_updated_at before update on runecloak_cycles
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_spell_progress_updated_at on runecloak_spell_progress;
create trigger set_runecloak_spell_progress_updated_at before update on runecloak_spell_progress
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_stages_updated_at on runecloak_stages;
create trigger set_runecloak_stages_updated_at before update on runecloak_stages
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_sessions_updated_at on runecloak_sessions;
create trigger set_runecloak_sessions_updated_at before update on runecloak_sessions
for each row execute function set_updated_at();

drop trigger if exists set_runecloak_participation_updated_at on runecloak_session_participation;
create trigger set_runecloak_participation_updated_at before update on runecloak_session_participation
for each row execute function set_updated_at();

create or replace function prevent_runecloak_locked_roster_change()
returns trigger as $$
declare
  cycle_status text;
  target_cycle_id uuid;
begin
  if tg_op = 'DELETE' then
    target_cycle_id := old.cycle_id;
  else
    target_cycle_id := new.cycle_id;
  end if;
  select status into cycle_status from runecloak_cycles where id = target_cycle_id;
  if cycle_status <> 'Draft' then
    if tg_op in ('INSERT', 'DELETE') then
      raise exception 'A locked Runecloak roster cannot add or remove members.';
    end if;
    if new.cycle_id <> old.cycle_id or new.ranger_id <> old.ranger_id or new.application_id <> old.application_id then
      raise exception 'A locked Runecloak roster member identity cannot change.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists protect_runecloak_locked_roster on runecloak_cycle_members;
create trigger protect_runecloak_locked_roster
before insert or update or delete on runecloak_cycle_members
for each row execute function prevent_runecloak_locked_roster_change();

create or replace function prevent_runecloak_audit_mutation()
returns trigger as $$
begin
  raise exception 'Runecloak audit events are append-only.';
end;
$$ language plpgsql;

drop trigger if exists protect_runecloak_audit_events on runecloak_audit_events;
create trigger protect_runecloak_audit_events
before update or delete on runecloak_audit_events
for each row execute function prevent_runecloak_audit_mutation();

create or replace function lock_runecloak_cycle(
  cycle_id_input uuid,
  actor_discord_user_id_input text
)
returns jsonb as $$
declare
  selected_cycle runecloak_cycles%rowtype;
  member_count integer;
  invalid_count integer;
  required_count integer;
  calculated_hash text;
begin
  select * into selected_cycle from runecloak_cycles where id = cycle_id_input for update;
  if not found then
    raise exception 'Runecloak cycle not found.';
  end if;
  if selected_cycle.status <> 'Draft' then
    raise exception 'Only a Draft Runecloak cycle may be locked.';
  end if;
  if exists (
    select 1 from runecloak_cycles
    where guild_id = selected_cycle.guild_id
      and id <> selected_cycle.id
      and status in ('Locked', 'Awaiting Moonshadow Start', 'Active', 'Awaiting Moonshadow Grant')
  ) then
    raise exception 'Another official Runecloak cycle is already open.';
  end if;

  select count(*) into member_count from runecloak_cycle_members where cycle_id = cycle_id_input;
  if member_count < selected_cycle.minimum_roster_size then
    raise exception 'The cycle requires at least % learners before lock.', selected_cycle.minimum_roster_size;
  end if;

  select count(*) into invalid_count
  from runecloak_cycle_members member
  join rangers ranger on ranger.id = member.ranger_id
  join runecloak_applications application on application.id = member.application_id
  where member.cycle_id = cycle_id_input
    and (
      ranger.status <> 'Active'
      or ranger.current_rank not in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander')
      or application.applicant_ranger_id <> ranger.id
      or application.status <> 'Approved'
      or not exists (
        select 1 from runecloak_research_sites site
        where site.application_id = application.id and site.status = 'Approved'
      )
      or exists (
        select 1
        from runecloak_spells spell
        where spell.id = selected_cycle.spell_id
          and spell.prerequisite_spell_id is not null
          and not exists (
            select 1 from runecloak_spell_progress progress
            where progress.ranger_id = ranger.id
              and progress.spell_id = spell.prerequisite_spell_id
              and progress.status = 'completed'
          )
      )
      or exists (
        select 1 from runecloak_spell_progress progress
        where progress.ranger_id = ranger.id
          and progress.spell_id = selected_cycle.spell_id
          and progress.status = 'completed'
      )
    );
  if invalid_count > 0 then
    raise exception '% selected learner(s) are not eligible for this cycle.', invalid_count;
  end if;

  required_count := ceil(member_count * selected_cycle.quorum_percent / 100.0);
  select encode(digest(string_agg(ranger_id::text, ',' order by ranger_id::text), 'sha256'), 'hex')
    into calculated_hash
  from runecloak_cycle_members where cycle_id = cycle_id_input;

  update runecloak_cycle_members member
  set rank_snapshot = ranger.current_rank,
      status_snapshot = ranger.status,
      participation_status = 'Active'
  from rangers ranger
  where member.cycle_id = cycle_id_input and ranger.id = member.ranger_id;

  update runecloak_cycles
  set status = 'Awaiting Moonshadow Start',
      locked_roster_count = member_count,
      required_stage_attendance = required_count,
      roster_hash = calculated_hash,
      locked_by_discord_user_id = actor_discord_user_id_input,
      locked_at = now()
  where id = cycle_id_input;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id, after_snapshot
  ) values (
    selected_cycle.guild_id,
    'cycle',
    cycle_id_input,
    'roster_locked',
    actor_discord_user_id_input,
    jsonb_build_object('roster_count', member_count, 'required_attendance', required_count, 'roster_hash', calculated_hash)
  );

  return jsonb_build_object('roster_count', member_count, 'required_attendance', required_count, 'roster_hash', calculated_hash);
end;
$$ language plpgsql;

create or replace function verify_runecloak_stage(
  stage_id_input uuid,
  actor_discord_user_id_input text,
  reason_input text default null
)
returns jsonb as $$
declare
  selected_stage runecloak_stages%rowtype;
  selected_cycle runecloak_cycles%rowtype;
  verified_session_count integer;
  attendance_count integer;
  stage_points integer;
  cycle_points integer;
  resulting_status text;
begin
  select * into selected_stage from runecloak_stages where id = stage_id_input for update;
  if not found then
    raise exception 'Runecloak stage not found.';
  end if;
  select * into selected_cycle from runecloak_cycles where id = selected_stage.cycle_id for update;
  if selected_cycle.status not in ('Active', 'Awaiting Moonshadow Grant') then
    raise exception 'The cycle is not active.';
  end if;

  select count(*) into verified_session_count
  from runecloak_sessions where stage_id = stage_id_input and status = 'Verified';
  if verified_session_count <> 2 then
    raise exception 'Both EU and NA sessions must be verified first.';
  end if;

  select count(distinct participation.ranger_id) into attendance_count
  from runecloak_session_participation participation
  join runecloak_cycle_members member
    on member.cycle_id = selected_stage.cycle_id and member.ranger_id = participation.ranger_id
  where participation.stage_id = stage_id_input
    and participation.participation_kind = 'learner'
    and participation.status = 'verified'
    and member.participation_status <> 'Ineligible';

  select coalesce(sum(accepted_roll), 0) into stage_points
  from (
    select participation.ranger_id, max(participation.roll_value) as accepted_roll
    from runecloak_session_participation participation
    join runecloak_cycle_members member
      on member.cycle_id = selected_stage.cycle_id and member.ranger_id = participation.ranger_id
    where participation.stage_id = stage_id_input
      and participation.participation_kind = 'learner'
      and participation.status = 'verified'
      and participation.roll_value is not null
      and member.participation_status <> 'Ineligible'
    group by participation.ranger_id
  ) rolls;

  resulting_status := case
    when attendance_count >= selected_stage.required_unique_attendance then 'Valid'
    else 'Invalid'
  end;

  update runecloak_stages
  set status = resulting_status,
      actual_unique_attendance = attendance_count,
      verified_points = case when resulting_status = 'Valid' then stage_points else 0 end,
      validated_by_discord_user_id = actor_discord_user_id_input,
      validated_at = now(),
      validation_reason = reason_input
  where id = stage_id_input;

  select coalesce(sum(verified_points), 0) into cycle_points
  from runecloak_stages
  where cycle_id = selected_stage.cycle_id and status = 'Valid';

  update runecloak_cycles
  set verified_points = cycle_points,
      status = case
        when cycle_points >= point_target then 'Awaiting Moonshadow Grant'
        else 'Active'
      end
  where id = selected_stage.cycle_id;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id, reason, after_snapshot
  ) values (
    selected_cycle.guild_id,
    'stage',
    stage_id_input,
    'stage_verified',
    actor_discord_user_id_input,
    reason_input,
    jsonb_build_object('status', resulting_status, 'attendance', attendance_count, 'points', case when resulting_status = 'Valid' then stage_points else 0 end)
  );

  return jsonb_build_object(
    'status', resulting_status,
    'attendance', attendance_count,
    'required_attendance', selected_stage.required_unique_attendance,
    'stage_points', case when resulting_status = 'Valid' then stage_points else 0 end,
    'cycle_points', cycle_points
  );
end;
$$ language plpgsql;

create or replace function complete_runecloak_cycle(
  cycle_id_input uuid,
  actor_discord_user_id_input text,
  grant_reference_input text,
  confirmed_ranger_ids_input uuid[]
)
returns jsonb as $$
declare
  selected_cycle runecloak_cycles%rowtype;
  selected_spell runecloak_spells%rowtype;
  qualification_id_value uuid;
  valid_stage_count integer;
  default_required integer;
  member_record record;
  existing_progress runecloak_spell_progress%rowtype;
  required_credits integer;
  earned_credits integer;
  prior_credits integer;
  retained_credits integer;
  member_points integer;
  actual_attended integer;
  is_confirmed boolean;
  is_eligible boolean;
  completed_count integer := 0;
begin
  if nullif(btrim(grant_reference_input), '') is null then
    raise exception 'A Moonshadow grant reference is required.';
  end if;
  if coalesce(cardinality(confirmed_ranger_ids_input), 0) = 0 then
    raise exception 'At least one Moonshadow-confirmed learner is required.';
  end if;
  select * into selected_cycle from runecloak_cycles where id = cycle_id_input for update;
  if not found then
    raise exception 'Runecloak cycle not found.';
  end if;
  if selected_cycle.status <> 'Awaiting Moonshadow Grant' or selected_cycle.verified_points < selected_cycle.point_target then
    raise exception 'The cycle has not reached its verified target.';
  end if;
  if exists (
    select 1
    from unnest(confirmed_ranger_ids_input) as confirmed(confirmed_ranger_id)
    where not exists (
      select 1 from runecloak_cycle_members member
      where member.cycle_id = cycle_id_input and member.ranger_id = confirmed_ranger_id
    )
  ) then
    raise exception 'Moonshadow confirmation includes a learner outside the locked roster.';
  end if;
  select * into selected_spell from runecloak_spells where id = selected_cycle.spell_id;
  select id into qualification_id_value from corps_qualifications where slug = 'ranger-runecloak';
  select count(*) into valid_stage_count from runecloak_stages where cycle_id = cycle_id_input and status = 'Valid';
  if valid_stage_count = 0 then
    raise exception 'The cycle has no valid stages.';
  end if;
  default_required := floor(valid_stage_count / 2.0) + 1;

  for member_record in
    select member.*, ranger.discord_user_id
    from runecloak_cycle_members member
    join rangers ranger on ranger.id = member.ranger_id
    where member.cycle_id = cycle_id_input
    order by member.selected_at, member.id
  loop
    select * into existing_progress
    from runecloak_spell_progress
    where ranger_id = member_record.ranger_id and spell_id = selected_cycle.spell_id;

    required_credits := coalesce(existing_progress.required_attendance_credits, default_required);
    prior_credits := least(coalesce(existing_progress.verified_attendance_credits, 0), required_credits);

    select count(distinct participation.stage_id) into actual_attended
    from runecloak_session_participation participation
    join runecloak_stages stage on stage.id = participation.stage_id and stage.status = 'Valid'
    where stage.cycle_id = cycle_id_input
      and participation.ranger_id = member_record.ranger_id
      and participation.participation_kind = 'learner'
      and participation.status = 'verified';

    earned_credits := least(actual_attended, greatest(required_credits - prior_credits, 0));
    retained_credits := least(required_credits, prior_credits + earned_credits);
    is_confirmed := member_record.ranger_id = any(coalesce(confirmed_ranger_ids_input, array[]::uuid[]));
    is_eligible := retained_credits >= required_credits
      and member_record.participation_status not in ('Withdrawn', 'Ineligible');

    if is_confirmed and not is_eligible then
      raise exception 'Moonshadow confirmation includes an ineligible learner: %.', member_record.ranger_id;
    end if;

    select coalesce(sum(participation.roll_value), 0) into member_points
    from runecloak_session_participation participation
    join runecloak_stages stage on stage.id = participation.stage_id and stage.status = 'Valid'
    where stage.cycle_id = cycle_id_input
      and participation.ranger_id = member_record.ranger_id
      and participation.participation_kind = 'learner'
      and participation.status = 'verified'
      and participation.roll_value is not null;

    insert into runecloak_spell_progress (
      ranger_id,
      spell_id,
      required_attendance_credits,
      verified_attendance_credits,
      status,
      completion_cycle_id,
      confirmed_by_discord_user_id,
      confirmed_at
    ) values (
      member_record.ranger_id,
      selected_cycle.spell_id,
      required_credits,
      retained_credits,
      case when is_confirmed then 'completed' else 'in_progress' end,
      case when is_confirmed then cycle_id_input else null end,
      case when is_confirmed then actor_discord_user_id_input else null end,
      case when is_confirmed then now() else null end
    )
    on conflict (ranger_id, spell_id) do update
    set verified_attendance_credits = greatest(runecloak_spell_progress.verified_attendance_credits, excluded.verified_attendance_credits),
        status = case when runecloak_spell_progress.status = 'completed' or excluded.status = 'completed' then 'completed' else 'in_progress' end,
        completion_cycle_id = coalesce(runecloak_spell_progress.completion_cycle_id, excluded.completion_cycle_id),
        confirmed_by_discord_user_id = coalesce(runecloak_spell_progress.confirmed_by_discord_user_id, excluded.confirmed_by_discord_user_id),
        confirmed_at = coalesce(runecloak_spell_progress.confirmed_at, excluded.confirmed_at),
        updated_at = now();

    update runecloak_cycle_members
    set final_valid_stages_attended = actual_attended,
        final_required_attendance = required_credits,
        prior_attendance_credits = prior_credits,
        cycle_attendance_credits = earned_credits,
        retained_attendance_credits = retained_credits,
        final_contributed_points = member_points,
        participation_status = case
          when is_confirmed then 'Completed'
          when member_record.participation_status in ('Withdrawn', 'Ineligible') then member_record.participation_status
          else 'Study Incomplete'
        end,
        final_result = case
          when is_confirmed then 'Confirmed by Moonshadow'
          when is_eligible then 'Eligible but not confirmed'
          else 'Study Incomplete'
        end,
        spell_confirmed_at = case when is_confirmed then now() else null end
    where id = member_record.id;

    if is_confirmed then
      completed_count := completed_count + 1;
      if selected_spell.sequence = 1 then
        insert into ranger_qualifications (
          qualification_id,
          ranger_id,
          source_cycle_id,
          awarded_by_discord_user_id
        ) values (
          qualification_id_value,
          member_record.ranger_id,
          cycle_id_input,
          actor_discord_user_id_input
        ) on conflict do nothing;
      end if;
    end if;
  end loop;

  update runecloak_cycles
  set status = 'Completed',
      grant_reference = btrim(grant_reference_input),
      grant_confirmed_by_discord_user_id = actor_discord_user_id_input,
      grant_confirmed_at = now(),
      completed_at = now()
  where id = cycle_id_input;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id, reason, after_snapshot
  ) values (
    selected_cycle.guild_id,
    'cycle',
    cycle_id_input,
    'cycle_completed',
    actor_discord_user_id_input,
    grant_reference_input,
    jsonb_build_object(
      'confirmed_learners', completed_count,
      'confirmed_ranger_ids', confirmed_ranger_ids_input,
      'verified_points', selected_cycle.verified_points,
      'valid_stages', valid_stage_count
    )
  );

  return jsonb_build_object('confirmed_learners', completed_count, 'valid_stages', valid_stage_count, 'verified_points', selected_cycle.verified_points);
end;
$$ language plpgsql;
