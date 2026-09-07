-- Run after migrations 050-052 INSIDE a transaction, then ROLLBACK.
-- Uses only synthetic archive records; never publish these fixtures to Discord.
set local role service_role;
do $$
declare a uuid; original uuid; replacement uuid; n integer; t text;
begin
  insert into public.strongbox_submissions(guild_id,source_key,submitter_discord_user_id,submitter_display_name,submission_type,title,content,confidentiality,reference_text,attachment_urls)
  values('audit-test','interaction-test','test-user','Test Ranger','agent_report','Synthetic report',E'  exact text\nsecond line  ','agents','https://example.com/evidence',array['https://example.com/image.png']) returning id into a;
  update public.strongbox_submissions set discord_channel_id='channel',discord_message_id='message',status='posted' where id=a;
  if not exists(select 1 from public.assistant_reports_feed where record_id=a::text and confidentiality='agents' and source_url='https://discord.com/channels/audit-test/channel/message' and content=E'  exact text\nsecond line  \n\nhttps://example.com/evidence') then raise exception 'Report provenance lost'; end if;
  begin
    update public.strongbox_submissions set content='overwrite' where id=a;
    raise exception 'Expected immutable evidence' using errcode='XX000';
  exception when raise_exception then null; end;
  insert into public.strongbox_submissions(guild_id,source_key,submitter_discord_user_id,submitter_display_name,submission_type,title,content,confidentiality)
  values('audit-test','interaction-test','test-user','Test Ranger','agent_report','Duplicate','different','agents') on conflict(guild_id,source_key) do nothing;
  select count(*) into n from public.strongbox_submissions where guild_id='audit-test';
  if n<>1 then raise exception 'Duplicate submission'; end if;

  insert into public.reference_items(guild_id,archived_by_discord_user_id,category,title,source_url)
  values('audit-test','test-user','GM Ruling','Synthetic ruling','https://example.com/ruling') returning id into original;
  if exists(select 1 from public.assistant_rules_reference where id=original) then raise exception 'Draft exposed in feed'; end if;
  update public.reference_items set exact_source_text=E'  verbatim\nsource  ',archived_at=now(),status='archived' where id=original;
  begin
    update public.reference_items set exact_source_text='edited' where id=original;
    raise exception 'Expected immutable reference' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    insert into public.reference_items(guild_id,archived_by_discord_user_id,category,title,source_url,supersedes_reference_id)
    values('another-guild','test-user','GM Ruling','Cross-server','https://example.com',original);
    raise exception 'Expected cross-server rejection' using errcode='XX000';
  exception when raise_exception then null; end;
  insert into public.reference_items(guild_id,archived_by_discord_user_id,category,title,source_url,supersedes_reference_id,exact_source_text,archived_at,status)
  values('audit-test','test-user','GM Ruling','Replacement','https://example.com/new',original,'New text',now(),'archived') returning id into replacement;
  if not exists(select 1 from public.assistant_rules_reference where id=original and is_superseded and exact_source_text=E'  verbatim\nsource  ') then raise exception 'Superseded evidence not preserved'; end if;
  if not exists(select 1 from public.assistant_rules_reference where id=replacement and not is_superseded and authority_level='unverified') then raise exception 'New reference classification changed'; end if;
  begin
    delete from public.reference_items where id=replacement;
    raise exception 'Expected delete denied' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  foreach t in array array['assistant_reports_feed','assistant_member_status','assistant_field_trial_status','assistant_rules_reference','assistant_runecloak_status'] loop
    execute format('select count(*) from public.%I',t) into n;
    if has_table_privilege(current_user,'public.'||t,'INSERT,UPDATE,DELETE') then raise exception 'View permits writes: %',t; end if;
  end loop;
  foreach t in array array['alliance_headquarters','alliance_headquarters_deliveries','alliance_headquarters_publications','alliance_headquarters_topic_channels','alliance_intel_publications','alliance_intel_settings','alliance_report_topic_publications','alliance_reports','alliance_topic_mirrors','apprenticeship_preferences','apprenticeships','corps_duties','duty_applications','ranger_duty_assignments','supply_assignment_items','supply_assignments','supply_contributions'] loop
    execute format('select count(*) from public.%I',t) into n;
    if not has_table_privilege(current_user,'public.'||t,'SELECT') or not has_table_privilege(current_user,'public.'||t,'INSERT') or not has_table_privilege(current_user,'public.'||t,'UPDATE') or not has_table_privilege(current_user,'public.'||t,'DELETE') then raise exception 'Bot access lost: %',t; end if;
    if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing: %',t; end if;
  end loop;
end;
$$;
reset role;

-- Exercise real SELECT attempts as both public client roles, not only ACL metadata.
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['strongbox_submissions','reference_items','assistant_reports_feed','assistant_member_status','assistant_field_trial_status','assistant_rules_reference','assistant_runecloak_status','alliance_headquarters','alliance_headquarters_deliveries','alliance_headquarters_publications','alliance_headquarters_topic_channels','alliance_intel_publications','alliance_intel_settings','alliance_report_topic_publications','alliance_reports','alliance_topic_mirrors','apprenticeship_preferences','apprenticeships','corps_duties','duty_applications','ranger_duty_assignments','supply_assignment_items','supply_assignments','supply_contributions'] loop
    begin
      execute format('select 1 from public.%I limit 1',t);
      raise exception 'Anonymous read allowed: %',t using errcode='XX000';
    exception when insufficient_privilege then null; end;
    if has_table_privilege(current_user,'public.'||t,'INSERT,UPDATE,DELETE') then raise exception 'Anonymous writes allowed: %',t; end if;
  end loop;
end;
$$;
reset role;
set local role authenticated;
do $$
declare t text;
begin
  foreach t in array array['strongbox_submissions','reference_items','assistant_reports_feed','assistant_member_status','assistant_field_trial_status','assistant_rules_reference','assistant_runecloak_status','alliance_headquarters','alliance_headquarters_deliveries','alliance_headquarters_publications','alliance_headquarters_topic_channels','alliance_intel_publications','alliance_intel_settings','alliance_report_topic_publications','alliance_reports','alliance_topic_mirrors','apprenticeship_preferences','apprenticeships','corps_duties','duty_applications','ranger_duty_assignments','supply_assignment_items','supply_assignments','supply_contributions'] loop
    begin
      execute format('select 1 from public.%I limit 1',t);
      raise exception 'Authenticated read allowed: %',t using errcode='XX000';
    exception when insufficient_privilege then null; end;
    if has_table_privilege(current_user,'public.'||t,'INSERT,UPDATE,DELETE') then raise exception 'Authenticated writes allowed: %',t; end if;
  end loop;
end;
$$;
reset role;
select 'PASS: archive provenance, immutable evidence, idempotency, drafts, supersession, guild isolation, service access, private views and public-role denial' as audit_test_result;
