alter table general_votes
add column if not exists vote_type text not null default 'binary';

alter table general_votes
drop constraint if exists general_votes_vote_type_check;
alter table general_votes
add constraint general_votes_vote_type_check
check (vote_type in ('binary', 'choice'));

create table if not exists general_vote_options (
  id uuid primary key default gen_random_uuid(),
  general_vote_id uuid not null references general_votes(id) on delete cascade,
  label text not null,
  description text,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (general_vote_id, position)
);

alter table general_vote_options enable row level security;

alter table general_vote_ballots
add column if not exists option_id uuid references general_vote_options(id) on delete cascade;

alter table general_vote_ballots
alter column vote drop not null;

alter table general_vote_ballots
drop constraint if exists general_vote_ballots_selection_check;
alter table general_vote_ballots
add constraint general_vote_ballots_selection_check
check (
  (vote is not null and option_id is null)
  or (vote is null and option_id is not null)
);

create index if not exists general_vote_options_vote_position_idx
on general_vote_options(general_vote_id, position);

create index if not exists general_vote_ballots_option_idx
on general_vote_ballots(option_id)
where option_id is not null;
