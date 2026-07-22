alter table field_name_proposals
add column if not exists nominee_veto_notified_at timestamptz;
