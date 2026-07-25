alter table rangers
add column if not exists promotion_progress text
check (promotion_progress in ('In Field Trial', 'On Hold'));
