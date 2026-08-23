alter table promotion_votes
add column if not exists thread_id text;

alter table duty_applications
alter column duty_id drop not null;

alter table duty_applications
add column if not exists application_kind text not null default 'Duty',
add column if not exists target_rank ranger_rank,
add column if not exists experience text,
add column if not exists warden_scope text,
add column if not exists parent_hold text,
add column if not exists resulting_promotion_vote_id uuid references promotion_votes(id) on delete set null;

alter table duty_applications
drop constraint if exists duty_applications_application_kind_check;
alter table duty_applications
add constraint duty_applications_application_kind_check
check (application_kind in ('Duty', 'Marshal', 'Captain'));

alter table duty_applications
drop constraint if exists duty_applications_warden_scope_check;
alter table duty_applications
add constraint duty_applications_warden_scope_check
check (warden_scope is null or warden_scope in ('hold_primary', 'local_range'));

alter table duty_applications
drop constraint if exists duty_applications_target_check;
alter table duty_applications
add constraint duty_applications_target_check
check (
  (application_kind = 'Duty' and duty_id is not null and target_rank is null)
  or (application_kind = 'Marshal' and duty_id is null and target_rank = 'Ranger Marshal')
  or (application_kind = 'Captain' and duty_id is null and target_rank = 'Ranger Captain')
);

drop index if exists duty_applications_one_pending_per_ranger_duty;
create unique index if not exists duty_applications_one_pending_duty
on duty_applications(applicant_ranger_id, duty_id)
where status = 'Pending' and application_kind = 'Duty';

create unique index if not exists duty_applications_one_pending_rank
on duty_applications(applicant_ranger_id, target_rank)
where status = 'Pending' and application_kind in ('Marshal', 'Captain');

alter table ranger_duty_assignments
add column if not exists warden_scope text,
add column if not exists parent_hold text;

alter table ranger_duty_assignments
drop constraint if exists ranger_duty_assignments_warden_scope_check;
alter table ranger_duty_assignments
add constraint ranger_duty_assignments_warden_scope_check
check (warden_scope is null or warden_scope in ('hold_primary', 'local_range'));

update ranger_duty_assignments assignment
set
  status = 'Ended',
  ended_at = coalesce(assignment.ended_at, now()),
  end_reason = coalesce(assignment.end_reason, 'Closed during Warden hierarchy migration because the Ranger was not Active')
from rangers ranger
where assignment.ranger_id = ranger.id
  and assignment.status = 'Active'
  and ranger.status in ('Inactive', 'Retired');

update ranger_duty_assignments assignment
set
  warden_scope = 'hold_primary',
  parent_hold = ranger.assigned_hold,
  assignment_detail = ranger.assigned_hold
from corps_duties duty, rangers ranger
where assignment.duty_id = duty.id
  and assignment.ranger_id = ranger.id
  and assignment.status = 'Active'
  and duty.name = 'Warden'
  and ranger.assigned_hold is not null
  and assignment.warden_scope is null;

update ranger_duty_assignments assignment
set warden_scope = 'local_range'
from corps_duties duty
where assignment.duty_id = duty.id
  and assignment.status = 'Active'
  and duty.name = 'Warden'
  and assignment.warden_scope is null;

with duplicate_hold_rangers as (
  select
    id,
    parent_hold,
    row_number() over (partition by parent_hold order by started_at asc, id asc) as hold_position
  from ranger_duty_assignments
  where status = 'Active'
    and warden_scope = 'hold_primary'
)
update ranger_duty_assignments assignment
set
  warden_scope = 'local_range',
  assignment_detail = duplicate.parent_hold || ' Hold'
from duplicate_hold_rangers duplicate
where assignment.id = duplicate.id
  and duplicate.hold_position > 1;

update rangers ranger
set assigned_hold = null,
    updated_at = now()
where ranger.assigned_hold is not null
  and not exists (
    select 1
    from ranger_duty_assignments assignment
    where assignment.ranger_id = ranger.id
      and assignment.status = 'Active'
      and assignment.warden_scope = 'hold_primary'
      and assignment.parent_hold = ranger.assigned_hold
  );

drop index if exists ranger_duty_assignments_one_active_per_ranger_duty;
create unique index if not exists ranger_duty_assignments_one_active_nonwarden_duty
on ranger_duty_assignments(ranger_id, duty_id)
where status = 'Active' and warden_scope is null;

create unique index if not exists ranger_duty_assignments_one_active_warden_range
on ranger_duty_assignments(ranger_id, duty_id, coalesce(parent_hold, ''), coalesce(assignment_detail, ''))
where status = 'Active' and warden_scope is not null;

create unique index if not exists ranger_duty_assignments_one_primary_per_hold
on ranger_duty_assignments(parent_hold)
where status = 'Active' and warden_scope = 'hold_primary';

create unique index if not exists ranger_duty_assignments_one_primary_per_ranger
on ranger_duty_assignments(ranger_id)
where status = 'Active' and warden_scope = 'hold_primary';

create index if not exists ranger_duty_assignments_warden_parent_idx
on ranger_duty_assignments(parent_hold, assignment_detail)
where status = 'Active' and warden_scope is not null;
