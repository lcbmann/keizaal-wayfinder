-- These views are for privileged, read-only retrieval, NOT a public assistant API.
-- Invoker security plus explicit grants prevent exposure through the Atlas key.
create view public.assistant_rules_reference with (security_invoker = true) as
select r.*, exists(select 1 from public.reference_items newer where newer.supersedes_reference_id=r.id and newer.status='archived' and newer.guild_id=r.guild_id) as is_superseded
from public.reference_items r where r.status='archived';

create view public.assistant_reports_feed with (security_invoker = true) as
select 'strongbox'::text as record_type, s.id::text as record_id, s.guild_id,
  s.submitted_at as occurred_at, s.updated_at, 'submission_time'::text as timestamp_basis,
  s.submitter_discord_user_id as author_id, s.submitter_display_name as author,
  s.submission_type as topic, null::text as hold_or_region, s.title,
  concat_ws(E'\n\n',s.content,s.reference_text) as content, s.status,
  case when s.discord_message_id is not null then 'https://discord.com/channels/'||s.guild_id||'/'||s.discord_channel_id||'/'||s.discord_message_id end as source_url,
  s.discord_channel_id as source_channel_id, s.discord_message_id as source_message_id,
  s.attachment_urls, s.confidentiality, s.ic_or_ooc, 'unverified'::text as authority_level,
  null::text as related_record_id
from public.strongbox_submissions s
union all
select 'reference',r.id::text,r.guild_id,coalesce(r.original_posted_at,r.archived_at),r.archived_at,
  case when r.original_posted_at is null then 'archive_time' else 'reported_source_time' end,
  null,r.source_author,r.category,null,r.title,r.exact_source_text,
  case when r.is_superseded then 'superseded' else 'archived' end,
  r.source_url,null,null,r.attachment_urls,r.confidentiality,r.ic_or_ooc,r.authority_level,r.supersedes_reference_id::text
from public.assistant_rules_reference r
union all
select 'structured_report',r.id::text,null,coalesce(r.submitted_at,r.created_at),r.updated_at,'submission_time',
  r.reporter_discord_user_id,r.reporter_display_name,r.report_type::text,t.hold,r.subject,
  concat_ws(E'\n\n',r.location,r.summary,r.details,r.follow_up,r.commendation),r.status::text,
  null,r.discord_channel_id,r.discord_message_id,'{}'::text[],'corps','ic','unverified',null
from public.structured_trailmark_reports r left join public.trailmarks t on t.id=r.trailmark_id where r.status='Submitted'
union all
select 'intel_report',r.id::text,null,r.created_at,coalesce(r.bulletin_posted_at,r.delivered_at,r.created_at),'capture_time',
  r.author_discord_user_id,coalesce(r.author_display_name,p.in_game_name,p.discord_display_name),topic.name,t.hold,topic.name,r.content,
  case when r.delivered_at is null then 'undelivered' else 'delivered' end,
  null,r.discord_channel_id,r.discord_message_id,'{}'::text[],'corps','ic','unverified',null
from public.intel_reports r left join public.intel_topics topic on topic.id=r.topic_id
left join public.trailmarks t on t.id=r.trailmark_id left join public.rangers p on p.discord_user_id=r.author_discord_user_id
where r.source_alliance_report_id is null
  and not exists(select 1 from public.structured_trailmark_reports s where s.status='Submitted' and s.discord_channel_id=r.discord_channel_id and s.discord_message_id=r.discord_message_id)
union all
select 'alliance_report',r.id::text,null,r.created_at,r.updated_at,'capture_time',r.author_discord_user_id,r.author_display_name,
  r.source_order,null,'Alliance report',r.content,'recorded',null,r.discord_channel_id,r.discord_message_id,r.attachment_urls,'alliance','ic','unverified',null
from public.alliance_reports r;

create view public.assistant_member_status with (security_invoker = true) as
select r.id as ranger_id,r.discord_user_id,r.in_game_name,r.discord_display_name,r.current_rank,r.status,
  r.join_date,r.joined_at,r.last_promotion_date,r.assigned_hold,r.promotion_progress,r.promotion_progress_started_at,
  r.last_discord_activity_at,r.last_bot_interaction_at,r.updated_at,
  (select count(*) from public.promotion_votes v where v.candidate_ranger_id=r.id and v.status='Open') as open_promotion_vote_count,
  coalesce((select jsonb_agg(jsonb_build_object('duty',d.name,'detail',a.assignment_detail)) from public.ranger_duty_assignments a join public.corps_duties d on d.id=a.duty_id where a.ranger_id=r.id and a.status='Active'),'[]'::jsonb) as active_duties,
  'marshal_plus'::text as confidentiality
from public.rangers r;

create view public.assistant_field_trial_status with (security_invoker = true) as
select r.id as ranger_id,r.discord_user_id,r.in_game_name,r.current_rank,r.status,r.promotion_progress,r.promotion_progress_started_at,r.updated_at,
  coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'mentor_discord_user_id',a.mentor_discord_user_id,'status',a.status,'started_at',a.started_at)) from public.apprenticeships a where a.apprentice_discord_user_id=r.discord_user_id and a.status in ('Active','Proposed','Pending Marshal')),'[]'::jsonb) as apprenticeships,
  coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'target_rank',v.target_rank,'status',v.status,'opened_at',v.created_at,'channel_id',v.channel_id,'message_id',v.message_id)) from public.promotion_votes v where v.candidate_ranger_id=r.id and v.status in ('Open','Closed')),'[]'::jsonb) as pending_votes,
  'Not inferred: trial document submission and passing require source evidence.'::text as coverage_note,
  'marshal_plus'::text as confidentiality
from public.rangers r;

create view public.assistant_runecloak_status with (security_invoker = true) as
select r.id as ranger_id,r.discord_user_id,r.in_game_name,r.status as ranger_status,
  a.id as application_id,a.status as application_status,a.updated_at as application_updated_at,a.review_note,
  a.review_channel_id,a.review_message_id,
  m.guild_id,m.status as membership_status,m.admitted_at,
  p.spell_id,s.name as spell_name,p.status as study_status,p.verified_points,p.required_points,
  p.verified_valid_stages,p.required_valid_stages,p.delivered_at,p.delivery_reference,p.updated_at as progress_updated_at,
  u.unlocked_at as group_unlock_recorded_at,u.unlock_reference,
  c.id as campaign_id,c.status as campaign_status,c.verified_points as group_verified_points,c.point_target as group_point_target,
  'runecloak_guides'::text as confidentiality
from public.rangers r
left join lateral(select * from public.runecloak_applications x where x.applicant_ranger_id=r.id order by x.created_at desc,x.id limit 1) a on true
left join public.runecloak_memberships m on m.ranger_id=r.id
left join public.runecloak_spell_progress p on p.ranger_id=r.id
left join public.runecloak_spells s on s.id=p.spell_id
left join public.runecloak_spell_unlocks u on u.spell_id=p.spell_id and u.guild_id=m.guild_id
left join lateral(select * from public.runecloak_cycles x where x.spell_id=p.spell_id and x.guild_id=m.guild_id and x.status <> 'Cancelled' order by x.created_at desc,x.id limit 1) c on true
where a.id is not null or m.id is not null;

revoke all on public.assistant_reports_feed,public.assistant_member_status,public.assistant_field_trial_status,
  public.assistant_rules_reference,public.assistant_runecloak_status from public,anon,authenticated,service_role;
grant select on public.assistant_reports_feed,public.assistant_member_status,public.assistant_field_trial_status,
  public.assistant_rules_reference,public.assistant_runecloak_status to service_role;
comment on view public.assistant_reports_feed is 'Privileged audit feed. occurred_at uses timestamp_basis, not necessarily event time. Legacy records lack guild IDs/URLs; use source channel/message IDs. Reports are claims, not verified facts. Linked documents/attachments are not fetched. Excludes known Alliance and structured-report Intel mirrors.';
comment on view public.assistant_field_trial_status is 'Stored workflow state only; does not infer readiness, submission, passing, or promotion eligibility from elapsed time.';
