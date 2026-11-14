begin;
create table private.manual_publication_schedules (
 id uuid primary key default gen_random_uuid(), issue_id uuid not null references private.issues(id),
 status text not null default 'PENDING' check(status in ('PENDING','PUBLISHED','CANCELLED','HELD','EXPIRED')),
 revision bigint not null default 1, due_at timestamptz not null, expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(), actor_id uuid not null,actor_auth_session_id uuid not null,
 draft_revision bigint not null,issue_revision bigint not null,content_hash text not null,
 policy_version bigint not null,catalog_version bigint not null,evidence_digest text not null,
 request_id uuid not null,request_hash text not null,effect_key text not null unique,
 completed_at timestamptz,outcome_code text,unique(actor_id,request_id),check(expires_at=due_at+interval '15 minutes')
);
create unique index reservation_one_pending on private.manual_publication_schedules(issue_id) where status='PENDING';
create index reservation_due on private.manual_publication_schedules(due_at,id) where status='PENDING';
create table private.reservation_requests (
 actor_id uuid not null,request_id uuid not null,operation text not null check(operation in ('CREATE','CANCEL')),
 payload_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
create table private.maintenance_runs (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('RESERVATIONS','CORRECTIONS','RETENTION')),
 started_at timestamptz not null,finished_at timestamptz not null, result jsonb not null
);
create table private.maintenance_cron_jobs (
 kind text primary key check(kind in ('RESERVATIONS','CORRECTIONS','RETENTION')),
 job_id bigint not null unique,job_name text not null unique,command_hash text not null,
 bootstrap_id uuid not null,enabled boolean not null default true,created_at timestamptz not null default clock_timestamp()
);
alter table private.manual_publication_schedules enable row level security;
alter table private.reservation_requests enable row level security;
alter table private.maintenance_runs enable row level security;
alter table private.maintenance_cron_jobs enable row level security;
revoke all on private.manual_publication_schedules,private.reservation_requests,private.maintenance_runs,private.maintenance_cron_jobs from public,anon,authenticated;

create function private.reservation_hash(p_value jsonb) returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$$;
create function private.reservation_actor_active(p_actor uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from auth.users u join private.admin_memberships m on m.user_id=u.id
 where u.id=p_actor and m.active and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
 and u.raw_app_meta_data->>'app_role'='admin')
$$;
create function private.reservation_evidence_hash(p_issue uuid) returns text language sql stable set search_path='' as $$
 select private.reservation_hash(jsonb_build_object(
 'claims',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from private.claims c where c.issue_id=p_issue),
 'edges',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from private.evidence_edges e join private.claims c on c.id=e.claim_id where c.issue_id=p_issue)))
$$;

-- No public entry to this actor-aware core: wrappers establish editor or exact
-- server reservation authority, and acquire catalog -> issue -> draft locks.
create function private.reservation_publish_core(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text,p_actor uuid,p_schedule uuid)
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
 b:=private.m1_prepare(p_issue,d.content,p_policy,p_catalog);
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
 return r;
end$$;
create or replace function public.m1_publish_draft(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.m1_assert_editor();perform 1 from private.catalog_head where singleton for share;
 perform 1 from private.issues where id=p_issue for update;
 return private.reservation_publish_core(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key,auth.uid(),null);
end$$;

create function private.reservation_draft_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.revision is distinct from old.revision or new.content is distinct from old.content then
  update private.manual_publication_schedules set status='HELD',revision=revision+1,outcome_code='STALE_DRAFT',completed_at=clock_timestamp() where issue_id=new.issue_id and status='PENDING';
  if found then update private.issues set scheduled_publish_at=null where id=new.issue_id;end if;
 end if;return new;
end$$;
create trigger reservation_draft_changed after update on private.editor_drafts for each row execute function private.reservation_draft_changed();

alter table private.issues add column correction_pending_since timestamptz;
-- Older rows lack a trustworthy transition clock: start a documented grace period.
update private.issues set correction_pending_since=clock_timestamp() where publication_state='CORRECTION_PENDING';
create function private.correction_pending_clock() returns trigger language plpgsql set search_path='' as $$
begin
 if new.publication_state='CORRECTION_PENDING' then
  new.correction_pending_since:=case when tg_op='INSERT' or old.publication_state<>'CORRECTION_PENDING' then clock_timestamp() else old.correction_pending_since end;
 else new.correction_pending_since:=null;end if;return new;
end$$;
create trigger correction_pending_clock before insert or update on private.issues for each row execute function private.correction_pending_clock();
create index correction_pending_due on private.issues(correction_pending_since,id) where publication_state='CORRECTION_PENDING';
revoke execute on function private.reservation_hash(jsonb),private.reservation_actor_active(uuid),private.reservation_evidence_hash(uuid),private.reservation_publish_core(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid),private.reservation_draft_changed(),private.correction_pending_clock() from public,anon,authenticated,service_role;
revoke execute on function private.m1_publish_draft_v1(uuid,bigint,bigint,bigint,bigint,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
