begin;

alter table runecloak_settings
  alter column personal_point_requirement set default 300;

alter table runecloak_spell_progress
  alter column required_points set default 300;

update runecloak_settings
set personal_point_requirement = 300,
    updated_at = now()
where personal_point_requirement = 400;

update runecloak_spell_progress
set required_points = 300,
    status = case
      when status = 'completed' then 'completed'
      when verified_points >= 300
       and verified_valid_stages >= required_valid_stages then 'eligible'
      else 'in_progress'
    end,
    updated_at = now()
where required_points = 400;

commit;
