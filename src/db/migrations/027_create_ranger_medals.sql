create table if not exists corps_medals (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text unique not null,
  description text not null,
  emoji text,
  discord_role_id text unique,
  active boolean not null default true,
  created_by_discord_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ranger_medal_awards (
  id uuid primary key default gen_random_uuid(),
  medal_id uuid not null references corps_medals(id) on delete cascade,
  ranger_id uuid not null references rangers(id) on delete cascade,
  awarded_by_discord_user_id text not null,
  reason text,
  awarded_at timestamptz not null default now(),
  unique (medal_id, ranger_id)
);

insert into corps_medals (
  slug,
  name,
  description,
  emoji,
  created_by_discord_user_id
)
values (
  'mentor',
  'Mentor',
  'Awarded to Rangers who have taken responsibility for an Apprentice.',
  U&'\+01F393',
  'system'
)
on conflict (slug) do update
set description = excluded.description,
    updated_at = now();

drop trigger if exists set_corps_medals_updated_at on corps_medals;
create trigger set_corps_medals_updated_at
before update on corps_medals
for each row execute function set_updated_at();

create index if not exists corps_medals_active_idx on corps_medals(active, name);
create index if not exists ranger_medal_awards_ranger_idx on ranger_medal_awards(ranger_id, awarded_at);
