CREATE OR REPLACE FUNCTION private.reservation_publish_core_v1(p_issue uuid, p_expected_revision bigint, p_issue_revision bigint, p_policy bigint, p_catalog bigint, p_effect_key text, p_actor uuid, p_schedule uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end$function$

