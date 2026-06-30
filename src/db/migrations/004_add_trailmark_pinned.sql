alter table trailmarks
add column if not exists pinned boolean not null default false;

create index if not exists trailmarks_active_pinned_idx on trailmarks(active, pinned);
