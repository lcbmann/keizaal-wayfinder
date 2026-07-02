alter table intel_reports
add column if not exists bulletin_channel_id text,
add column if not exists bulletin_message_id text,
add column if not exists bulletin_posted_at timestamptz;

update intel_reports ir
set
  bulletin_channel_id = it.discord_channel_id,
  bulletin_message_id = 'legacy',
  bulletin_posted_at = now()
from intel_topics it
where ir.topic_id = it.id
  and ir.delivered_at is not null
  and ir.bulletin_message_id is null;

create index if not exists intel_reports_unposted_delivered_idx
on intel_reports(topic_id, created_at)
where delivered_at is not null and bulletin_message_id is null;
