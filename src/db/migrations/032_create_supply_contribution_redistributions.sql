create table if not exists supply_contribution_redistributions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  assignment_id uuid not null references supply_assignments(id) on delete cascade,
  source_contribution_id uuid not null unique references supply_contributions(id) on delete cascade,
  source_member_discord_user_id text not null,
  allocations jsonb not null,
  distribution_method text not null check (distribution_method in ('weighted', 'even')),
  source_cutoff timestamptz not null,
  reason text,
  created_by_discord_user_id text not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(allocations) = 'array')
);

create index if not exists supply_contribution_redistributions_assignment_idx
on supply_contribution_redistributions(assignment_id, created_at desc);

create index if not exists supply_contribution_redistributions_operation_idx
on supply_contribution_redistributions(operation_id);
