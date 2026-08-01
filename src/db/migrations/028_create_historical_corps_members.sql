create table if not exists historical_corps_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  discord_username text,
  join_date date not null,
  source text not null default 'Legacy roster',
  created_at timestamptz not null default now()
);

create unique index if not exists historical_corps_members_username_idx
  on historical_corps_members(lower(discord_username))
  where discord_username is not null;

insert into historical_corps_members (display_name, discord_username, join_date)
values
  ('Rojin', 'blackular', '2026-06-02'),
  ('Ivar Fulis', 'lastdweller', '2026-06-09'),
  ('Rattan', 'rat_with_teeth', '2026-06-19')
on conflict do nothing;
