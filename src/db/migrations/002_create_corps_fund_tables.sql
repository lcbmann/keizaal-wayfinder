do $$ begin
  create type corps_fund_transaction_type as enum ('Donation', 'Expense', 'Adjustment');
exception when duplicate_object then null;
end $$;

create table if not exists corps_fund_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type corps_fund_transaction_type not null,
  amount integer not null check (amount <> 0),
  description text not null,
  member_discord_user_id text,
  recorded_by_discord_user_id text not null,
  discord_channel_id text,
  discord_message_id text,
  created_at timestamptz default now()
);

create table if not exists corps_fund_summary_state (
  id boolean primary key default true check (id = true),
  discord_channel_id text,
  discord_message_id text,
  updated_at timestamptz default now()
);

insert into corps_fund_summary_state (id)
values (true)
on conflict (id) do nothing;

create index if not exists corps_fund_transactions_created_idx
on corps_fund_transactions(created_at desc);

create index if not exists corps_fund_transactions_member_idx
on corps_fund_transactions(member_discord_user_id);
