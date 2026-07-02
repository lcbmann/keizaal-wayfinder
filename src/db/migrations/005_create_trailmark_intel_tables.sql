create table if not exists intel_settings (
  id boolean primary key default true,
  hq_trailmark_id uuid references trailmarks(id) on delete set null,
  updated_at timestamptz default now(),
  constraint intel_settings_singleton check (id = true)
);

insert into intel_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists intel_topics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  keywords text[] not null default '{}',
  discord_channel_id text not null,
  active boolean not null default true,
  created_by_discord_user_id text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists intel_reports (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references intel_topics(id) on delete cascade,
  trailmark_id uuid not null references trailmarks(id) on delete cascade,
  discord_message_id text not null,
  discord_channel_id text not null,
  author_discord_user_id text not null,
  content text not null,
  delivered_by_discord_user_id text,
  delivered_to_trailmark_id uuid references trailmarks(id) on delete set null,
  delivered_at timestamptz,
  created_at timestamptz not null,
  unique (topic_id, discord_message_id)
);

create table if not exists intel_trailmark_visits (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  trailmark_id uuid not null references trailmarks(id) on delete cascade,
  visited_at timestamptz not null default now()
);

drop trigger if exists set_intel_settings_updated_at on intel_settings;
create trigger set_intel_settings_updated_at
before update on intel_settings
for each row execute function set_updated_at();

drop trigger if exists set_intel_topics_updated_at on intel_topics;
create trigger set_intel_topics_updated_at
before update on intel_topics
for each row execute function set_updated_at();

create index if not exists intel_topics_active_idx on intel_topics(active);
create index if not exists intel_reports_topic_created_idx on intel_reports(topic_id, created_at);
create index if not exists intel_reports_delivered_idx on intel_reports(delivered_at);
create index if not exists intel_reports_trailmark_created_idx on intel_reports(trailmark_id, created_at);
create index if not exists intel_trailmark_visits_user_trailmark_idx on intel_trailmark_visits(discord_user_id, trailmark_id, visited_at);
