do $$
begin
  create type contact_assessment as enum ('good', 'cold', 'not_found', 'mia', 'archive');
exception
  when duplicate_object then null;
end $$;

create table if not exists ranger_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  race text not null,
  sex text not null,
  occupation text not null,
  faction text,
  hold text not null,
  usual_locations text,
  commentary text,
  high_priority boolean not null default false,
  active boolean not null default true,
  created_by_discord_user_id text not null,
  forum_channel_id text,
  forum_thread_id text,
  forum_message_id text,
  archived_by_discord_user_id text,
  archived_at timestamptz,
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contact_assessments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references ranger_contacts(id) on delete cascade,
  voter_discord_user_id text not null,
  assessment contact_assessment not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, voter_discord_user_id)
);

drop trigger if exists set_ranger_contacts_updated_at on ranger_contacts;
create trigger set_ranger_contacts_updated_at
before update on ranger_contacts
for each row execute function set_updated_at();

drop trigger if exists set_contact_assessments_updated_at on contact_assessments;
create trigger set_contact_assessments_updated_at
before update on contact_assessments
for each row execute function set_updated_at();

create index if not exists ranger_contacts_active_idx
on ranger_contacts(active, high_priority, updated_at desc);

create index if not exists ranger_contacts_hold_idx
on ranger_contacts(hold, active);

create index if not exists ranger_contacts_occupation_idx
on ranger_contacts(occupation, active);

create index if not exists contact_assessments_contact_idx
on contact_assessments(contact_id, updated_at desc);
