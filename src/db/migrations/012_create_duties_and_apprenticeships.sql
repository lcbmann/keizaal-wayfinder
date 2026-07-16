do $$ begin
  create type duty_application_status as enum ('Pending', 'Approved', 'Denied', 'Withdrawn');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type duty_assignment_status as enum ('Active', 'Ended');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type apprenticeship_seeking_type as enum ('Mentor', 'Apprentice');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type apprenticeship_status as enum ('Proposed', 'Pending Marshal', 'Active', 'Declined', 'Ended');
exception when duplicate_object then null;
end $$;

create table if not exists corps_duties (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text unique not null,
  description text not null,
  discord_role_id text unique,
  max_active_holders integer check (max_active_holders is null or max_active_holders > 0),
  requires_detail boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into corps_duties (slug, name, description, max_active_holders, requires_detail)
values
  ('quartermaster', 'Quartermaster', 'Manages Corps supplies and storage.', 1, false),
  ('craftsman', 'Craftsman', 'Supports the Corps through crafting and production.', null, false),
  ('warden', 'Warden', 'Watches over an assigned Range or region.', null, true),
  ('detective', 'Detective', 'Handles investigations and gathers evidence.', null, false),
  ('courier', 'Courier', 'Carries messages and information across Skyrim.', null, false)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  max_active_holders = excluded.max_active_holders,
  requires_detail = excluded.requires_detail,
  active = true;

create table if not exists duty_applications (
  id uuid primary key default gen_random_uuid(),
  duty_id uuid not null references corps_duties(id) on delete restrict,
  applicant_ranger_id uuid not null references rangers(id) on delete cascade,
  status duty_application_status not null default 'Pending',
  reason text not null,
  assignment_detail text,
  reviewed_by_discord_user_id text,
  reviewed_at timestamptz,
  strongbox_channel_id text,
  strongbox_message_id text,
  strongbox_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ranger_duty_assignments (
  id uuid primary key default gen_random_uuid(),
  duty_id uuid not null references corps_duties(id) on delete restrict,
  ranger_id uuid not null references rangers(id) on delete cascade,
  application_id uuid references duty_applications(id) on delete set null,
  status duty_assignment_status not null default 'Active',
  assignment_detail text,
  assigned_by_discord_user_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apprenticeship_preferences (
  discord_user_id text primary key,
  seeking apprenticeship_seeking_type not null,
  note text,
  strongbox_channel_id text,
  strongbox_message_id text,
  strongbox_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists apprenticeships (
  id uuid primary key default gen_random_uuid(),
  mentor_discord_user_id text not null,
  apprentice_discord_user_id text not null,
  status apprenticeship_status not null,
  proposed_by_discord_user_id text not null,
  sponsor_reason text,
  reviewed_by_discord_user_id text,
  reviewed_at timestamptz,
  accepted_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  strongbox_channel_id text,
  strongbox_message_id text,
  strongbox_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mentor_discord_user_id <> apprentice_discord_user_id)
);

drop trigger if exists set_corps_duties_updated_at on corps_duties;
create trigger set_corps_duties_updated_at
before update on corps_duties
for each row execute function set_updated_at();

drop trigger if exists set_duty_applications_updated_at on duty_applications;
create trigger set_duty_applications_updated_at
before update on duty_applications
for each row execute function set_updated_at();

drop trigger if exists set_ranger_duty_assignments_updated_at on ranger_duty_assignments;
create trigger set_ranger_duty_assignments_updated_at
before update on ranger_duty_assignments
for each row execute function set_updated_at();

drop trigger if exists set_apprenticeship_preferences_updated_at on apprenticeship_preferences;
create trigger set_apprenticeship_preferences_updated_at
before update on apprenticeship_preferences
for each row execute function set_updated_at();

drop trigger if exists set_apprenticeships_updated_at on apprenticeships;
create trigger set_apprenticeships_updated_at
before update on apprenticeships
for each row execute function set_updated_at();

create unique index if not exists duty_applications_one_pending_per_ranger_duty
on duty_applications(applicant_ranger_id, duty_id)
where status = 'Pending';

create unique index if not exists ranger_duty_assignments_one_active_per_ranger_duty
on ranger_duty_assignments(ranger_id, duty_id)
where status = 'Active';

create index if not exists ranger_duty_assignments_active_duty_idx
on ranger_duty_assignments(duty_id, started_at)
where status = 'Active';

create unique index if not exists apprenticeships_one_current_per_apprentice
on apprenticeships(apprentice_discord_user_id)
where status in ('Proposed', 'Pending Marshal', 'Active');

create index if not exists apprenticeships_mentor_status_idx
on apprenticeships(mentor_discord_user_id, status);
