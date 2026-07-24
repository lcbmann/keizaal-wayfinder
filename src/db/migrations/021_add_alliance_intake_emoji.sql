alter table alliance_headquarters
add column if not exists intake_emoji text not null default '';
