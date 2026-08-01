create table if not exists honors_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('medal_award', 'promotion')),
  source_id uuid not null,
  discord_thread_id text not null,
  discord_message_id text not null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists honors_ledger_entries_thread_idx
  on honors_ledger_entries(discord_thread_id, created_at);
