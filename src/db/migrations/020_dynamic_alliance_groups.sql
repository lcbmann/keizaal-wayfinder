alter table alliance_headquarters_topic_channels
add column if not exists active boolean not null default true;

alter table alliance_headquarters
add column if not exists all_topics boolean not null default false;

create index if not exists alliance_headquarters_topic_channels_active_idx
on alliance_headquarters_topic_channels(headquarters_id, active, topic_id);

-- The Undaunted no longer participates in the Alliance. Keep its records for history,
-- but stop setup and delivery from recreating or publishing to its section.
update alliance_headquarters
set active = false
where lower(headquarters_key) = 'undaunted';

update alliance_headquarters
set all_topics = true
where lower(headquarters_key) = 'north-star';

update alliance_headquarters_topic_channels
set active = false
where headquarters_id in (
  select id from alliance_headquarters where lower(headquarters_key) = 'undaunted'
);
