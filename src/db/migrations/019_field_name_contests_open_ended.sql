alter table field_name_contests
alter column closes_at drop not null;

update field_name_contests
set closes_at = null
where status = 'Open';
