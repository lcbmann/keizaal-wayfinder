create table if not exists bot_message_state (
  state_key text primary key,
  discord_channel_id text not null,
  discord_message_ids text[] not null default '{}',
  updated_at timestamptz default now()
);
