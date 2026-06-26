create extension if not exists "pgcrypto";

do $$ begin
  create type ranger_rank as enum (
    'Ranger Commander',
    'Ranger Captain',
    'Ranger Marshal',
    'Ranger',
    'Apprentice'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type ranger_status as enum ('Active', 'Inactive', 'On Leave', 'Retired');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type promotion_vote_status as enum ('Open', 'Closed', 'Approved', 'Denied');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type promotion_ballot_vote as enum ('promote', 'hold', 'abstain');
exception when duplicate_object then null;
end $$;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists rangers (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text unique not null,
  discord_username text,
  discord_display_name text,
  in_game_name text,
  current_rank ranger_rank not null,
  status ranger_status not null default 'Active',
  join_date date not null,
  last_promotion_date date,
  assigned_hold text,
  notes text,
  last_discord_activity_at timestamptz,
  last_bot_interaction_at timestamptz,
  created_by_discord_user_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists rank_history (
  id uuid primary key default gen_random_uuid(),
  ranger_id uuid not null references rangers(id) on delete cascade,
  old_rank ranger_rank,
  new_rank ranger_rank not null,
  changed_by_discord_user_id text not null,
  reason text,
  created_at timestamptz default now()
);

create table if not exists trailmarks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  hold text not null,
  location_description text not null,
  screenshot_url text,
  discord_channel_id text unique not null,
  atlas_location_id uuid,
  active boolean default true,
  created_by_discord_user_id text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists trailmark_sessions (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  trailmark_id uuid not null references trailmarks(id) on delete cascade,
  discord_channel_id text not null,
  expires_at timestamptz not null,
  active boolean default true,
  created_at timestamptz default now()
);

create unique index if not exists trailmark_sessions_one_active_per_user
on trailmark_sessions(discord_user_id)
where active = true;

create table if not exists promotion_votes (
  id uuid primary key default gen_random_uuid(),
  candidate_ranger_id uuid not null references rangers(id) on delete cascade,
  target_rank ranger_rank not null,
  status promotion_vote_status not null default 'Open',
  opened_by_discord_user_id text not null,
  message_id text,
  channel_id text,
  final_decision text,
  created_at timestamptz default now(),
  closed_at timestamptz
);

create table if not exists promotion_vote_ballots (
  id uuid primary key default gen_random_uuid(),
  promotion_vote_id uuid not null references promotion_votes(id) on delete cascade,
  voter_discord_user_id text not null,
  vote promotion_ballot_vote not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (promotion_vote_id, voter_discord_user_id)
);

create table if not exists member_activity_events (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  event_type text not null,
  channel_id text,
  created_at timestamptz default now()
);

drop trigger if exists set_rangers_updated_at on rangers;
create trigger set_rangers_updated_at
before update on rangers
for each row execute function set_updated_at();

drop trigger if exists set_trailmarks_updated_at on trailmarks;
create trigger set_trailmarks_updated_at
before update on trailmarks
for each row execute function set_updated_at();

drop trigger if exists set_promotion_vote_ballots_updated_at on promotion_vote_ballots;
create trigger set_promotion_vote_ballots_updated_at
before update on promotion_vote_ballots
for each row execute function set_updated_at();

create index if not exists rangers_current_rank_idx on rangers(current_rank);
create index if not exists rangers_status_idx on rangers(status);
create index if not exists trailmarks_active_idx on trailmarks(active);
create index if not exists promotion_votes_status_idx on promotion_votes(status);
create index if not exists member_activity_events_user_created_idx on member_activity_events(discord_user_id, created_at desc);
