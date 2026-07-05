alter table intel_reports
add column if not exists atlas_share_code text,
add column if not exists atlas_summary jsonb;

create index if not exists intel_reports_atlas_share_code_idx
on intel_reports(atlas_share_code)
where atlas_share_code is not null;
