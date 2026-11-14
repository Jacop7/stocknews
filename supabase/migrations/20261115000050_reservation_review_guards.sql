begin;
-- Append-only correction of S6EI-CODEX-01/02 and both reviewers' P3 observations.
create function private.reservation_assert_wallclock_evidence(p_issue uuid) returns void language plpgsql volatile set search_path='' as $$
begin
 if not exists(select 1 from private.claims where issue_id=p_issue) or exists(select 1 from private.claims where issue_id=p_issue and valid_until is not null and valid_until<=clock_timestamp()) then raise exception 'RESERVATION_EVIDENCE_EXPIRED';end if;
end$$;
create function private.reservation_evidence_commit_guard() returns trigger language plpgsql set search_path='' as $$
begin
 -- The whole tick is one transaction. Recheck even early items immediately at
 -- its deferred commit boundary after later candidates may have used time.
 perform private.reservation_assert_wallclock_evidence(new.issue_id);return new;
end$$;
create constraint trigger reservation_evidence_at_commit after insert or update on private.manual_publication_schedules deferrable initially deferred
 for each row when(new.status='PUBLISHED') execute function private.reservation_evidence_commit_guard();
create function private.reservation_expected_error(p_state text,p_message text) returns boolean language sql immutable set search_path='' as $$
 select p_state='P0001' and p_message=any(array[
 'RESERVATION_EVIDENCE_EXPIRED','CLAIM_NOT_VERIFIED','PATH_EVIDENCE_NOT_VERIFIED','IMPACT_SECTOR_INACTIVE','PRIMARY_SECTOR_INACTIVE','STALE_POLICY_OR_CATALOG','MACRO_INDEPENDENT_THREE_REQUIRED',
 'ARTICLE_MARKET_REQUIRED','CORE_TEXT_REQUIRED','DAMAGE_REQUIRES_RISKS','DRAFT_SHAPE_INVALID','DUPLICATE_SECTOR_PATH','IMPACT_DESCRIPTION_REQUIRED','INVALID_CONDITION_TEXT','INVALID_EDITOR_CONTENT','INVALID_IMPACT_PATH','INVALID_KEY_ISSUE','INVALID_RISKS','INVALID_RISK_TEXT','INVALID_SCENARIOS','INVALID_SCENARIO_TEXT','INVALID_SCHEDULE','KEY_ISSUES_REQUIRED','KR_IMPACT_PATH_REQUIRED','KR_PERSPECTIVE_REQUIRED','NO_POSITIVE_PATH_NO_SCENARIOS','PATH_CONDITION_REQUIRED','PATH_EVIDENCE_REQUIRED','PRIMARY_SECTOR_PATH_REQUIRED','PRIMARY_SECTOR_REQUIRED','SCENARIO_CONTENT_REQUIRED','SCENARIO_EVIDENCE_PATH_MISMATCH','SCENARIO_PATH_MISMATCH','SCHEDULE_EVIDENCE_REQUIRED','SCHEDULE_INSTANT_REQUIRED','SCHEDULE_OFFICIAL_EVIDENCE_REQUIRED','SCHEDULE_OFFSET_REQUIRED','SCHEDULE_PERIOD_REQUIRED','SCHEDULE_STATUS_REQUIRED','SCHEDULE_VERIFICATION_REQUIRED','SOURCES_REQUIRED','SYNTHETIC_ISSUE_REQUIRED','SYNTHETIC_SOURCE_REQUIRED']);
$$;
create or replace function private.reservation_publish_core(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text,p_actor uuid,p_schedule uuid)
returns jsonb language plpgsql set search_path='' as $$
declare d private.editor_drafts;i private.issues;s private.manual_publication_schedules;b jsonb;r jsonb;h text;prior private.outbox;
begin
 if p_actor is null then raise exception 'ACTOR_REQUIRED';end if;
 if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
 select * into strict i from private.issues where id=p_issue for update;
 select * into strict d from private.editor_drafts where issue_id=p_issue for update;
 h:=private.reservation_hash(jsonb_build_object('issue',p_issue,'draft_revision',p_expected_revision,'issue_revision',p_issue_revision,'policy',p_policy,'catalog',p_catalog));
 select * into prior from private.outbox where effect_key=p_effect_key;
 if found then
  if prior.issue_id is distinct from p_issue or prior.payload->>'editor_request_hash' is distinct from h then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
  return jsonb_build_object('status','ALREADY_APPLIED','issue_id',i.id,'revision',i.revision,'version_id',prior.version_id);
 end if;
 if d.revision is distinct from p_expected_revision or i.revision is distinct from p_issue_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if p_schedule is null then
  if i.scheduled_publish_at is not null or exists(select 1 from private.manual_publication_schedules where issue_id=p_issue and status='PENDING') then raise exception 'RESERVATION_PENDING';end if;
 else
  perform private.assert_server();
  select * into strict s from private.manual_publication_schedules where id=p_schedule for update;
  if s.status<>'PENDING' or s.issue_id<>i.id or s.actor_id<>p_actor or s.effect_key<>p_effect_key
   or not private.reservation_actor_active(p_actor) or s.due_at>clock_timestamp() or s.expires_at<=clock_timestamp()
   or i.publication_state<>'DRAFT' or i.first_published_at is not null or i.current_version_id is not null
   or i.scheduled_publish_at is distinct from s.due_at or s.draft_revision<>d.revision or s.issue_revision<>i.revision
   or s.policy_version<>p_policy or s.catalog_version<>p_catalog or s.content_hash<>private.reservation_hash(d.content)
   or s.evidence_digest<>private.reservation_evidence_hash(i.id) then raise exception 'RESERVATION_DELEGATION_REJECTED';end if;
 end if;
 if p_schedule is not null then perform private.reservation_assert_wallclock_evidence(p_issue);end if;
 b:=private.m1_prepare(p_issue,d.content,p_policy,p_catalog);
 if p_schedule is not null then perform private.reservation_assert_wallclock_evidence(p_issue);end if;
 update private.issues set primary_sector_id=nullif(b->>'primary_sector_id','')::uuid,manual_protected=true,
  scheduled_publish_at=case when p_schedule is not null then null else scheduled_publish_at end where id=p_issue;
 r:=private.m0_publish_legacy(p_issue,p_issue_revision,b->>'title',b->>'summary',b,b->>'_profile',p_policy,p_catalog,p_effect_key);
 delete from private.impacts where version_id=(r->>'version_id')::uuid;
 insert into private.impacts(version_id,sector_id,direction,path_id,conditions,evidence_ids)
 select (r->>'version_id')::uuid,(x->>'sector_id')::uuid,x->>'direction',x->>'path_id',x->'conditions',array(select value::uuid from jsonb_array_elements_text(x->'evidence_ids')) from jsonb_array_elements(b->'impacts') x;
 update private.outbox set payload=payload||jsonb_build_object('editor_request_hash',h,'editor_draft_revision',d.revision,'reservation_id',p_schedule) where effect_key=p_effect_key;
 if p_schedule is not null then
  update private.manual_publication_schedules set status='PUBLISHED',revision=revision+1,completed_at=clock_timestamp(),outcome_code='PUBLISHED' where id=p_schedule;
  update private.issues set scheduled_publish_at=null where id=p_issue;
 end if;
 insert into private.audits(actor_id,action,entity_id) values(p_actor::text,case when p_schedule is null then 'MANUAL_PUBLISH' else 'RESERVATION_PUBLISH' end,p_issue::text);
 if p_schedule is not null then perform private.reservation_assert_wallclock_evidence(p_issue);end if;
 return r;
end$$;

create or replace function private.reservation_tick() returns jsonb language plpgsql security definer set search_path='' as $$
declare at_time timestamptz:=clock_timestamp();candidate record;i private.issues;d private.editor_drafts;s private.manual_publication_schedules;reason text;r jsonb;n integer:=0;applied integer:=0;held integer:=0;expired integer:=0;skipped integer:=0;h bigint;pv bigint;
begin
 perform private.assert_server();perform private.assert_initialized();
 if not pg_try_advisory_xact_lock(70606,1) then return jsonb_build_object('status','BUSY');end if;
 for candidate in select id,issue_id from private.manual_publication_schedules where status='PENDING' and due_at<=clock_timestamp() order by due_at,id limit 20 loop
  exit when clock_timestamp()-at_time>=interval '4 seconds';
  begin
   select version into strict h from private.catalog_head where singleton for share;
   select * into strict i from private.issues where id=candidate.issue_id for update;
   select * into strict d from private.editor_drafts where issue_id=i.id for update;
   select * into strict s from private.manual_publication_schedules where id=candidate.id for update;
   if s.status<>'PENDING' then continue;end if;n:=n+1;reason:=null;
   select version into pv from private.policies where active;
   if s.expires_at<=clock_timestamp() then reason:='EXPIRED';
   elsif not private.reservation_actor_active(s.actor_id) then reason:='ACTOR_INACTIVE';
   elsif i.publication_state<>'DRAFT' or i.current_version_id is not null or i.first_published_at is not null or exists(select 1 from private.issue_aliases where alias_id=i.id) then reason:='ISSUE_NOT_DRAFT';
   elsif d.revision<>s.draft_revision or private.reservation_hash(d.content)<>s.content_hash then reason:='STALE_DRAFT';
   elsif i.revision<>s.issue_revision or i.scheduled_publish_at is distinct from s.due_at then reason:='STALE_ISSUE';
   elsif h<>s.catalog_version then reason:='STALE_CATALOG';
   elsif pv is distinct from s.policy_version then reason:='STALE_POLICY';
   elsif private.reservation_evidence_hash(i.id)<>s.evidence_digest then reason:='STALE_EVIDENCE';end if;
   if reason is null then
    begin
     r:=private.reservation_publish_core(i.id,d.revision,i.revision,s.policy_version,s.catalog_version,s.effect_key,s.actor_id,s.id);applied:=applied+1;
    exception when lock_not_available or query_canceled then raise;
    when others then
     if not private.reservation_expected_error(sqlstate,sqlerrm) then raise;end if;
     reason:=case when sqlerrm='RESERVATION_EVIDENCE_EXPIRED' then 'EVIDENCE_EXPIRED' else 'VALIDATION_FAILED' end;
    end;
   end if;
   if reason is not null then
    update private.manual_publication_schedules set status=case when reason='EXPIRED' then 'EXPIRED' else 'HELD' end,revision=revision+1,outcome_code=reason,completed_at=clock_timestamp() where id=s.id;
    update private.issues set scheduled_publish_at=null where id=i.id;
    if reason='EXPIRED' then expired:=expired+1;else held:=held+1;end if;
    insert into private.audits(actor_id,action,entity_id,details) values(s.actor_id::text,'RESERVATION_'||reason,s.id::text,jsonb_build_object('issue_id',i.id));
   end if;
  exception when lock_not_available then skipped:=skipped+1;
  end;
 end loop;
 r:=jsonb_build_object('status','OK','candidates',n,'published',applied,'held',held,'expired',expired,'lock_skipped',skipped);
 insert into private.maintenance_runs(kind,started_at,finished_at,result) values('RESERVATIONS',at_time,clock_timestamp(),r);return r;
end$$;

create or replace function public.maintenance_admin_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb;runs jsonb;at_time timestamptz:=clock_timestamp();
begin
 perform private.m1_assert_editor();
 select coalesce(jsonb_agg(jsonb_build_object('kind',j.kind,'registered',c.jobid is not null,'active',c.active,
 'schedule',c.schedule,'job_id',j.job_id,'state',private.maintenance_job_state(c.jobid is not null,c.active,d.runid is not null,d.status,d.start_time,j.created_at,j.kind,at_time),
 'last_started_at',d.start_time,'last_finished_at',d.end_time,'last_status',d.status,'last_error_code',case when d.status='failed' then 'CRON_EXECUTION_FAILED' else null end) order by j.kind),'[]') into jobs
 from private.maintenance_cron_jobs j left join cron.job c on c.jobid=j.job_id and c.jobname=j.job_name and private.reservation_hash(to_jsonb(c.command))=j.command_hash and c.schedule=case when j.kind='RETENTION' then '17 * * * *' else '* * * * *' end and c.username='postgres' and c.database=current_database() and c.active=j.enabled
 left join lateral(select runid,start_time,end_time,status from cron.job_run_details where jobid=j.job_id order by runid desc limit 1)d on true;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.started_at desc),'[]') into runs from(select kind,started_at,finished_at,result from private.maintenance_runs order by started_at desc limit 12)x;
 return jsonb_build_object('mode','LOCAL_SYNTHETIC','as_of',at_time,'jobs',jobs,'runs',runs,'real_push_sent',0,'backlog',jsonb_build_object(
 'pending',(select count(*) from private.manual_publication_schedules where status='PENDING'),'held',(select count(*) from private.manual_publication_schedules where status='HELD'),
 'next_due',(select min(due_at) from private.manual_publication_schedules where status='PENDING'),
 'oldest_pending',(select min(due_at) from private.manual_publication_schedules where status='PENDING' and due_at<=at_time),
 'corrections_due',(select count(*) from private.issues where publication_state='CORRECTION_PENDING' and correction_pending_since<=at_time-interval '24 hours'),
 'raw_expired',(select count(*) from private.installation_qa_views where accepted_at<=at_time-interval '30 days'),
 'oldest_expired_raw',(select min(accepted_at) from private.installation_qa_views where accepted_at<=at_time-interval '30 days')));
end$$;

create function public.maintenance_configure_for_admin(p_enabled boolean,p_actor uuid,p_auth_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 perform private.assert_server();perform private.assert_initialized();
 if not private.active_admin_user(p_actor,p_auth_session) or not exists(select 1 from private.admin_sessions where user_id=p_actor and auth_session_id=p_auth_session and revoked_at is null and expires_at>clock_timestamp()) then raise exception 'ADMIN_SESSION_FORBIDDEN' using errcode='42501';end if;
 r:=public.maintenance_configure(p_enabled);
 insert into private.audits(actor_id,action,entity_id) select p_actor::text,case when p_enabled then 'ADMIN_MAINTENANCE_ENABLE' else 'ADMIN_MAINTENANCE_PAUSE' end,bootstrap_id::text from private.runtime_identity where singleton;
 return r;
end$$;
revoke execute on function public.maintenance_configure_for_admin(boolean,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.maintenance_configure_for_admin(boolean,uuid,uuid) to service_role;
revoke execute on function private.reservation_assert_wallclock_evidence(uuid),private.reservation_evidence_commit_guard(),private.reservation_expected_error(text,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
