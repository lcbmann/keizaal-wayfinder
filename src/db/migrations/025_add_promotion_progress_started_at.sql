alter table rangers
add column if not exists promotion_progress_started_at timestamptz;

update rangers
set promotion_progress_started_at = updated_at
where promotion_progress is not null
  and promotion_progress_started_at is null;
