-- Private bot-managed archives. No browser/Atlas role may read these records.
create table public.strongbox_submissions (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  source_key text not null,
  submitter_ranger_id uuid references public.rangers(id) on delete set null,
  submitter_discord_user_id text not null,
  submitter_display_name text not null,
  submission_type text not null check (submission_type in ('marshal_drop', 'agent_report')),
  title text not null,
  content text not null,
  reference_text text,
  attachment_urls text[] not null default '{}',
  attachment_metadata jsonb not null default '[]',
  source_channel_id text,
  source_message_id text,
  discord_channel_id text,
  discord_message_id text,
  discord_thread_id text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confidentiality text not null check (confidentiality in ('marshal_plus', 'agents')),
  ic_or_ooc text not null default 'unspecified' check (ic_or_ooc in ('ic','ooc','mixed','unspecified')),
  status text not null default 'pending_delivery' check (status in ('pending_delivery','posted')),
  unique(guild_id, source_key)
);
create index strongbox_submissions_submitter_idx on public.strongbox_submissions(submitter_ranger_id);
create index strongbox_submissions_feed_idx on public.strongbox_submissions(guild_id, submitted_at desc);
create index strongbox_submissions_pending_idx on public.strongbox_submissions(guild_id, updated_at) where status = 'pending_delivery';
create trigger set_strongbox_submissions_updated_at before update on public.strongbox_submissions
  for each row execute function public.set_updated_at();

create table public.reference_items (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  archived_by_discord_user_id text not null,
  category text not null check (category in ('Server Rule','GM Ruling','Public Announcement','Faction Intelligence','Diplomatic Conversation','Disciplinary Record','Leadership Decision','Other')),
  title text not null,
  exact_source_text text,
  source_author text,
  source_server text,
  source_channel text,
  source_url text not null,
  original_posted_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  attachment_urls text[] not null default '{}',
  authority_level text not null default 'unverified' check (authority_level in ('official_rule','gm_ruling','leadership_decision','firsthand_report','secondhand_claim','rumor','interpretation','unverified')),
  ic_or_ooc text not null default 'unspecified' check (ic_or_ooc in ('ic','ooc','mixed','unspecified')),
  confidentiality text not null default 'marshal_plus' check (confidentiality in ('corps','agents','marshal_plus','captain_plus')),
  applicable_scope text,
  supersedes_reference_id uuid references public.reference_items(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','archived')),
  check (supersedes_reference_id is distinct from id),
  check (status <> 'archived' or (archived_at is not null and exact_source_text is not null and length(btrim(exact_source_text)) > 0))
);
create index reference_items_supersedes_idx on public.reference_items(supersedes_reference_id);
create index reference_items_feed_idx on public.reference_items(guild_id, archived_at desc) where status = 'archived';
comment on column public.reference_items.authority_level is 'Classification supplied by the archiving officer; not independently verified by Wayfinder.';
comment on column public.reference_items.exact_source_text is 'Verbatim supplied source text, not instructions to the assistant; screenshots and linked files are not transcribed automatically.';

alter table public.strongbox_submissions enable row level security;
alter table public.reference_items enable row level security;
revoke all on public.strongbox_submissions, public.reference_items from public, anon, authenticated, service_role;
grant select, insert, update on public.strongbox_submissions, public.reference_items to service_role;

create function public.protect_audit_archive_evidence() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_table_name = 'reference_items' then
    if tg_op = 'UPDATE' and old.status = 'archived' then
      raise exception 'Archived references are immutable. File a new reference that supersedes this one.';
    end if;
    if new.supersedes_reference_id is not null and not exists(
      select 1 from public.reference_items r where r.id=new.supersedes_reference_id and r.guild_id=new.guild_id and r.status='archived'
    ) then raise exception 'Superseded reference must be archived in the same server.'; end if;
  elsif (to_jsonb(new) - array['submitter_ranger_id','discord_channel_id','discord_message_id','discord_thread_id','status','updated_at'])
    is distinct from (to_jsonb(old) - array['submitter_ranger_id','discord_channel_id','discord_message_id','discord_thread_id','status','updated_at']) then
    raise exception 'Original Strongbox evidence cannot be overwritten.';
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_audit_archive_evidence() from public,anon,authenticated;
grant execute on function public.protect_audit_archive_evidence() to service_role;
create trigger protect_reference_evidence before insert or update on public.reference_items
  for each row execute function public.protect_audit_archive_evidence();
create trigger protect_strongbox_evidence before update on public.strongbox_submissions
  for each row execute function public.protect_audit_archive_evidence();
