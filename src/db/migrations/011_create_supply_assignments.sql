do $$ begin
  create type supply_assignment_status as enum ('Active', 'Completed', 'Cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists supply_assignments (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('SUP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  name text not null,
  client_name text not null,
  status supply_assignment_status not null default 'Active',
  sale_price_per_item numeric(12, 2) not null check (sale_price_per_item >= 0),
  ranger_rate_per_item numeric(12, 2) not null check (ranger_rate_per_item >= 0),
  organizer_discord_user_id text,
  notes text,
  created_by_discord_user_id text not null,
  discord_channel_id text,
  discord_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (ranger_rate_per_item <= sale_price_per_item)
);

create table if not exists supply_assignment_items (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references supply_assignments(id) on delete cascade,
  item_name text not null,
  target_quantity integer not null check (target_quantity > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (assignment_id, item_name)
);

create table if not exists supply_contributions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references supply_assignments(id) on delete cascade,
  item_id uuid not null references supply_assignment_items(id) on delete cascade,
  member_discord_user_id text not null,
  quantity integer not null check (quantity > 0),
  note text,
  logged_by_discord_user_id text not null,
  created_at timestamptz not null default now()
);

create or replace function enforce_supply_contribution_quota()
returns trigger
language plpgsql
as $$
declare
  assignment_status supply_assignment_status;
  item_target integer;
  item_total integer;
begin
  select a.status, i.target_quantity
  into assignment_status, item_target
  from supply_assignment_items i
  join supply_assignments a on a.id = i.assignment_id
  where i.id = new.item_id and i.assignment_id = new.assignment_id
  for update of i;

  if not found then
    raise exception 'Supply item does not belong to this assignment.';
  end if;

  if assignment_status <> 'Active' then
    raise exception 'Supply assignment is not active.';
  end if;

  select coalesce(sum(quantity), 0)
  into item_total
  from supply_contributions
  where item_id = new.item_id;

  if item_total + new.quantity > item_target then
    raise exception 'Contribution exceeds the remaining item quota (% remaining).', item_target - item_total;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_supply_contribution_quota_trigger on supply_contributions;
create trigger enforce_supply_contribution_quota_trigger
before insert on supply_contributions
for each row execute function enforce_supply_contribution_quota();

drop trigger if exists set_supply_assignments_updated_at on supply_assignments;
create trigger set_supply_assignments_updated_at
before update on supply_assignments
for each row execute function set_updated_at();

create index if not exists supply_assignments_status_created_idx
on supply_assignments(status, created_at desc);

create index if not exists supply_assignment_items_assignment_idx
on supply_assignment_items(assignment_id, sort_order);

create index if not exists supply_contributions_assignment_created_idx
on supply_contributions(assignment_id, created_at desc);

create index if not exists supply_contributions_member_idx
on supply_contributions(member_discord_user_id, created_at desc);
