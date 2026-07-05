alter table intel_settings
add column if not exists catchall_topic_id uuid references intel_topics(id) on delete set null;
