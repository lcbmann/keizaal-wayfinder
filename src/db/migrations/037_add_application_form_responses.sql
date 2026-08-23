alter table duty_applications
add column if not exists application_responses jsonb not null default '[]'::jsonb;
