do $$ begin
  create type field_name_contest_status as enum ('Open', 'Approved', 'Denied', 'Cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists field_name_contests (
  id uuid primary key default gen_random_uuid(),
  target_discord_user_id text not null,
  opened_by_discord_user_id text not null,
  status field_name_contest_status not null default 'Open',
  reason text,
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  decided_at timestamptz,
  decision_reason text,
  discord_channel_id text,
  discord_message_id text,
  discord_thread_id text,
  nominee_veto_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists field_name_open_contest_per_target_idx
  on field_name_contests(target_discord_user_id)
  where status = 'Open';

create index if not exists field_name_contests_status_idx
  on field_name_contests(status, closes_at);

create table if not exists field_name_options (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references field_name_contests(id) on delete cascade,
  proposed_name text not null,
  reason text not null,
  nominated_by_discord_user_id text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists field_name_option_name_idx
  on field_name_options(contest_id, lower(proposed_name));

create index if not exists field_name_options_contest_idx
  on field_name_options(contest_id, created_at);

create table if not exists field_name_contest_votes (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references field_name_contests(id) on delete cascade,
  option_id uuid not null references field_name_options(id) on delete cascade,
  voter_discord_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contest_id, voter_discord_user_id)
);

create index if not exists field_name_contest_votes_option_idx
  on field_name_contest_votes(option_id);

alter table ranger_field_names
add column if not exists assigned_by_contest_id uuid references field_name_contests(id) on delete set null;

drop trigger if exists field_name_contests_updated_at on field_name_contests;
create trigger field_name_contests_updated_at
before update on field_name_contests
for each row execute function set_updated_at();

drop trigger if exists field_name_contest_votes_updated_at on field_name_contest_votes;
create trigger field_name_contest_votes_updated_at
before update on field_name_contest_votes
for each row execute function set_updated_at();
