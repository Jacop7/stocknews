begin;
create function public.reservation_create(p_issue uuid,p_draft_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_due_at text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.issues;d private.editor_drafts;s private.manual_publication_schedules;due timestamptz;h text;prior private.reservation_requests;r jsonb;b jsonb;sid uuid:=gen_random_uuid();
begin
 perform private.m1_assert_editor();
 if p_request is null or p_due_at is null or length(p_due_at)>50 or p_due_at!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'RESERVATION_INPUT_INVALID';end if;
 h:=private.reservation_hash(jsonb_build_object('operation','CREATE','issue',p_issue,'draft',p_draft_revision,'revision',p_issue_revision,'policy',p_policy,'catalog',p_catalog,'due',p_due_at));
 select * into prior from private.reservation_requests where actor_id=auth.uid() and request_id=p_request;
 if found then if prior.payload_hash<>h or prior.operation<>'CREATE' then raise exception 'REQUEST_PAYLOAD_CONFLICT';end if;return prior.result;end if;
 due:=p_due_at::timestamptz;
 if not isfinite(due) or due<clock_timestamp()+interval '60 seconds' or due>clock_timestamp()+interval '90 days' then raise exception 'RESERVATION_TIME_INVALID';end if;
 perform 1 from private.catalog_head where singleton for share;
 select * into strict i from private.issues where id=p_issue for update;
 select * into strict d from private.editor_drafts where issue_id=p_issue for update;
 -- A competing identical request may have finished while waiting for this issue.
 select * into prior from private.reservation_requests where actor_id=auth.uid() and request_id=p_request;
 if found then if prior.payload_hash<>h or prior.operation<>'CREATE' then raise exception 'REQUEST_PAYLOAD_CONFLICT';end if;return prior.result;end if;
 if i.publication_state<>'DRAFT' or i.first_published_at is not null or i.current_version_id is not null or i.sample_kind<>'SYNTHETIC'
 or exists(select 1 from private.issue_aliases where alias_id=i.id) then raise exception 'RESERVATION_DRAFT_REQUIRED';end if;
 if i.revision is distinct from p_issue_revision or d.revision is distinct from p_draft_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if i.scheduled_publish_at is not null or exists(select 1 from private.manual_publication_schedules where issue_id=p_issue and status='PENDING') then raise exception 'RESERVATION_PENDING';end if;
 b:=private.m1_prepare(i.id,d.content,p_policy,p_catalog);
 insert into private.manual_publication_schedules(id,issue_id,due_at,expires_at,actor_id,actor_auth_session_id,draft_revision,issue_revision,content_hash,policy_version,catalog_version,evidence_digest,request_id,request_hash,effect_key)
 values(sid,i.id,due,due+interval '15 minutes',auth.uid(),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid,d.revision,i.revision,private.reservation_hash(d.content),p_policy,p_catalog,private.reservation_evidence_hash(i.id),p_request,h,'reservation:'||sid::text);
 update private.issues set scheduled_publish_at=due where id=i.id;
 r:=jsonb_build_object('schedule_id',sid,'status','PENDING','revision',1,'due_at',due,'expires_at',due+interval '15 minutes');
 insert into private.reservation_requests values(auth.uid(),p_request,'CREATE',h,r,clock_timestamp());
 insert into private.audits(actor_id,action,entity_id,details) values(auth.uid()::text,'RESERVATION_CREATE',sid::text,jsonb_build_object('issue_id',i.id,'due_at',due));
 return r;
end$$;

create function public.reservation_cancel(p_schedule uuid,p_revision bigint,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.manual_publication_schedules;prior private.reservation_requests;h text;r jsonb;issue uuid;
begin
 perform private.m1_assert_editor();if p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 h:=private.reservation_hash(jsonb_build_object('operation','CANCEL','schedule',p_schedule,'revision',p_revision));
 select * into prior from private.reservation_requests where actor_id=auth.uid() and request_id=p_request;
 if found then if prior.operation<>'CANCEL' or prior.payload_hash<>h then raise exception 'REQUEST_PAYLOAD_CONFLICT';end if;return prior.result;end if;
 select issue_id into strict issue from private.manual_publication_schedules where id=p_schedule;
 perform 1 from private.catalog_head where singleton for share;perform 1 from private.issues where id=issue for update;
 perform 1 from private.editor_drafts where issue_id=issue for update;
 select * into strict s from private.manual_publication_schedules where id=p_schedule for update;
 select * into prior from private.reservation_requests where actor_id=auth.uid() and request_id=p_request;
 if found then if prior.operation<>'CANCEL' or prior.payload_hash<>h then raise exception 'REQUEST_PAYLOAD_CONFLICT';end if;return prior.result;end if;
 if s.status='PUBLISHED' then r:=jsonb_build_object('schedule_id',s.id,'status','ALREADY_PUBLISHED','revision',s.revision);
 elsif s.status<>'PENDING' then r:=jsonb_build_object('schedule_id',s.id,'status',s.status,'revision',s.revision);
 else
  if p_revision is distinct from s.revision then raise exception 'RESERVATION_CONFLICT' using errcode='40001';end if;
  update private.manual_publication_schedules set status='CANCELLED',revision=revision+1,completed_at=clock_timestamp(),outcome_code='CANCELLED' where id=s.id;
  update private.issues set scheduled_publish_at=null where id=issue;
  insert into private.audits(actor_id,action,entity_id) values(auth.uid()::text,'RESERVATION_CANCEL',s.id::text);
  r:=jsonb_build_object('schedule_id',s.id,'status','CANCELLED','revision',s.revision+1);
 end if;
 insert into private.reservation_requests values(auth.uid(),p_request,'CANCEL',h,r,clock_timestamp());return r;
end$$;
create function public.reservation_list(p_issue uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return jsonb_build_object('mode','LOCAL_SYNTHETIC','request_owner',private.reservation_hash(to_jsonb(auth.uid())),'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from
 (select s.id,s.issue_id,s.status,s.revision,s.due_at,s.expires_at,s.created_at,s.completed_at,s.outcome_code,s.draft_revision reserved_draft_revision,d.revision current_draft_revision,left(d.content->>'title',200) title
 from private.manual_publication_schedules s join private.editor_drafts d on d.issue_id=s.issue_id where p_issue is null or s.issue_id=p_issue order by s.created_at desc,s.id limit 100)x),'[]'), 'limit',100,'real_push_sent',0);end$$;
create function public.reservation_request_status(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return(select jsonb_build_object('operation',operation,'result',result) from private.reservation_requests where actor_id=auth.uid() and request_id=p_request);end$$;

create function private.reservation_tick() returns jsonb language plpgsql security definer set search_path='' as $$
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
    when others then reason:=case when sqlstate='40001' then 'REVISION_CONFLICT' else 'VALIDATION_FAILED' end;
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

create function private.correction_timeout_tick() returns jsonb language plpgsql security definer set search_path='' as $$
declare start_at timestamptz:=clock_timestamp();candidate record;i private.issues;n integer:=0;skipped integer:=0;k text;r jsonb;
begin
 perform private.assert_server();perform private.assert_initialized();
 if not pg_try_advisory_xact_lock(70606,2) then return jsonb_build_object('status','BUSY');end if;
 for candidate in select id from private.issues where publication_state='CORRECTION_PENDING' and correction_pending_since<=clock_timestamp()-interval '24 hours' order by correction_pending_since,id limit 20 loop
  exit when clock_timestamp()-start_at>=interval '4 seconds';
  begin
   perform 1 from private.catalog_head where singleton for share;
   select * into strict i from private.issues where id=candidate.id for update;
   if i.publication_state<>'CORRECTION_PENDING' or i.correction_pending_since is null or i.correction_pending_since>clock_timestamp()-interval '24 hours' then continue;end if;
   k:='correction-timeout:'||i.id::text||':'||i.revision::text;
   perform public.m0_set_publication_state(i.id,i.revision,'WITHDRAWN');
   insert into private.outbox(issue_id,event_type,effect_key,payload) values(i.id,'ISSUE_WITHDRAWN',k,jsonb_build_object('issue_id',i.id,'sample_kind','SYNTHETIC','reason','CORRECTION_TIMEOUT'));
   insert into private.audits(actor_id,action,entity_id) values('judoju-maintenance','CORRECTION_TIMEOUT',i.id::text);n:=n+1;
  exception when lock_not_available then skipped:=skipped+1;
  end;
 end loop;
 r:=jsonb_build_object('status','OK','withdrawn',n,'lock_skipped',skipped);
 insert into private.maintenance_runs(kind,started_at,finished_at,result) values('CORRECTIONS',start_at,clock_timestamp(),r);return r;
end$$;
revoke execute on function public.reservation_create(uuid,bigint,bigint,bigint,bigint,text,uuid),public.reservation_cancel(uuid,bigint,uuid),public.reservation_list(uuid),public.reservation_request_status(uuid) from public,anon,service_role;
grant execute on function public.reservation_create(uuid,bigint,bigint,bigint,bigint,text,uuid),public.reservation_cancel(uuid,bigint,uuid),public.reservation_list(uuid),public.reservation_request_status(uuid) to authenticated;
revoke execute on function private.reservation_tick(),private.correction_timeout_tick() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
