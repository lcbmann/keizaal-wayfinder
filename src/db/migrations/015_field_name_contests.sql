drop index if exists field_name_one_open_proposal_idx;

create unique index if not exists field_name_open_name_per_target_idx
  on field_name_proposals(target_discord_user_id, lower(proposed_name))
  where status = 'Open';

update field_name_proposals
set closes_at = opened_at + interval '3 days'
where status = 'Open';
