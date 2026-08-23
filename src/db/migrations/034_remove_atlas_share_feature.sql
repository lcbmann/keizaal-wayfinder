drop index if exists intel_reports_atlas_share_code_idx;

alter table intel_reports
drop column if exists atlas_share_code,
drop column if exists atlas_summary;
