do $$ begin
  create type general_vote_status as enum ('Open', 'Closed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type general_ballot_vote as enum ('yes', 'no', 'abstain');
exception when duplicate_object then null;
end $$;

create table if not exists general_votes (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  message_id text,
  thread_id text,
  question text not null,
  context text,
  status general_vote_status not null default 'Open',
  opened_by_discord_user_id text not null,
  closed_by_discord_user_id text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists general_vote_ballots (
  id uuid primary key default gen_random_uuid(),
  general_vote_id uuid not null references general_votes(id) on delete cascade,
  voter_discord_user_id text not null,
  vote general_ballot_vote not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (general_vote_id, voter_discord_user_id)
);

alter table general_votes enable row level security;
alter table general_vote_ballots enable row level security;

drop trigger if exists set_general_vote_ballots_updated_at on general_vote_ballots;
create trigger set_general_vote_ballots_updated_at
before update on general_vote_ballots
for each row execute function set_updated_at();

create index if not exists general_votes_channel_status_idx
on general_votes(guild_id, channel_id, status, created_at desc);

create index if not exists general_vote_ballots_vote_idx
on general_vote_ballots(general_vote_id, vote, updated_at);
