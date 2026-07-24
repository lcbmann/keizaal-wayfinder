insert into corps_duties (slug, name, description, max_active_holders, requires_detail, active)
values (
  'ambassador',
  'Ambassador',
  'Represents the Corps and maintains relations with other groups.',
  null,
  false,
  true
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  max_active_holders = excluded.max_active_holders,
  requires_detail = excluded.requires_detail,
  active = true;
