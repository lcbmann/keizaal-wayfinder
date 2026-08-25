do $$ begin
  create type ranger_contact_record_type as enum ('Person', 'Group');
exception when duplicate_object then null;
end $$;

alter table ranger_contacts
add column if not exists record_type ranger_contact_record_type not null default 'Person',
add column if not exists group_category text,
add column if not exists estimated_size text,
add column if not exists identifying_features text,
add column if not exists weapons_capabilities text,
add column if not exists tactics text;

alter table ranger_contacts
alter column race drop not null,
alter column sex drop not null,
alter column occupation drop not null;

create index if not exists ranger_contacts_record_type_idx
on ranger_contacts(record_type, active, high_priority, name);

create index if not exists ranger_contacts_group_category_idx
on ranger_contacts(group_category, active)
where record_type = 'Group';
