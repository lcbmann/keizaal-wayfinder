do $$ begin
  create type structured_trailmark_report_type as enum ('General', 'Incident');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type structured_trailmark_report_status as enum ('Draft', 'Submitted', 'Cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists structured_trailmark_reports (
  id uuid primary key default gen_random_uuid(),
  trailmark_id uuid not null references trailmarks(id) on delete cascade,
  reporter_discord_user_id text not null,
  reporter_display_name text not null,
  report_type structured_trailmark_report_type not null,
  status structured_trailmark_report_status not null default 'Draft',
  subject text,
  location text,
  summary text,
  details text,
  follow_up text,
  commendation text,
  contact_ids uuid[] not null default '{}',
  participant_discord_user_ids text[] not null default '{}',
  discord_channel_id text,
  discord_message_id text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists structured_report_contact_forwards (
  report_id uuid not null references structured_trailmark_reports(id) on delete cascade,
  contact_id uuid not null references ranger_contacts(id) on delete cascade,
  discord_thread_id text not null,
  discord_message_id text not null,
  forwarded_at timestamptz not null default now(),
  primary key (report_id, contact_id)
);

drop trigger if exists set_structured_trailmark_reports_updated_at on structured_trailmark_reports;
create trigger set_structured_trailmark_reports_updated_at
before update on structured_trailmark_reports
for each row execute function set_updated_at();

create index if not exists structured_trailmark_reports_status_idx
on structured_trailmark_reports(status, created_at desc);

create unique index if not exists structured_trailmark_reports_discord_message_idx
on structured_trailmark_reports(discord_channel_id, discord_message_id)
where discord_channel_id is not null and discord_message_id is not null;

create index if not exists structured_trailmark_reports_contact_ids_idx
on structured_trailmark_reports using gin(contact_ids);
