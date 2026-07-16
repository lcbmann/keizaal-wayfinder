alter table apprenticeship_preferences
add column if not exists notice_channel_id text,
add column if not exists notice_message_id text;
