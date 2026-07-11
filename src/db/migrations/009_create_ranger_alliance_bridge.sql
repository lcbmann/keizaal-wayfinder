create table if not exists alliance_intel_settings (
  id boolean primary key default true,
  alliance_guild_id text not null,
  reports_category_id text not null,
  intake_channel_id text not null,
  admin_channel_id text not null,
  corps_ally_reports_channel_id text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint alliance_intel_settings_singleton check (id = true)
);

create table if not exists alliance_topic_mirrors (
  topic_id uuid primary key references intel_topics(id) on delete cascade,
  alliance_guild_id text not null,
  alliance_channel_id text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists alliance_intel_publications (
  report_id uuid primary key references intel_reports(id) on delete cascade,
  alliance_channel_id text not null,
  alliance_message_id text not null,
  published_at timestamptz not null default now()
);

create table if not exists alliance_reports (
  id uuid primary key default gen_random_uuid(),
  discord_message_id text unique not null,
  discord_channel_id text not null,
  author_discord_user_id text not null,
  author_display_name text not null,
  source_order text not null,
  content text not null,
  attachment_urls text[] not null default '{}',
  corps_ally_channel_id text,
  corps_ally_message_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists alliance_report_topic_publications (
  alliance_report_id uuid not null references alliance_reports(id) on delete cascade,
  topic_id uuid not null references intel_topics(id) on delete cascade,
  corps_channel_id text not null,
  corps_message_id text not null,
  alliance_channel_id text not null,
  alliance_message_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (alliance_report_id, topic_id)
);

drop trigger if exists set_alliance_intel_settings_updated_at on alliance_intel_settings;
create trigger set_alliance_intel_settings_updated_at
before update on alliance_intel_settings
for each row execute function set_updated_at();

drop trigger if exists set_alliance_topic_mirrors_updated_at on alliance_topic_mirrors;
create trigger set_alliance_topic_mirrors_updated_at
before update on alliance_topic_mirrors
for each row execute function set_updated_at();

drop trigger if exists set_alliance_reports_updated_at on alliance_reports;
create trigger set_alliance_reports_updated_at
before update on alliance_reports
for each row execute function set_updated_at();

drop trigger if exists set_alliance_report_topic_publications_updated_at on alliance_report_topic_publications;
create trigger set_alliance_report_topic_publications_updated_at
before update on alliance_report_topic_publications
for each row execute function set_updated_at();

create index if not exists alliance_reports_created_idx on alliance_reports(created_at);
create index if not exists alliance_report_topic_publications_topic_idx
on alliance_report_topic_publications(topic_id, created_at);
