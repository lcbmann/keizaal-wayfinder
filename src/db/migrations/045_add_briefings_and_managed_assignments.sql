create table if not exists briefing_dispatches (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  kind text not null default 'ic' check (kind in ('ic', 'ooc')),
  audience text not null check (
    audience in ('everyone', 'apprentice_plus', 'ranger_plus', 'marshal_plus', 'captain_plus', 'individual')
  ),
  target_discord_user_id text,
  title text not null,
  body text not null,
  source_kind text,
  source_id text,
  source_url text,
  author_discord_user_id text,
  created_at timestamptz not null default now(),
  check (
    (audience = 'individual' and target_discord_user_id is not null)
    or (audience <> 'individual' and target_discord_user_id is null)
  ),
  unique (guild_id, source_kind, source_id)
);

create table if not exists briefing_user_settings (
  guild_id text not null,
  discord_user_id text not null,
  dm_enabled boolean not null default true,
  last_collected_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (guild_id, discord_user_id)
);

create table if not exists managed_assignments (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  forum_channel_id text not null,
  thread_id text,
  starter_message_id text,
  title text not null,
  objective text not null,
  details text,
  location text not null,
  hold text,
  timing text,
  minimum_rank text not null default 'Apprentice' check (minimum_rank in ('Apprentice', 'Ranger')),
  organizer_discord_user_id text not null,
  status text not null default 'Open' check (status in ('Open', 'Completed', 'Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists managed_assignment_participants (
  assignment_id uuid not null references managed_assignments(id) on delete cascade,
  discord_user_id text not null,
  joined_at timestamptz not null default now(),
  primary key (assignment_id, discord_user_id)
);

alter table briefing_dispatches enable row level security;
alter table briefing_user_settings enable row level security;
alter table managed_assignments enable row level security;
alter table managed_assignment_participants enable row level security;

drop trigger if exists set_briefing_user_settings_updated_at on briefing_user_settings;
create trigger set_briefing_user_settings_updated_at
before update on briefing_user_settings
for each row execute function set_updated_at();

drop trigger if exists set_managed_assignments_updated_at on managed_assignments;
create trigger set_managed_assignments_updated_at
before update on managed_assignments
for each row execute function set_updated_at();

create index if not exists briefing_dispatches_audience_created_idx
on briefing_dispatches(guild_id, audience, created_at desc);

create index if not exists briefing_dispatches_target_created_idx
on briefing_dispatches(guild_id, target_discord_user_id, created_at desc)
where target_discord_user_id is not null;

create index if not exists managed_assignments_status_created_idx
on managed_assignments(guild_id, status, created_at desc);

create index if not exists managed_assignment_participants_user_idx
on managed_assignment_participants(discord_user_id, joined_at desc);
