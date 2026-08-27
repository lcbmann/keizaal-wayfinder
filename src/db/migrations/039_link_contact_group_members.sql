create table if not exists contact_group_memberships (
  group_contact_id uuid not null references ranger_contacts(id) on delete cascade,
  member_contact_id uuid not null references ranger_contacts(id) on delete cascade,
  created_by_discord_user_id text not null,
  created_at timestamptz not null default now(),
  primary key (group_contact_id, member_contact_id),
  check (group_contact_id <> member_contact_id)
);

create index if not exists contact_group_memberships_member_idx
on contact_group_memberships(member_contact_id, group_contact_id);
