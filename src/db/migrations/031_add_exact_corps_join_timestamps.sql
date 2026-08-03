alter table rangers
add column if not exists joined_at timestamptz;

alter table historical_corps_members
add column if not exists joined_at timestamptz;

create index if not exists rangers_joined_at_idx
  on rangers(joined_at);

create index if not exists historical_corps_members_joined_at_idx
  on historical_corps_members(joined_at);
