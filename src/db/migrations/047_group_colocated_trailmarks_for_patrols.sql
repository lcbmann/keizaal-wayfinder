alter table trailmarks
  add column if not exists patrol_anchor_trailmark_id uuid references trailmarks(id) on delete set null;

comment on column trailmarks.patrol_anchor_trailmark_id is
  'Primary Trailmark used to combine co-located Trailmarks for patrol activity and route suggestions.';

do $$
begin
  alter table trailmarks
    add constraint trailmarks_patrol_anchor_not_self
    check (patrol_anchor_trailmark_id is null or patrol_anchor_trailmark_id <> id);
exception
  when duplicate_object then null;
end $$;

create index if not exists trailmarks_patrol_anchor_trailmark_id_idx
  on trailmarks(patrol_anchor_trailmark_id);

create or replace function enforce_trailmark_patrol_anchor()
returns trigger
language plpgsql
as $$
declare
  anchor trailmarks%rowtype;
begin
  if new.active is true and new.patrol_anchor_trailmark_id is not null then
    if new.patrol_anchor_trailmark_id = new.id then
      raise exception 'A Trailmark cannot use itself as its patrol primary.';
    end if;

    select * into anchor
    from trailmarks
    where id = new.patrol_anchor_trailmark_id;

    if not found then
      raise exception 'Patrol primary must be an active Trailmark.';
    end if;
    if anchor.active is not true then
      raise exception 'Patrol primary must be an active Trailmark.';
    end if;
    if anchor.hold <> new.hold then
      raise exception 'Co-located Trailmarks must be in the same Hold.';
    end if;
    if anchor.patrol_anchor_trailmark_id is not null then
      raise exception 'Patrol primary must be a canonical Trailmark, not another linked Trailmark.';
    end if;
    if exists (
      select 1
      from trailmarks as alias
      where alias.patrol_anchor_trailmark_id = new.id
        and alias.active is true
    ) then
      raise exception 'A Trailmark with active patrol aliases cannot itself use a patrol primary.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if (
      new.hold is distinct from old.hold
      or (old.active is true and new.active is not true)
    ) and exists (
      select 1
      from trailmarks as alias
      where alias.patrol_anchor_trailmark_id = new.id
        and alias.active is true
    ) then
      raise exception 'Reassign active patrol aliases before moving or deactivating their primary Trailmark.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_trailmark_patrol_anchor_trigger on trailmarks;
create trigger enforce_trailmark_patrol_anchor_trigger
before insert or update of patrol_anchor_trailmark_id, hold, active on trailmarks
for each row execute function enforce_trailmark_patrol_anchor();

update trailmarks as notice_board
set patrol_anchor_trailmark_id = whiterun.id,
    updated_at = now()
from trailmarks as whiterun
where (
    notice_board.slug in ('whiterun-notice-board-dawnguard-hq', 'whiterun-notice-board')
    or lower(notice_board.name) like 'whiterun notice board%'
  )
  and whiterun.slug = 'whiterun'
  and notice_board.id <> whiterun.id
  and notice_board.patrol_anchor_trailmark_id is distinct from whiterun.id;
