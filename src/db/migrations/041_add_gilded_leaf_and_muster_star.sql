insert into corps_medals (
  slug,
  name,
  description,
  emoji,
  active,
  created_by_discord_user_id
)
values
  (
    'gilded-leaf',
    'Gilded Leaf',
    'Exceptional financial support or major donations that substantially strengthen Corps reserves.',
    ':gildedleaf:',
    true,
    'system'
  ),
  (
    'muster-star',
    'Muster Star',
    'Consistently organizing and leading successful Ranger Corps operations.',
    ':musterstar:',
    true,
    'system'
  )
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    emoji = excluded.emoji,
    active = true,
    updated_at = now();

update corps_medals
set description = 'Major logistical, supply, crafting, or Quartermaster contributions.',
    updated_at = now()
where slug = 'provisioners-laurel';
