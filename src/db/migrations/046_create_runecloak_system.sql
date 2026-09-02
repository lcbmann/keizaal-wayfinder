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
  desk_channel_id text not null,
  application_review_channel_id text not null,
  runecloak_channel_id text not null,
  learner_channel_id text not null,
  expedition_forum_id text not null,
  dashboard_message_id text,
  guide_role_id text not null,
  learner_role_id text not null,
  qualification_role_id text not null,
  admissions_open boolean not null default false,
  program_state text not null default 'Organizing' check (
    program_state in ('Organizing', 'Registration Pending', 'Registered', 'Paused')
  ),
  registration_reference text,
  registration_confirmed_by_discord_user_id text,
  registration_confirmed_at timestamptz,
  minimum_roster_size integer not null default 20 check (minimum_roster_size > 0),
  quorum_percent integer not null default 51 check (quorum_percent between 1 and 100),
  point_target integer not null default 8000 check (point_target > 0),
  personal_point_requirement integer not null default 400 check (personal_point_requirement > 0),
  personal_stage_requirement integer not null default 5 check (personal_stage_requirement > 0),
  regional_cooldown_hours integer not null default 72 check (regional_cooldown_hours > 0),
  configured_by_discord_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runecloak_team_assignments (
  id uuid primary key default gen_random_uuid(),
  ranger_id uuid not null references rangers(id) on delete cascade,
  assignment_kind text not null check (assignment_kind = 'guide'),
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
  entry_path text not null default 'standard' check (entry_path in ('standard', 'marshal_direct')),
  initial_screening_skipped boolean not null default false,
  check (entry_path <> 'marshal_direct' or initial_screening_skipped),
  preferred_regional_slot text check (preferred_regional_slot is null or preferred_regional_slot in ('EU', 'NA', 'Flexible')),
  status text not null default 'Submitted' check (
    status in ('Submitted', 'Survey Requested', 'Survey Submitted', 'Revision Requested', 'Approved', 'Denied', 'Withdrawn')
  ),
  reason text,
  experience text,
  availability text,
  loyalties_conflicts text,
  review_note text,
  reviewed_by_discord_user_id text,
  reviewed_at timestamptz,
  review_channel_id text,
  review_message_id text,
  review_thread_id text,
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
  structured_report_id uuid references structured_trailmark_reports(id) on delete set null,
  research_rationale text not null,
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

create table if not exists runecloak_memberships (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  ranger_id uuid not null references rangers(id) on delete cascade,
  application_id uuid references runecloak_applications(id) on delete set null,
  status text not null default 'Learner' check (
    status in ('Learner', 'Qualified', 'Withdrawn', 'Ineligible')
  ),
  preferred_regional_slot text check (preferred_regional_slot is null or preferred_regional_slot in ('EU', 'NA', 'Flexible')),
  admitted_by_discord_user_id text not null,
  admitted_at timestamptz not null default now(),
  status_reason text,
  status_changed_by_discord_user_id text,
  status_changed_at timestamptz,
  first_qualified_spell_id uuid references runecloak_spells(id) on delete set null,
  first_qualified_at timestamptz,
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
    status in ('Draft', 'Awaiting Moonshadow Start', 'Active', 'Awaiting GM Approval', 'Completed', 'Cancelled')
  ),
  minimum_roster_size integer not null check (minimum_roster_size > 0),
  quorum_percent integer not null check (quorum_percent between 1 and 100),
  point_target integer not null check (point_target > 0),
  start_reference text,
  started_by_discord_user_id text,
  started_at timestamptz,
  gm_approval_reference text,
  gm_approval_recorded_by_discord_user_id text,
  gm_approval_recorded_at timestamptz,
  verified_points integer not null default 0,
  enrollment_remains_open boolean not null default true,
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
  application_id uuid references runecloak_applications(id) on delete set null,
  membership_id uuid references runecloak_memberships(id) on delete set null,
  rank_snapshot ranger_rank,
  status_snapshot ranger_status,
  participation_status text not null default 'Selected' check (
    participation_status in ('Selected', 'Active', 'Withdrawn', 'Ineligible', 'Eligible for Delivery', 'Completed', 'Study Incomplete')
  ),
  selected_by_discord_user_id text not null,
  selected_at timestamptz not null default now(),
  status_reason text,
  status_changed_by_discord_user_id text,
  status_changed_at timestamptz,
  final_valid_stages_attended integer,
  final_required_attendance integer,
  final_contributed_points integer not null default 0,
  final_result text,
  spell_delivered_at timestamptz,
  unique (cycle_id, ranger_id)
);

create table if not exists runecloak_spell_progress (
  ranger_id uuid not null references rangers(id) on delete cascade,
  spell_id uuid not null references runecloak_spells(id) on delete restrict,
  required_points integer not null default 400 check (required_points > 0),
  required_valid_stages integer not null default 5 check (required_valid_stages > 0),
  verified_points integer not null default 0 check (verified_points >= 0),
  verified_valid_stages integer not null default 0 check (verified_valid_stages >= 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'eligible', 'completed')),
  completion_cycle_id uuid references runecloak_cycles(id) on delete set null,
  unlock_id uuid,
  delivery_reference text,
  delivery_recorded_by_discord_user_id text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ranger_id, spell_id)
);

create table if not exists runecloak_stages (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references runecloak_cycles(id) on delete cascade,
  sequence integer not null,
  title text not null,
  theme text not null,
  notes text,
  status text not null default 'Draft' check (status in ('Draft', 'Open', 'Ready for Review', 'Valid', 'Invalid')),
  eligible_learner_count integer not null default 0 check (eligible_learner_count >= 0),
  required_unique_attendance integer not null default 0 check (required_unique_attendance >= 0),
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
  unique (cycle_id, sequence)
);

create table if not exists runecloak_sessions (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references runecloak_stages(id) on delete cascade,
  regional_slot text not null check (regional_slot in ('EU', 'NA')),
  planned_at timestamptz,
  actual_at timestamptz,
  regional_cooldown_ends_at timestamptz,
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

create table if not exists runecloak_stage_eligible_learners (
  stage_id uuid not null references runecloak_stages(id) on delete cascade,
  ranger_id uuid not null references rangers(id) on delete restrict,
  membership_id uuid not null references runecloak_memberships(id) on delete restrict,
  rank_snapshot ranger_rank not null,
  ranger_status_snapshot ranger_status not null,
  membership_status_snapshot text not null check (membership_status_snapshot in ('Learner', 'Qualified')),
  captured_at timestamptz not null default now(),
  primary key (stage_id, ranger_id),
  unique (stage_id, membership_id)
);

create table if not exists runecloak_session_participation (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references runecloak_stages(id) on delete cascade,
  session_id uuid not null,
  ranger_id uuid not null references rangers(id) on delete restrict,
  study_spell_id uuid references runecloak_spells(id) on delete restrict,
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

create table if not exists runecloak_spell_unlocks (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  spell_id uuid not null references runecloak_spells(id) on delete restrict,
  source_cycle_id uuid not null references runecloak_cycles(id) on delete restrict,
  unlock_reference text not null,
  unlocked_by_discord_user_id text not null,
  unlocked_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  unique (guild_id, spell_id)
);

alter table runecloak_spell_progress
add constraint runecloak_spell_progress_unlock_id_fkey
foreign key (unlock_id) references runecloak_spell_unlocks(id) on delete set null;

create table if not exists runecloak_personal_study_credits (
  id uuid primary key default gen_random_uuid(),
  ranger_id uuid not null references rangers(id) on delete cascade,
  spell_id uuid not null references runecloak_spells(id) on delete restrict,
  stage_id uuid not null references runecloak_stages(id) on delete cascade,
  participation_id uuid not null references runecloak_session_participation(id) on delete cascade,
  verified_points integer not null check (verified_points between 1 and 100),
  verified_by_discord_user_id text not null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (ranger_id, stage_id),
  unique (participation_id)
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
  'A Ranger qualified through verified field research and an in-game GM-delivered Runecloak spell.',
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
  'Moonshadow registration, shared GM approval, and individual in-game delivery are required.'
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
  'Moonshadow registration, shared GM approval, and individual in-game delivery are required.'
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
where status in ('Submitted', 'Survey Requested', 'Survey Submitted', 'Revision Requested');

create unique index if not exists runecloak_one_current_site_per_application
on runecloak_research_sites(application_id)
where status <> 'Retired';

create unique index if not exists runecloak_one_membership_per_ranger
on runecloak_memberships(guild_id, ranger_id);

create unique index if not exists runecloak_one_membership_per_application
on runecloak_memberships(application_id)
where application_id is not null;

create unique index if not exists runecloak_one_official_cycle
on runecloak_cycles(guild_id)
where status in ('Awaiting Moonshadow Start', 'Active', 'Awaiting GM Approval');

create unique index if not exists runecloak_one_roll_per_stage
on runecloak_session_participation(stage_id, ranger_id)
where roll_value is not null and status <> 'rejected';

create unique index if not exists runecloak_one_live_stage_per_campaign
on runecloak_stages(cycle_id)
where status in ('Open', 'Ready for Review');

create unique index if not exists ranger_one_active_qualification
on ranger_qualifications(qualification_id, ranger_id)
where revoked_at is null;

create index if not exists runecloak_applications_status_idx
on runecloak_applications(status, created_at);

create index if not exists runecloak_sites_status_idx
on runecloak_research_sites(status, created_at);

create index if not exists runecloak_cycles_status_idx
on runecloak_cycles(guild_id, status, sequence);

create index if not exists runecloak_memberships_status_idx
on runecloak_memberships(guild_id, status, admitted_at);

create index if not exists runecloak_sessions_regional_cooldown_idx
on runecloak_sessions(regional_slot, regional_cooldown_ends_at)
where status in ('Submitted', 'Verified');

create index if not exists runecloak_participation_stage_idx
on runecloak_session_participation(stage_id, status, participation_kind);

create index if not exists runecloak_stage_eligible_ranger_idx
on runecloak_stage_eligible_learners(ranger_id, stage_id);

create index if not exists runecloak_personal_credits_progress_idx
on runecloak_personal_study_credits(ranger_id, spell_id, stage_id);

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
alter table runecloak_memberships enable row level security;
alter table runecloak_cycles enable row level security;
alter table runecloak_cycle_members enable row level security;
alter table runecloak_spell_progress enable row level security;
alter table runecloak_stages enable row level security;
alter table runecloak_sessions enable row level security;
alter table runecloak_stage_eligible_learners enable row level security;
alter table runecloak_session_participation enable row level security;
alter table runecloak_spell_unlocks enable row level security;
alter table runecloak_personal_study_credits enable row level security;
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

drop trigger if exists set_runecloak_memberships_updated_at on runecloak_memberships;
create trigger set_runecloak_memberships_updated_at before update on runecloak_memberships
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

create or replace function enforce_runecloak_initial_registration()
returns trigger as $$
declare
  eligible_count integer;
  first_confirmation boolean;
begin
  first_confirmation := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    first_confirmation := old.registration_confirmed_at is null;
    if old.registration_confirmed_at is not null and (
      new.registration_confirmed_at is distinct from old.registration_confirmed_at
      or new.registration_confirmed_by_discord_user_id is distinct from old.registration_confirmed_by_discord_user_id
      or new.registration_reference is distinct from old.registration_reference
    ) then
      raise exception 'The initial Runecloak registration confirmation is immutable.';
    end if;
  end if;

  if new.registration_confirmed_at is not null
     and first_confirmation
     and new.program_state <> 'Registered' then
    raise exception 'Initial Runecloak registration may only be confirmed while setting the program to Registered.';
  end if;

  if new.program_state = 'Registered'
     and first_confirmation then
    if nullif(btrim(new.registration_reference), '') is null
       or new.registration_confirmed_by_discord_user_id is null
       or new.registration_confirmed_at is null then
      raise exception 'Initial Runecloak registration requires its Moonshadow reference and confirmation record.';
    end if;

    select count(*) into eligible_count
    from runecloak_memberships membership
    join rangers ranger on ranger.id = membership.ranger_id
    where membership.guild_id = new.guild_id
      and membership.status in ('Learner', 'Qualified')
      and ranger.status = 'Active'
      and ranger.current_rank in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander');

    if eligible_count < new.minimum_roster_size then
      raise exception 'Initial program registration requires at least % active learners.', new.minimum_roster_size;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists enforce_runecloak_initial_registration_trigger on runecloak_settings;
create trigger enforce_runecloak_initial_registration_trigger
before insert or update on runecloak_settings
for each row execute function enforce_runecloak_initial_registration();

create or replace function enforce_runecloak_stage_eligibility()
returns trigger as $$
declare
  stage_status text;
  session_status text;
begin
  select status into session_status
  from runecloak_sessions
  where id = new.session_id and stage_id = new.stage_id
  for share;
  if not found or session_status not in ('Planned', 'Submitted') then
    raise exception 'Participation may only be changed before its regional session is verified.';
  end if;
  select status into stage_status
  from runecloak_stages where id = new.stage_id
  for share;
  if stage_status <> 'Open' then
    raise exception 'Participation may only be changed while the paired stage is open.';
  end if;
  if new.participation_kind = 'learner' and not exists (
    select 1
    from runecloak_stage_eligible_learners eligible
    where eligible.stage_id = new.stage_id and eligible.ranger_id = new.ranger_id
  ) then
    raise exception 'This Ranger is not currently eligible for the paired stage.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists enforce_runecloak_participant_eligibility on runecloak_session_participation;
create trigger enforce_runecloak_participant_eligibility
before insert or update on runecloak_session_participation
for each row execute function enforce_runecloak_stage_eligibility();

create or replace function prevent_runecloak_participation_delete()
returns trigger as $$
begin
  raise exception 'Runecloak participation records are permanent; correct them before verification instead of deleting them.';
end;
$$ language plpgsql;

drop trigger if exists protect_runecloak_participation on runecloak_session_participation;
create trigger protect_runecloak_participation
before delete on runecloak_session_participation
for each row execute function prevent_runecloak_participation_delete();

create or replace function prevent_runecloak_personal_credit_mutation()
returns trigger as $$
begin
  raise exception 'Verified Runecloak personal study credits are immutable.';
end;
$$ language plpgsql;

drop trigger if exists protect_runecloak_personal_study_credits on runecloak_personal_study_credits;
create trigger protect_runecloak_personal_study_credits
before update or delete on runecloak_personal_study_credits
for each row execute function prevent_runecloak_personal_credit_mutation();

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

create or replace function approve_runecloak_admission(
  guild_id_input text,
  application_id_input uuid,
  actor_discord_user_id_input text,
  note_input text default null
)
returns jsonb as $$
declare
  selected_application runecloak_applications%rowtype;
  selected_membership runecloak_memberships%rowtype;
  selected_ranger rangers%rowtype;
  open_stage_id uuid;
  open_stage_learner_count integer;
  open_stage_required_count integer;
begin
  select * into selected_application
  from runecloak_applications where id = application_id_input for update;
  if not found then
    raise exception 'Runecloak application not found.';
  end if;
  if selected_application.status <> 'Survey Submitted' then
    raise exception 'Only an application with a submitted field survey may be admitted.';
  end if;
  if not exists (
    select 1 from runecloak_research_sites site
    where site.application_id = selected_application.id and site.status = 'Approved'
  ) then
    raise exception 'The application needs an approved research site before admission.';
  end if;

  select * into selected_ranger
  from rangers where id = selected_application.applicant_ranger_id for update;
  if not found
     or selected_ranger.status <> 'Active'
     or selected_ranger.current_rank not in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander') then
    raise exception 'The applicant must be an active Ranger or higher.';
  end if;

  select * into selected_membership
  from runecloak_memberships
  where guild_id = guild_id_input and ranger_id = selected_application.applicant_ranger_id
  order by case when status in ('Learner', 'Qualified') then 0 else 1 end, admitted_at desc
  limit 1
  for update;

  if found then
    update runecloak_memberships
    set application_id = selected_application.id,
        status = case
          when selected_membership.status = 'Qualified' or selected_membership.first_qualified_at is not null
          then 'Qualified'
          else 'Learner'
        end,
        preferred_regional_slot = coalesce(
          selected_application.preferred_regional_slot,
          selected_membership.preferred_regional_slot
        ),
        admitted_by_discord_user_id = actor_discord_user_id_input,
        admitted_at = now(),
        status_reason = null,
        status_changed_by_discord_user_id = actor_discord_user_id_input,
        status_changed_at = now()
    where id = selected_membership.id
    returning * into selected_membership;
  else
    insert into runecloak_memberships (
      guild_id, ranger_id, application_id, status, preferred_regional_slot,
      admitted_by_discord_user_id
    ) values (
      guild_id_input,
      selected_application.applicant_ranger_id,
      selected_application.id,
      'Learner',
      selected_application.preferred_regional_slot,
      actor_discord_user_id_input
    ) returning * into selected_membership;
  end if;

  update runecloak_applications
  set status = 'Approved',
      review_note = note_input,
      reviewed_by_discord_user_id = actor_discord_user_id_input,
      reviewed_at = now()
  where id = selected_application.id;

  insert into runecloak_cycle_members (
    cycle_id, ranger_id, application_id, membership_id, rank_snapshot,
    status_snapshot, participation_status, selected_by_discord_user_id
  )
  select
    cycle.id,
    selected_membership.ranger_id,
    selected_application.id,
    selected_membership.id,
    selected_ranger.current_rank,
    selected_ranger.status,
    case when cycle.status in ('Active', 'Awaiting GM Approval') then 'Active' else 'Selected' end,
    actor_discord_user_id_input
  from runecloak_cycles cycle
  where cycle.guild_id = guild_id_input
    and cycle.status in ('Awaiting Moonshadow Start', 'Active', 'Awaiting GM Approval')
  on conflict (cycle_id, ranger_id) do update
  set application_id = excluded.application_id,
      membership_id = excluded.membership_id,
      rank_snapshot = excluded.rank_snapshot,
      status_snapshot = excluded.status_snapshot,
      participation_status = excluded.participation_status,
      status_reason = null,
      status_changed_by_discord_user_id = actor_discord_user_id_input,
      status_changed_at = now();

  for open_stage_id in
    select stage.id
    from runecloak_stages stage
    join runecloak_cycles cycle on cycle.id = stage.cycle_id
    where cycle.guild_id = guild_id_input
      and cycle.status = 'Active'
      and stage.status = 'Open'
      and exists (
        select 1 from runecloak_sessions session
        where session.stage_id = stage.id
          and session.status in ('Planned', 'Submitted')
      )
    for update of stage
  loop
    insert into runecloak_stage_eligible_learners (
      stage_id, ranger_id, membership_id, rank_snapshot,
      ranger_status_snapshot, membership_status_snapshot
    ) values (
      open_stage_id,
      selected_membership.ranger_id,
      selected_membership.id,
      selected_ranger.current_rank,
      selected_ranger.status,
      selected_membership.status
    ) on conflict (stage_id, ranger_id) do nothing;

    select count(*) into open_stage_learner_count
    from runecloak_stage_eligible_learners eligible
    where eligible.stage_id = open_stage_id;

    select ceil(open_stage_learner_count * cycle.quorum_percent / 100.0)::integer
      into open_stage_required_count
    from runecloak_stages stage
    join runecloak_cycles cycle on cycle.id = stage.cycle_id
    where stage.id = open_stage_id;

    update runecloak_stages
    set eligible_learner_count = open_stage_learner_count,
        required_unique_attendance = open_stage_required_count
    where id = open_stage_id;
  end loop;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id,
    reason, after_snapshot
  ) values (
    guild_id_input, 'application', selected_application.id, 'learner_admitted',
    actor_discord_user_id_input, note_input,
    jsonb_build_object(
      'application_id', selected_application.id,
      'membership_id', selected_membership.id,
      'ranger_id', selected_membership.ranger_id,
      'membership_status', selected_membership.status,
      'entry_path', selected_application.entry_path,
      'added_to_open_stage', open_stage_id is not null
    )
  );

  return jsonb_build_object(
    'application_id', selected_application.id,
    'application_status', 'Approved',
    'membership_id', selected_membership.id,
    'membership_status', selected_membership.status,
    'ranger_id', selected_membership.ranger_id,
    'added_to_open_stage', open_stage_id is not null
  );
end;
$$ language plpgsql;

create or replace function prepare_runecloak_cycle(
  cycle_id_input uuid,
  actor_discord_user_id_input text
)
returns jsonb as $$
declare
  selected_cycle runecloak_cycles%rowtype;
  selected_settings runecloak_settings%rowtype;
  member_count integer;
  required_count integer;
begin
  select * into selected_cycle from runecloak_cycles where id = cycle_id_input for update;
  if not found then
    raise exception 'Runecloak cycle not found.';
  end if;
  if selected_cycle.status <> 'Draft' then
    raise exception 'Only a Draft Runecloak campaign may be submitted for registration.';
  end if;
  if exists (
    select 1 from runecloak_cycles
    where guild_id = selected_cycle.guild_id
      and id <> selected_cycle.id
      and status in ('Awaiting Moonshadow Start', 'Active', 'Awaiting GM Approval')
  ) then
    raise exception 'Another official Runecloak cycle is already open.';
  end if;
  if exists (
    select 1 from runecloak_spell_unlocks unlock
    where unlock.guild_id = selected_cycle.guild_id and unlock.spell_id = selected_cycle.spell_id
  ) then
    raise exception 'This spell is already globally unlocked for the guild.';
  end if;
  if exists (
    select 1
    from runecloak_spells spell
    where spell.id = selected_cycle.spell_id
      and spell.prerequisite_spell_id is not null
      and not exists (
        select 1 from runecloak_spell_unlocks prerequisite_unlock
        where prerequisite_unlock.guild_id = selected_cycle.guild_id
          and prerequisite_unlock.spell_id = spell.prerequisite_spell_id
      )
  ) then
    raise exception 'The campaign spell prerequisite has not been globally unlocked.';
  end if;

  select * into selected_settings
  from runecloak_settings where guild_id = selected_cycle.guild_id for update;
  if not found then
    raise exception 'Runecloak settings were not found for this guild.';
  end if;

  select count(*) into member_count
  from runecloak_memberships membership
  join rangers ranger on ranger.id = membership.ranger_id
  where membership.guild_id = selected_cycle.guild_id
    and membership.status in ('Learner', 'Qualified')
    and ranger.status = 'Active'
    and ranger.current_rank in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander');
  if selected_settings.registration_confirmed_at is null
     and member_count < selected_settings.minimum_roster_size then
    raise exception 'Initial program registration requires at least % active learners.', selected_settings.minimum_roster_size;
  end if;

  required_count := ceil(member_count * selected_cycle.quorum_percent / 100.0);
  insert into runecloak_cycle_members (
    cycle_id, ranger_id, application_id, membership_id, rank_snapshot,
    status_snapshot, participation_status, selected_by_discord_user_id
  )
  select
    cycle_id_input, membership.ranger_id, membership.application_id, membership.id,
    ranger.current_rank, ranger.status, 'Active', actor_discord_user_id_input
  from runecloak_memberships membership
  join rangers ranger on ranger.id = membership.ranger_id
  where membership.guild_id = selected_cycle.guild_id
    and membership.status in ('Learner', 'Qualified')
    and ranger.status = 'Active'
    and ranger.current_rank in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander')
  on conflict (cycle_id, ranger_id) do update
  set application_id = excluded.application_id,
      membership_id = excluded.membership_id,
      rank_snapshot = excluded.rank_snapshot,
      status_snapshot = excluded.status_snapshot,
      participation_status = 'Active',
      status_reason = null,
      status_changed_by_discord_user_id = actor_discord_user_id_input,
      status_changed_at = now();

  update runecloak_cycles
  set status = 'Awaiting Moonshadow Start'
  where id = cycle_id_input;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id, after_snapshot
  ) values (
    selected_cycle.guild_id,
    'cycle',
    cycle_id_input,
    'campaign_prepared',
    actor_discord_user_id_input,
    jsonb_build_object('launch_learner_count', member_count, 'initial_required_attendance', required_count, 'admissions_remain_open', true)
  );

  return jsonb_build_object('learner_count', member_count, 'required_attendance', required_count);
end;
$$ language plpgsql;

create or replace function open_runecloak_stage(
  stage_id_input uuid,
  actor_discord_user_id_input text
)
returns jsonb as $$
declare
  selected_stage runecloak_stages%rowtype;
  selected_cycle runecloak_cycles%rowtype;
  learner_count integer;
  required_count integer;
begin
  select cycle.* into selected_cycle
  from runecloak_cycles cycle
  join runecloak_stages stage on stage.cycle_id = cycle.id
  where stage.id = stage_id_input
  for update of cycle;
  if not found then
    raise exception 'Runecloak stage not found.';
  end if;

  select * into selected_stage
  from runecloak_stages where id = stage_id_input for update;
  if selected_stage.status <> 'Draft' then
    raise exception 'Only a Draft Runecloak stage may be opened.';
  end if;
  if selected_cycle.status <> 'Active' then
    raise exception 'The Runecloak campaign is not active.';
  end if;

  select count(*) into learner_count
  from runecloak_memberships membership
  join rangers ranger on ranger.id = membership.ranger_id
  where membership.guild_id = selected_cycle.guild_id
    and membership.status in ('Learner', 'Qualified')
    and ranger.status = 'Active'
    and ranger.current_rank in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander');
  required_count := ceil(learner_count * selected_cycle.quorum_percent / 100.0);

  if learner_count = 0 then
    raise exception 'No active Runecloak learners are available for this stage.';
  end if;

  insert into runecloak_stage_eligible_learners (
    stage_id, ranger_id, membership_id, rank_snapshot,
    ranger_status_snapshot, membership_status_snapshot
  )
  select
    selected_stage.id, membership.ranger_id, membership.id, ranger.current_rank,
    ranger.status, membership.status
  from runecloak_memberships membership
  join rangers ranger on ranger.id = membership.ranger_id
  where membership.guild_id = selected_cycle.guild_id
    and membership.status in ('Learner', 'Qualified')
    and ranger.status = 'Active'
    and ranger.current_rank in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander');

  insert into runecloak_cycle_members (
    cycle_id, ranger_id, application_id, membership_id, rank_snapshot,
    status_snapshot, participation_status, selected_by_discord_user_id
  )
  select
    selected_cycle.id, membership.ranger_id, membership.application_id, membership.id,
    ranger.current_rank, ranger.status, 'Active', actor_discord_user_id_input
  from runecloak_memberships membership
  join rangers ranger on ranger.id = membership.ranger_id
  where membership.guild_id = selected_cycle.guild_id
    and membership.status in ('Learner', 'Qualified')
    and ranger.status = 'Active'
    and ranger.current_rank in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander')
  on conflict (cycle_id, ranger_id) do update
  set application_id = excluded.application_id,
      membership_id = excluded.membership_id,
      rank_snapshot = excluded.rank_snapshot,
      status_snapshot = excluded.status_snapshot,
      participation_status = 'Active',
      status_reason = null,
      status_changed_by_discord_user_id = actor_discord_user_id_input,
      status_changed_at = now();

  update runecloak_stages
  set status = 'Open',
      eligible_learner_count = learner_count,
      required_unique_attendance = required_count
  where id = selected_stage.id;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id,
    after_snapshot
  ) values (
    selected_cycle.guild_id, 'stage', selected_stage.id, 'stage_opened',
    actor_discord_user_id_input,
    jsonb_build_object(
      'eligible_learner_count', learner_count,
      'required_unique_attendance', required_count,
      'quorum_percent', selected_cycle.quorum_percent
    )
  );

  return jsonb_build_object(
    'eligible_learner_count', learner_count,
    'required_unique_attendance', required_count
  );
end;
$$ language plpgsql;

create or replace function create_runecloak_stage(
  cycle_id_input uuid,
  title_input text,
  theme_input text,
  eu_planned_at_input timestamptz,
  na_planned_at_input timestamptz,
  notes_input text,
  actor_discord_user_id_input text
)
returns jsonb as $$
declare
  selected_cycle runecloak_cycles%rowtype;
  created_stage runecloak_stages%rowtype;
  next_sequence integer;
begin
  select * into selected_cycle
  from runecloak_cycles where id = cycle_id_input for update;
  if not found or selected_cycle.status <> 'Active' then
    raise exception 'Paired expeditions may only be opened for an active Runecloak campaign.';
  end if;
  if nullif(btrim(title_input), '') is null
     or nullif(btrim(theme_input), '') is null then
    raise exception 'A stage title and theme are required.';
  end if;
  if exists (
    select 1 from runecloak_stages
    where cycle_id = selected_cycle.id and status in ('Open', 'Ready for Review')
  ) then
    raise exception 'Finish the current paired stage before opening another one.';
  end if;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from runecloak_stages where cycle_id = cycle_id_input;

  insert into runecloak_stages (
    cycle_id, sequence, title, theme, notes, status,
    eligible_learner_count, required_unique_attendance,
    created_by_discord_user_id
  ) values (
    cycle_id_input, next_sequence, btrim(title_input),
    btrim(theme_input), nullif(btrim(notes_input), ''), 'Draft', 0, 0,
    actor_discord_user_id_input
  ) returning * into created_stage;

  insert into runecloak_sessions (
    stage_id, regional_slot, planned_at, logged_by_discord_user_id
  ) values
    (created_stage.id, 'EU', eu_planned_at_input, actor_discord_user_id_input),
    (created_stage.id, 'NA', na_planned_at_input, actor_discord_user_id_input);

  perform open_runecloak_stage(created_stage.id, actor_discord_user_id_input);

  return jsonb_build_object('stage_id', created_stage.id);
end;
$$ language plpgsql;

create or replace function submit_runecloak_session(
  guild_id_input text,
  session_id_input uuid,
  actual_at_input timestamptz,
  research_site_id_input uuid,
  leader_discord_user_id_input text,
  lesson_summary_input text,
  study_method_input text,
  recording_url_input text,
  moonshadow_reference_input text,
  actor_discord_user_id_input text
)
returns jsonb as $$
declare
  selected_session runecloak_sessions%rowtype;
  selected_stage runecloak_stages%rowtype;
  selected_cycle runecloak_cycles%rowtype;
begin
  select * into selected_session
  from runecloak_sessions where id = session_id_input for update;
  if not found or selected_session.status not in ('Planned', 'Submitted') then
    raise exception 'Only a planned or submitted Runecloak session may receive a lesson record.';
  end if;

  select * into selected_stage
  from runecloak_stages where id = selected_session.stage_id for share;
  if not found or selected_stage.status <> 'Open' then
    raise exception 'The paired stage is not open for a lesson record.';
  end if;

  select * into selected_cycle
  from runecloak_cycles where id = selected_stage.cycle_id;
  if not found or selected_cycle.guild_id <> guild_id_input then
    raise exception 'The Runecloak session does not belong to this guild.';
  end if;
  if not exists (
    select 1
    from runecloak_research_sites site
    join runecloak_memberships membership
      on membership.ranger_id = site.ranger_id
     and membership.guild_id = selected_cycle.guild_id
    where site.id = research_site_id_input
      and site.status = 'Approved'
  ) then
    raise exception 'Choose an approved Runecloak research site for this guild.';
  end if;
  if actual_at_input is null
     or nullif(btrim(leader_discord_user_id_input), '') is null
     or nullif(btrim(lesson_summary_input), '') is null
     or nullif(btrim(study_method_input), '') is null
     or nullif(btrim(recording_url_input), '') is null then
    raise exception 'The session record is missing required fieldwork or recording details.';
  end if;

  update runecloak_sessions
  set actual_at = actual_at_input,
      research_site_id = research_site_id_input,
      leader_discord_user_id = btrim(leader_discord_user_id_input),
      lesson_summary = btrim(lesson_summary_input),
      study_method = btrim(study_method_input),
      recording_url = btrim(recording_url_input),
      moonshadow_reference = nullif(btrim(moonshadow_reference_input), ''),
      status = 'Submitted',
      logged_by_discord_user_id = actor_discord_user_id_input,
      verified_by_discord_user_id = null,
      verification_basis = null,
      verified_at = null
  where id = selected_session.id
  returning * into selected_session;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id, after_snapshot
  ) values (
    selected_cycle.guild_id,
    'session',
    selected_session.id,
    'session_submitted',
    actor_discord_user_id_input,
    jsonb_build_object(
      'stage_id', selected_stage.id,
      'slot', selected_session.regional_slot,
      'recording_url', selected_session.recording_url
    )
  );

  return to_jsonb(selected_session);
end;
$$ language plpgsql;

create or replace function verify_runecloak_session(
  session_id_input uuid,
  actor_discord_user_id_input text,
  verification_basis_input text
)
returns jsonb as $$
declare
  selected_session runecloak_sessions%rowtype;
  selected_stage runecloak_stages%rowtype;
  selected_cycle runecloak_cycles%rowtype;
  verified_at_value timestamptz := now();
  verified_session_count integer;
begin
  if verification_basis_input not in ('present', 'recording_review') then
    raise exception 'Session verification basis must be present or recording_review.';
  end if;

  select * into selected_session
  from runecloak_sessions where id = session_id_input for update;
  if not found or selected_session.status <> 'Submitted' then
    raise exception 'Submit the complete session record before verifying it.';
  end if;

  select * into selected_stage
  from runecloak_stages where id = selected_session.stage_id for update;
  if not found or selected_stage.status <> 'Open' then
    raise exception 'The paired stage is not open for session verification.';
  end if;
  if selected_session.actual_at is null
     or selected_session.research_site_id is null
     or selected_session.leader_discord_user_id is null
     or nullif(btrim(selected_session.lesson_summary), '') is null
     or nullif(btrim(selected_session.study_method), '') is null
     or nullif(btrim(selected_session.recording_url), '') is null then
    raise exception 'The session record is missing required fieldwork or recording details.';
  end if;

  select * into selected_cycle
  from runecloak_cycles where id = selected_stage.cycle_id;

  update runecloak_session_participation
  set status = 'verified',
      verified_by_discord_user_id = actor_discord_user_id_input,
      verified_at = verified_at_value
  where session_id = selected_session.id and status = 'provisional';

  update runecloak_sessions
  set status = 'Verified',
      verified_by_discord_user_id = actor_discord_user_id_input,
      verification_basis = verification_basis_input,
      verified_at = verified_at_value
  where id = selected_session.id
  returning * into selected_session;

  select count(*) into verified_session_count
  from runecloak_sessions where stage_id = selected_stage.id and status = 'Verified';
  if verified_session_count = 2 then
    update runecloak_stages set status = 'Ready for Review' where id = selected_stage.id;
    perform verify_runecloak_stage(
      selected_stage.id,
      actor_discord_user_id_input,
      'Automatically evaluated when both regional session records were verified.'
    );
  end if;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id, after_snapshot
  ) values (
    selected_cycle.guild_id, 'session', selected_session.id, 'session_verified',
    actor_discord_user_id_input,
    jsonb_build_object(
      'stage_id', selected_stage.id,
      'slot', selected_session.regional_slot,
      'basis', verification_basis_input
    )
  );

  return to_jsonb(selected_session);
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
  select cycle.* into selected_cycle
  from runecloak_cycles cycle
  join runecloak_stages stage on stage.cycle_id = cycle.id
  where stage.id = stage_id_input
  for update of cycle;
  if not found then
    raise exception 'Runecloak stage not found.';
  end if;

  select * into selected_stage from runecloak_stages where id = stage_id_input for update;
  if selected_cycle.status not in ('Active', 'Awaiting GM Approval') then
    raise exception 'The cycle is not active.';
  end if;
  if selected_stage.status not in ('Open', 'Ready for Review') then
    raise exception 'Only an open paired stage may be verified.';
  end if;
  if selected_stage.eligible_learner_count < 1
     or selected_stage.required_unique_attendance < 1
     or not exists (
       select 1 from runecloak_stage_eligible_learners eligible
       where eligible.stage_id = stage_id_input
     ) then
    raise exception 'The paired stage does not have a valid learner eligibility set.';
  end if;

  select count(*) into verified_session_count
  from runecloak_sessions where stage_id = stage_id_input and status = 'Verified';
  if verified_session_count <> 2 then
    raise exception 'Both EU and NA sessions must be verified first.';
  end if;

  select count(distinct participation.ranger_id) into attendance_count
  from runecloak_session_participation participation
  join runecloak_stage_eligible_learners eligible
    on eligible.stage_id = participation.stage_id
   and eligible.ranger_id = participation.ranger_id
  where participation.stage_id = stage_id_input
    and participation.participation_kind = 'learner'
    and participation.status = 'verified';

  select coalesce(sum(accepted_roll), 0) into stage_points
  from (
    select participation.ranger_id, max(participation.roll_value) as accepted_roll
    from runecloak_session_participation participation
    join runecloak_stage_eligible_learners eligible
      on eligible.stage_id = participation.stage_id
     and eligible.ranger_id = participation.ranger_id
    where participation.stage_id = stage_id_input
      and participation.participation_kind = 'learner'
      and participation.status = 'verified'
      and participation.roll_value is not null
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

  if resulting_status = 'Valid' then
    if exists (
      select 1
      from runecloak_session_participation participation
      join runecloak_spells spell on spell.id = participation.study_spell_id
      where participation.stage_id = stage_id_input
        and participation.participation_kind = 'learner'
        and participation.status = 'verified'
        and participation.roll_value is not null
        and spell.prerequisite_spell_id is not null
        and not exists (
          select 1 from runecloak_spell_progress prerequisite
          where prerequisite.ranger_id = participation.ranger_id
            and prerequisite.spell_id = spell.prerequisite_spell_id
            and prerequisite.status = 'completed'
          )
    ) then
      raise exception 'A learner roll targets a spell whose prerequisite is incomplete.';
    end if;

    insert into runecloak_personal_study_credits (
      ranger_id, spell_id, stage_id, participation_id, verified_points,
      verified_by_discord_user_id
    )
    select
      participation.ranger_id,
      participation.study_spell_id,
      stage_id_input,
      participation.id,
      participation.roll_value,
      actor_discord_user_id_input
    from runecloak_session_participation participation
    join runecloak_stage_eligible_learners eligible
      on eligible.stage_id = participation.stage_id
     and eligible.ranger_id = participation.ranger_id
    where participation.stage_id = stage_id_input
      and participation.participation_kind = 'learner'
      and participation.status = 'verified'
      and participation.roll_value is not null
      and participation.study_spell_id is not null;
  end if;

  insert into runecloak_spell_progress (
    ranger_id, spell_id, required_points, required_valid_stages,
    verified_points, verified_valid_stages, status
  )
  select
    credit.ranger_id,
    credit.spell_id,
    settings.personal_point_requirement,
    settings.personal_stage_requirement,
    sum(credit.verified_points)::integer,
    count(distinct credit.stage_id)::integer,
    case
      when sum(credit.verified_points) >= settings.personal_point_requirement
       and count(distinct credit.stage_id) >= settings.personal_stage_requirement
      then 'eligible'
      else 'in_progress'
    end
  from runecloak_personal_study_credits credit
  join runecloak_stages credit_stage on credit_stage.id = credit.stage_id
  join runecloak_cycles credit_cycle on credit_cycle.id = credit_stage.cycle_id
  join runecloak_settings settings on settings.guild_id = credit_cycle.guild_id
  group by credit.ranger_id, credit.spell_id,
    settings.personal_point_requirement, settings.personal_stage_requirement
  on conflict (ranger_id, spell_id) do nothing;

  update runecloak_spell_progress progress
  set verified_points = coalesce((
        select sum(credit.verified_points)::integer
        from runecloak_personal_study_credits credit
        where credit.ranger_id = progress.ranger_id and credit.spell_id = progress.spell_id
      ), 0),
      verified_valid_stages = coalesce((
        select count(distinct credit.stage_id)::integer
        from runecloak_personal_study_credits credit
        where credit.ranger_id = progress.ranger_id and credit.spell_id = progress.spell_id
      ), 0),
      status = case
        when progress.status = 'completed' then 'completed'
        when coalesce((
          select sum(credit.verified_points)::integer
          from runecloak_personal_study_credits credit
          where credit.ranger_id = progress.ranger_id and credit.spell_id = progress.spell_id
        ), 0) >= progress.required_points
        and coalesce((
          select count(distinct credit.stage_id)::integer
          from runecloak_personal_study_credits credit
          where credit.ranger_id = progress.ranger_id and credit.spell_id = progress.spell_id
        ), 0) >= progress.required_valid_stages
        then 'eligible'
        else 'in_progress'
      end,
      updated_at = now();

  select coalesce(sum(verified_points), 0) into cycle_points
  from runecloak_stages
  where cycle_id = selected_stage.cycle_id and status = 'Valid';

  update runecloak_cycles
  set verified_points = cycle_points,
      status = case
        when cycle_points >= point_target then 'Awaiting GM Approval'
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


create or replace function record_runecloak_spell_delivery(
  guild_id_input text,
  ranger_id_input uuid,
  spell_id_input uuid,
  delivery_reference_input text,
  actor_discord_user_id_input text
)
returns jsonb as $$
declare
  selected_membership runecloak_memberships%rowtype;
  selected_progress runecloak_spell_progress%rowtype;
  selected_unlock runecloak_spell_unlocks%rowtype;
  selected_spell runecloak_spells%rowtype;
  qualification_id_value uuid;
  newly_completed boolean;
begin
  if nullif(btrim(delivery_reference_input), '') is null then
    raise exception 'A GM ticket or in-game delivery reference is required.';
  end if;

  select * into selected_membership
  from runecloak_memberships
  where guild_id = guild_id_input
    and ranger_id = ranger_id_input
    and status in ('Learner', 'Qualified')
  for update;
  if not found then
    raise exception 'The Ranger is not an active Runecloak learner.';
  end if;
  if not exists (
    select 1 from rangers ranger
    where ranger.id = ranger_id_input
      and ranger.status = 'Active'
      and ranger.current_rank in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander')
  ) then
    raise exception 'The Runecloak learner must still be an active Ranger or higher.';
  end if;

  select * into selected_progress
  from runecloak_spell_progress
  where ranger_id = ranger_id_input and spell_id = spell_id_input
  for update;
  if not found or (
    selected_progress.status <> 'completed' and (
      selected_progress.status <> 'eligible'
      or selected_progress.verified_points < selected_progress.required_points
      or selected_progress.verified_valid_stages < selected_progress.required_valid_stages
    )
  ) then
    raise exception 'The Ranger has not completed the personal point and expedition requirements for this spell.';
  end if;
  newly_completed := selected_progress.status <> 'completed';

  select * into selected_spell from runecloak_spells where id = spell_id_input;
  if not found then
    raise exception 'Runecloak spell not found.';
  end if;
  if selected_spell.prerequisite_spell_id is not null and not exists (
    select 1 from runecloak_spell_progress prerequisite
    where prerequisite.ranger_id = ranger_id_input
      and prerequisite.spell_id = selected_spell.prerequisite_spell_id
      and prerequisite.status = 'completed'
  ) then
    raise exception 'The Ranger has not completed the prerequisite spell.';
  end if;

  select * into selected_unlock
  from runecloak_spell_unlocks
  where guild_id = guild_id_input and spell_id = spell_id_input;
  if not found then
    raise exception 'This spell has not been globally unlocked for the guild.';
  end if;

  if selected_progress.status <> 'completed' then
    update runecloak_spell_progress
    set status = 'completed',
        completion_cycle_id = selected_unlock.source_cycle_id,
        unlock_id = selected_unlock.id,
        delivery_reference = btrim(delivery_reference_input),
        delivery_recorded_by_discord_user_id = actor_discord_user_id_input,
        delivered_at = now()
    where ranger_id = ranger_id_input and spell_id = spell_id_input;

    select id into qualification_id_value
    from corps_qualifications where slug = 'ranger-runecloak';

    insert into ranger_qualifications (
      qualification_id, ranger_id, source_cycle_id, awarded_by_discord_user_id
    ) values (
      qualification_id_value, ranger_id_input, selected_unlock.source_cycle_id,
      actor_discord_user_id_input
    ) on conflict do nothing;

    update runecloak_memberships
    set status = 'Qualified',
        first_qualified_spell_id = coalesce(first_qualified_spell_id, spell_id_input),
        first_qualified_at = coalesce(first_qualified_at, now()),
        status_changed_by_discord_user_id = actor_discord_user_id_input,
        status_changed_at = now()
    where id = selected_membership.id;

    update runecloak_cycle_members
    set participation_status = 'Completed',
        final_result = 'Delivered in game by a GM',
        spell_delivered_at = now(),
        status_changed_by_discord_user_id = actor_discord_user_id_input,
        status_changed_at = now()
    where cycle_id = selected_unlock.source_cycle_id
      and ranger_id = ranger_id_input;

    insert into runecloak_audit_events (
      guild_id, entity_type, entity_id, action, actor_discord_user_id,
      reason, after_snapshot
    ) values (
      guild_id_input, 'spell_progress', ranger_id_input, 'personal_spell_delivered',
      actor_discord_user_id_input, btrim(delivery_reference_input),
      jsonb_build_object(
        'ranger_id', ranger_id_input,
        'spell_id', spell_id_input,
        'cycle_id', selected_unlock.source_cycle_id,
        'unlock_id', selected_unlock.id,
        'delivery_reference', btrim(delivery_reference_input),
        'verified_points', selected_progress.verified_points,
        'verified_valid_stages', selected_progress.verified_valid_stages
      )
    );
  end if;

  return jsonb_build_object(
    'ranger_id', ranger_id_input,
    'spell_id', spell_id_input,
    'status', 'completed',
    'unlock_id', selected_unlock.id,
    'unlock_reference', selected_unlock.unlock_reference,
    'source_cycle_id', selected_unlock.source_cycle_id,
    'delivery_reference', coalesce(selected_progress.delivery_reference, btrim(delivery_reference_input)),
    'newly_completed', newly_completed
  );
end;
$$ language plpgsql;

create or replace function set_runecloak_cycle_member_status(
  guild_id_input text,
  cycle_id_input uuid,
  ranger_id_input uuid,
  status_input text,
  reason_input text,
  actor_discord_user_id_input text
)
returns jsonb as $$
declare
  selected_cycle runecloak_cycles%rowtype;
  selected_cycle_member runecloak_cycle_members%rowtype;
  selected_membership runecloak_memberships%rowtype;
  prior_cycle_member_status text;
  prior_membership_status text;
begin
  if status_input not in ('Withdrawn', 'Ineligible') then
    raise exception 'Runecloak membership status must be Withdrawn or Ineligible.';
  end if;
  if nullif(btrim(reason_input), '') is null then
    raise exception 'A reason is required when excluding a Runecloak learner.';
  end if;

  select * into selected_cycle
  from runecloak_cycles
  where id = cycle_id_input and guild_id = guild_id_input
  for update;
  if not found or selected_cycle.status not in ('Awaiting Moonshadow Start', 'Active', 'Awaiting GM Approval') then
    raise exception 'Choose an unfinished Runecloak campaign in this guild.';
  end if;

  select * into selected_cycle_member
  from runecloak_cycle_members
  where cycle_id = selected_cycle.id and ranger_id = ranger_id_input
  for update;
  if not found then
    raise exception 'That Ranger is not recorded in the selected Runecloak campaign.';
  end if;

  select * into selected_membership
  from runecloak_memberships
  where guild_id = selected_cycle.guild_id and ranger_id = selected_cycle_member.ranger_id
  for update;
  if not found or selected_membership.status not in ('Learner', 'Qualified') then
    raise exception 'That Ranger is not an active Runecloak learner or qualified Runecloak.';
  end if;

  prior_cycle_member_status := selected_cycle_member.participation_status;
  prior_membership_status := selected_membership.status;

  update runecloak_memberships
  set status = status_input,
      status_reason = btrim(reason_input),
      status_changed_by_discord_user_id = actor_discord_user_id_input,
      status_changed_at = now()
  where id = selected_membership.id
  returning * into selected_membership;

  update runecloak_cycle_members
  set participation_status = status_input,
      status_reason = btrim(reason_input),
      status_changed_by_discord_user_id = actor_discord_user_id_input,
      status_changed_at = now()
  where id = selected_cycle_member.id
  returning * into selected_cycle_member;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id,
    reason, before_snapshot, after_snapshot
  ) values
  (
    selected_cycle.guild_id,
    'membership',
    selected_membership.id,
    'membership_' || lower(status_input),
    actor_discord_user_id_input,
    btrim(reason_input),
    jsonb_build_object('status', prior_membership_status),
    jsonb_build_object('status', selected_membership.status)
  ),
  (
    selected_cycle.guild_id,
    'cycle_member',
    selected_cycle_member.id,
    'learner_' || lower(status_input),
    actor_discord_user_id_input,
    btrim(reason_input),
    jsonb_build_object('status', prior_cycle_member_status, 'cycle_id', selected_cycle.id),
    jsonb_build_object('status', selected_cycle_member.participation_status, 'cycle_id', selected_cycle.id)
  );

  return jsonb_build_object(
    'membership_id', selected_membership.id,
    'cycle_member_id', selected_cycle_member.id,
    'status', selected_membership.status
  );
end;
$$ language plpgsql;

create or replace function complete_runecloak_cycle(
  cycle_id_input uuid,
  actor_discord_user_id_input text,
  gm_approval_reference_input text
)
returns jsonb as $$
declare
  selected_cycle runecloak_cycles%rowtype;
  selected_unlock runecloak_spell_unlocks%rowtype;
  eligible_count integer := 0;
begin
  if nullif(btrim(gm_approval_reference_input), '') is null then
    raise exception 'A GM ticket or approval reference is required.';
  end if;

  select * into selected_cycle
  from runecloak_cycles where id = cycle_id_input for update;
  if not found then
    raise exception 'Runecloak campaign not found.';
  end if;
  if selected_cycle.status <> 'Awaiting GM Approval'
     or selected_cycle.verified_points < selected_cycle.point_target then
    raise exception 'The campaign has not reached its verified target.';
  end if;

  insert into runecloak_spell_unlocks (
    guild_id, spell_id, source_cycle_id, unlock_reference,
    unlocked_by_discord_user_id
  ) values (
    selected_cycle.guild_id, selected_cycle.spell_id, selected_cycle.id,
    btrim(gm_approval_reference_input), actor_discord_user_id_input
  )
  on conflict (guild_id, spell_id) do nothing;

  select * into selected_unlock
  from runecloak_spell_unlocks
  where guild_id = selected_cycle.guild_id and spell_id = selected_cycle.spell_id
  for update;
  if selected_unlock.source_cycle_id <> selected_cycle.id
     or selected_unlock.unlock_reference <> btrim(gm_approval_reference_input) then
    raise exception 'This guild spell already has a different immutable unlock record.';
  end if;

  select count(*) into eligible_count
  from runecloak_spell_progress progress
  join runecloak_memberships membership
    on membership.ranger_id = progress.ranger_id
   and membership.guild_id = selected_cycle.guild_id
   and membership.status in ('Learner', 'Qualified')
  join rangers ranger
    on ranger.id = progress.ranger_id
   and ranger.status = 'Active'
   and ranger.current_rank in ('Ranger', 'Ranger Marshal', 'Ranger Captain', 'Ranger Commander')
  where progress.spell_id = selected_cycle.spell_id
    and progress.status = 'eligible'
    and progress.verified_points >= progress.required_points
    and progress.verified_valid_stages >= progress.required_valid_stages;

  update runecloak_cycle_members member
  set final_valid_stages_attended = progress.verified_valid_stages,
      final_required_attendance = progress.required_valid_stages,
      final_contributed_points = progress.verified_points,
      participation_status = case
        when member.participation_status in ('Withdrawn', 'Ineligible') then member.participation_status
        when progress.status = 'completed' then 'Completed'
        when progress.status = 'eligible' then 'Eligible for Delivery'
        else 'Study Incomplete'
      end,
      final_result = case
        when member.participation_status = 'Withdrawn' then 'Withdrawn before shared research approval'
        when member.participation_status = 'Ineligible' then 'Ineligible at shared research approval'
        when progress.status = 'completed' then 'Delivered in game by a GM'
        when progress.status = 'eligible' then 'Eligible; awaiting in-game GM delivery'
        else 'Personal study continues'
      end,
      spell_delivered_at = progress.delivered_at
  from runecloak_spell_progress progress
  where member.cycle_id = selected_cycle.id
    and progress.ranger_id = member.ranger_id
    and progress.spell_id = selected_cycle.spell_id;

  update runecloak_cycle_members member
  set final_valid_stages_attended = 0,
      final_contributed_points = 0,
      participation_status = case
        when member.participation_status in ('Withdrawn', 'Ineligible') then member.participation_status
        else 'Study Incomplete'
      end,
      final_result = case
        when member.participation_status = 'Withdrawn' then 'Withdrawn before shared research approval'
        when member.participation_status = 'Ineligible' then 'Ineligible at shared research approval'
        else 'Personal study continues'
      end
  where member.cycle_id = selected_cycle.id
    and not exists (
      select 1 from runecloak_spell_progress progress
      where progress.ranger_id = member.ranger_id
        and progress.spell_id = selected_cycle.spell_id
    );

  update runecloak_cycles
  set status = 'Completed',
      gm_approval_reference = selected_unlock.unlock_reference,
      gm_approval_recorded_by_discord_user_id = actor_discord_user_id_input,
      gm_approval_recorded_at = now(),
      completed_at = now()
  where id = selected_cycle.id;

  insert into runecloak_audit_events (
    guild_id, entity_type, entity_id, action, actor_discord_user_id,
    reason, after_snapshot
  ) values (
    selected_cycle.guild_id, 'cycle', selected_cycle.id, 'campaign_gm_approval_recorded',
    actor_discord_user_id_input, selected_unlock.unlock_reference,
    jsonb_build_object(
      'spell_id', selected_cycle.spell_id,
      'unlock_id', selected_unlock.id,
      'eligible_learners', eligible_count,
      'verified_points', selected_cycle.verified_points
    )
  );

  return jsonb_build_object(
    'unlock_id', selected_unlock.id,
    'eligible_learners', eligible_count,
    'verified_points', selected_cycle.verified_points
  );
end;
$$ language plpgsql;

create or replace function runecloak_regional_slot_available_at(
  guild_id_input text,
  regional_slot_input text,
  exclude_session_id_input uuid default null
)
returns timestamptz as $$
declare
  latest_cooldown_end timestamptz;
begin
  if regional_slot_input not in ('EU', 'NA') then
    raise exception 'Regional slot must be EU or NA.';
  end if;

  select max(session.regional_cooldown_ends_at) into latest_cooldown_end
  from runecloak_sessions session
  join runecloak_stages stage on stage.id = session.stage_id
  join runecloak_cycles cycle on cycle.id = stage.cycle_id
  where cycle.guild_id = guild_id_input
    and session.regional_slot = regional_slot_input
    and session.status in ('Submitted', 'Verified')
    and session.id <> coalesce(exclude_session_id_input, '00000000-0000-0000-0000-000000000000'::uuid);

  return latest_cooldown_end;
end;
$$ language plpgsql stable;

create or replace function set_runecloak_session_regional_cooldown()
returns trigger as $$
declare
  configured_hours integer;
begin
  if new.actual_at is null then
    new.regional_cooldown_ends_at := null;
    return new;
  end if;

  select settings.regional_cooldown_hours into configured_hours
  from runecloak_stages stage
  join runecloak_cycles cycle on cycle.id = stage.cycle_id
  join runecloak_settings settings on settings.guild_id = cycle.guild_id
  where stage.id = new.stage_id;

  new.regional_cooldown_ends_at := new.actual_at + make_interval(hours => coalesce(configured_hours, 72));
  return new;
end;
$$ language plpgsql;

create or replace function enforce_runecloak_session_regional_cooldown()
returns trigger as $$
declare
  session_guild_id text;
  available_at timestamptz;
begin
  if new.status not in ('Submitted', 'Verified') or new.actual_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'Submitted'
     and new.status = 'Verified'
     and new.actual_at is not distinct from old.actual_at
     and new.stage_id is not distinct from old.stage_id
     and new.regional_slot is not distinct from old.regional_slot then
    return new;
  end if;

  select cycle.guild_id into session_guild_id
  from runecloak_stages stage
  join runecloak_cycles cycle on cycle.id = stage.cycle_id
  where stage.id = new.stage_id;

  perform pg_advisory_xact_lock(
    hashtextextended('runecloak-regional-cooldown:' || session_guild_id || ':' || new.regional_slot, 0)
  );

  available_at := runecloak_regional_slot_available_at(
    session_guild_id,
    new.regional_slot,
    new.id
  );
  if available_at is not null and new.actual_at < available_at then
    raise exception '% Runecloak expeditions are on cooldown until %.', new.regional_slot, available_at;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists set_runecloak_session_cooldown on runecloak_sessions;
create trigger set_runecloak_session_cooldown
before insert or update of actual_at, stage_id on runecloak_sessions
for each row execute function set_runecloak_session_regional_cooldown();

drop trigger if exists enforce_runecloak_session_cooldown on runecloak_sessions;
create trigger enforce_runecloak_session_cooldown
before insert or update of actual_at, stage_id, regional_slot, status on runecloak_sessions
for each row execute function enforce_runecloak_session_regional_cooldown();

comment on column runecloak_settings.guide_role_id is
'Discord role ID for Runecloak Guides, who operate admissions, reviews, expeditions, and verification.';
