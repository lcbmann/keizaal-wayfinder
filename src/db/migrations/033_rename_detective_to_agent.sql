update corps_duties
set
  slug = 'agent',
  name = 'Agent',
  description = 'Conducts investigations, gathers testimony, and preserves evidence.',
  updated_at = now()
where slug = 'detective';

update corps_duties
set
  name = 'Agent',
  description = 'Conducts investigations, gathers testimony, and preserves evidence.',
  updated_at = now()
where slug = 'agent';
