do $$ begin
  create type field_name_proposal_status as enum ('Open', 'Approved', 'Denied', 'Cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type field_name_ballot_vote as enum ('yes', 'no', 'abstain');
exception when duplicate_object then null;
end $$;

create table if not exists field_name_proposals (
  id uuid primary key default gen_random_uuid(),
  target_discord_user_id text not null,
  proposed_name text not null,
  reason text not null,
  nominated_by_discord_user_id text not null,
  status field_name_proposal_status not null default 'Open',
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  decided_at timestamptz,
  decision_reason text,
  discord_channel_id text,
  discord_message_id text,
  discord_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists field_name_one_open_proposal_idx
  on field_name_proposals(target_discord_user_id)
  where status = 'Open';

create index if not exists field_name_proposals_status_idx
  on field_name_proposals(status, closes_at);

create table if not exists field_name_ballots (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references field_name_proposals(id) on delete cascade,
  voter_discord_user_id text not null,
  vote field_name_ballot_vote not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(proposal_id, voter_discord_user_id)
);

create table if not exists ranger_field_names (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  field_name text not null,
  assigned_by_proposal_id uuid references field_name_proposals(id) on delete set null,
  assigned_at timestamptz not null default now(),
  active boolean not null default true,
  removed_at timestamptz,
  removed_reason text
);

create unique index if not exists ranger_field_names_active_user_idx
  on ranger_field_names(discord_user_id)
  where active;

create unique index if not exists ranger_field_names_active_name_idx
  on ranger_field_names(lower(field_name))
  where active;

create index if not exists ranger_field_names_active_idx
  on ranger_field_names(active, discord_user_id);

drop trigger if exists field_name_proposals_updated_at on field_name_proposals;
create trigger field_name_proposals_updated_at
before update on field_name_proposals
for each row execute function set_updated_at();

drop trigger if exists field_name_ballots_updated_at on field_name_ballots;
create trigger field_name_ballots_updated_at
before update on field_name_ballots
for each row execute function set_updated_at();
