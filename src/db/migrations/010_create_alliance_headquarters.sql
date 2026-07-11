create table if not exists alliance_headquarters (
  id uuid primary key default gen_random_uuid(),
  headquarters_key text unique not null,
  name text not null,
  source_order text not null,
  trailmark_id uuid unique not null references trailmarks(id) on delete cascade,
  alliance_guild_id text not null,
  viewer_role_id text not null,
  reports_category_id text not null,
  intake_channel_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists alliance_headquarters_topic_channels (
  headquarters_id uuid not null references alliance_headquarters(id) on delete cascade,
  topic_id uuid not null references intel_topics(id) on delete cascade,
  discord_channel_id text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (headquarters_id, topic_id)
);

create table if not exists alliance_headquarters_deliveries (
  report_id uuid not null references intel_reports(id) on delete cascade,
  headquarters_id uuid not null references alliance_headquarters(id) on delete cascade,
  delivered_by_discord_user_id text not null,
  delivered_at timestamptz not null default now(),
  primary key (report_id, headquarters_id)
);

create table if not exists alliance_headquarters_publications (
  report_id uuid not null references intel_reports(id) on delete cascade,
  headquarters_id uuid not null references alliance_headquarters(id) on delete cascade,
  discord_channel_id text not null,
  discord_message_id text not null,
  published_at timestamptz not null default now(),
  primary key (report_id, headquarters_id)
);

alter table alliance_reports
add column if not exists headquarters_id uuid references alliance_headquarters(id) on delete set null,
add column if not exists trailmark_message_channel_id text,
add column if not exists trailmark_message_id text;

alter table intel_reports
add column if not exists author_display_name text,
add column if not exists source_order text,
add column if not exists source_alliance_report_id uuid references alliance_reports(id) on delete cascade;

drop trigger if exists set_alliance_headquarters_updated_at on alliance_headquarters;
create trigger set_alliance_headquarters_updated_at
before update on alliance_headquarters
for each row execute function set_updated_at();

drop trigger if exists set_alliance_headquarters_topic_channels_updated_at on alliance_headquarters_topic_channels;
create trigger set_alliance_headquarters_topic_channels_updated_at
before update on alliance_headquarters_topic_channels
for each row execute function set_updated_at();

create index if not exists alliance_headquarters_trailmark_idx on alliance_headquarters(trailmark_id);
create index if not exists alliance_headquarters_intake_idx on alliance_headquarters(intake_channel_id);
create index if not exists alliance_headquarters_deliveries_hq_idx
on alliance_headquarters_deliveries(headquarters_id, delivered_at);
create index if not exists intel_reports_source_alliance_report_idx
on intel_reports(source_alliance_report_id)
where source_alliance_report_id is not null;
