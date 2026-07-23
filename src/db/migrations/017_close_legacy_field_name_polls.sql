update field_name_proposals
set status = 'Cancelled',
    decided_at = coalesce(decided_at, now()),
    decision_reason = coalesce(decision_reason, 'Closed during the Field Names system migration.')
where status = 'Open';
