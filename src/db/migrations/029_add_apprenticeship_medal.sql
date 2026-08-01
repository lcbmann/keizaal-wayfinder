insert into corps_medals (
  slug,
  name,
  description,
  emoji,
  created_by_discord_user_id
)
values (
  'apprenticeship',
  'Apprenticeship',
  'Awarded to members who have entered a formal Ranger Corps apprenticeship.',
  ':apprenticeship:',
  'system'
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    emoji = excluded.emoji,
    active = true,
    updated_at = now();

update corps_medals
set emoji = ':mentor:',
    active = true,
    updated_at = now()
where slug = 'mentor';

insert into ranger_medal_awards (
  medal_id,
  ranger_id,
  awarded_by_discord_user_id,
  reason
)
select distinct
  medal.id,
  ranger.id,
  'system',
  'Served as a Ranger Corps mentor.'
from apprenticeships apprenticeship
join rangers ranger
  on ranger.discord_user_id = apprenticeship.mentor_discord_user_id
join corps_medals medal
  on medal.slug = 'mentor'
where apprenticeship.status in ('Active', 'Ended')
on conflict (medal_id, ranger_id) do nothing;

insert into ranger_medal_awards (
  medal_id,
  ranger_id,
  awarded_by_discord_user_id,
  reason
)
select distinct
  medal.id,
  ranger.id,
  'system',
  'Entered a formal Ranger Corps apprenticeship.'
from apprenticeships apprenticeship
join rangers ranger
  on ranger.discord_user_id = apprenticeship.apprentice_discord_user_id
join corps_medals medal
  on medal.slug = 'apprenticeship'
where apprenticeship.status in ('Active', 'Ended')
on conflict (medal_id, ranger_id) do nothing;
