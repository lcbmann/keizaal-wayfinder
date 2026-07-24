alter table alliance_headquarters
add column if not exists report_delivery_start_at timestamptz not null default (now() - interval '7 days');

comment on column alliance_headquarters.report_delivery_start_at is
'Earliest report creation time eligible for delivery to this headquarters. Defaults to a seven-day backfill window.';
