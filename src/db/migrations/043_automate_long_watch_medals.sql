insert into corps_medals (
  slug,
  name,
  description,
  emoji,
  created_by_discord_user_id,
  active
)
values
  (
    'long-watch-bronze',
    'Long Watch - Bronze',
    'Awarded automatically after 30 days of Ranger Corps service.',
    ':longwatchbronze:',
    'system',
    true
  ),
  (
    'long-watch-silver',
    'Long Watch - Silver',
    'Awarded automatically after 90 days of Ranger Corps service.',
    ':longwatchsilver:',
    'system',
    true
  ),
  (
    'long-watch-gold',
    'Long Watch - Gold',
    'Awarded automatically after 180 days of Ranger Corps service.',
    ':longwatchgold:',
    'system',
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  emoji = excluded.emoji,
  active = true,
  updated_at = now();

with long_watch_tiers(slug, service_days, reason) as (
  values
    ('long-watch-bronze', 30, 'Completed 30 days of Ranger Corps service.'),
    ('long-watch-silver', 90, 'Completed 90 days of Ranger Corps service.'),
    ('long-watch-gold', 180, 'Completed 180 days of Ranger Corps service.')
),
eligible_awards as (
  select
    medal.id as medal_id,
    ranger.id as ranger_id,
    tier.reason,
    coalesce(ranger.joined_at, ranger.join_date::timestamptz)
      + make_interval(days => tier.service_days) as earned_at
  from rangers ranger
  cross join long_watch_tiers tier
  join corps_medals medal on medal.slug = tier.slug
  where now() >= coalesce(ranger.joined_at, ranger.join_date::timestamptz)
    + make_interval(days => tier.service_days)
)
insert into ranger_medal_awards (
  medal_id,
  ranger_id,
  awarded_by_discord_user_id,
  reason,
  awarded_at
)
select
  eligible.medal_id,
  eligible.ranger_id,
  'system',
  eligible.reason,
  eligible.earned_at
from eligible_awards eligible
on conflict (medal_id, ranger_id) do update set
  awarded_by_discord_user_id = excluded.awarded_by_discord_user_id,
  reason = excluded.reason,
  awarded_at = excluded.awarded_at;
