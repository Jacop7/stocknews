-- B3. Publish dispatch by issue kind. Synthetic issues keep the unchanged chain. A real issue is published only while
-- real articles are the public kind, only from an ACTIVE AI link, and never by reservation. An exact replay of an
-- applied publish still gets its stored answer from the core (effect key first).
create or replace function private.reservation_publish_core(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text,p_actor uuid,p_schedule uuid)
returns jsonb language plpgsql set search_path='' as $$
declare k private.sample_kind;st text;
begin
  select sample_kind into k from private.issues where id=p_issue for update;
  if k is distinct from 'PERMITTED_REAL' then
    return private.reservation_publish_core_v1(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key,p_actor,p_schedule);
  end if;
  if p_schedule is not null then raise exception 'REAL_PUBLICATION_NOT_ENABLED_1A';end if;
  if not exists(select 1 from private.outbox where effect_key=p_effect_key) then
    if private.public_read_kind()<>'PERMITTED_REAL' then raise exception 'REAL_PUBLIC_READ_OFF';end if;
    select l.state into st from private.ai_issue_links l where l.issue_id=p_issue;
    if st is null or st='WITHDRAWN' then raise exception 'AI_SOURCE_WITHDRAWN';end if;
    if st<>'ACTIVE' then raise exception 'AI_DRAFT_HELD';end if;
  end if;
  return private.reservation_publish_core_real(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key,p_actor,p_schedule);
end$$;

-- B4. Internal state change (owner only, no editor session): the same transition as an editor's, with the event
-- carrying the issue's own kind and a reason. The same effect key always returns the same answer.
create function private.m1_transition_internal(p_issue uuid,p_state text,p_reason text,p_effect_key text) returns jsonb language plpgsql set search_path='' as $$
declare i private.issues;prior private.outbox;
begin
  if p_state not in ('CORRECTION_PENDING','WITHDRAWN','HIDDEN') then raise exception 'INVALID_TRANSITION';end if;
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  if p_reason is null or p_reason!~'^[A-Z][A-Z0-9_]{2,79}$' then raise exception 'TRANSITION_REASON_REQUIRED';end if;
  select * into strict i from private.issues where id=p_issue for update;
  select * into prior from private.outbox where effect_key=p_effect_key;
  if found then
    if prior.issue_id is distinct from p_issue or prior.event_type<>'ISSUE_'||p_state or prior.payload->>'reason' is distinct from p_reason then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
    return jsonb_build_object('status','ALREADY_APPLIED','issue_id',i.id,'state',i.publication_state,'revision',i.revision);
  end if;
  if i.publication_state='DRAFT' then raise exception 'INVALID_TRANSITION';end if;
  if i.publication_state::text=p_state then return jsonb_build_object('status','UNCHANGED','issue_id',i.id,'state',i.publication_state,'revision',i.revision);end if;
  update private.issues set publication_state=p_state::private.publication_state,revision=revision+1 where id=i.id;
  insert into private.outbox(issue_id,event_type,effect_key,payload) values(i.id,'ISSUE_'||p_state,p_effect_key,jsonb_build_object('issue_id',i.id,'sample_kind',i.sample_kind,'reason',p_reason));
  insert into private.audits(actor_id,action,entity_id,details) values('judoju-maintenance','INTERNAL_'||p_state,i.id::text,jsonb_build_object('reason',p_reason));
  return jsonb_build_object('status','APPLIED','issue_id',i.id,'state',p_state,'revision',i.revision+1);
end$$;

-- A published (or once published) real issue loses its evidence at once: hidden first (a published article moves to
-- the given state), then claims, their links and edges and every evidence record go. The analysis text stays in its
-- version for audit but is never public again: without claims it fails every evidence check. The editor draft and the
-- editor's ownership stay, so a later AI version only waits beside it (HOLD_EDITOR); adopting it is stage 1C.
create function private.ai_retract_published(p_issue uuid,p_state text,p_reason text,p_effect_key text) returns jsonb language plpgsql set search_path='' as $$
declare st private.publication_state;r jsonb:=null;
begin
  -- Same lock order as intake and the editor save path: issue row, then draft row.
  select publication_state into strict st from private.issues where id=p_issue for update;
  perform 1 from private.editor_drafts where issue_id=p_issue for update;
  if st='DRAFT' then raise exception 'AI_ISSUE_NOT_PUBLISHED';end if;
  if st='PUBLISHED' or p_state='WITHDRAWN' and st<>'WITHDRAWN' then r:=private.m1_transition_internal(p_issue,p_state,p_reason,p_effect_key);end if;
  delete from private.ai_claim_links where issue_id=p_issue;
  delete from private.evidence_edges where claim_id in (select id from private.claims where issue_id=p_issue);
  delete from private.claims where issue_id=p_issue;
  delete from private.ai_draft_origin where issue_id=p_issue;
  return jsonb_build_object('state',(select publication_state from private.issues where id=p_issue),'transition',r);
end$$;

-- Withdrawal now also covers published issues (drafts are cleared exactly as before).
create or replace function private.ai_withdraw_draft(p_ai_issue text,p_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare lnk private.ai_issue_links;result jsonb;retract jsonb:=null;
begin
  if current_user<>'postgres' then raise exception 'AI_INBOX_POSTGRES_ONLY';end if;
  if p_ai_issue is null or p_ai_issue!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_version is null or p_version<1
    or length(coalesce(p_reason,'')) not between 1 and 80 then raise exception 'AI_WITHDRAW_INVALID';end if;
  perform pg_advisory_xact_lock(hashtext('ai-issue:'||p_ai_issue));
  select * into lnk from private.ai_issue_links where ai_issue_id=p_ai_issue for update;
  if not found then
    -- Withdrawal before any draft arrived: a tombstone stops this and older versions.
    insert into private.ai_issue_links(ai_issue_id,issue_id,current_version,state,reason) values(p_ai_issue,null,p_version,'WITHDRAWN',p_reason);
    result:=jsonb_build_object('state','WITHDRAWN','ai_version',p_version,'tombstone',true);
  elsif p_version<lnk.current_version then
    result:=jsonb_build_object('state','STALE_VERSION','ai_version',p_version,'current_version',lnk.current_version);
  else
    if lnk.issue_id is not null then
      if exists(select 1 from private.issues where id=lnk.issue_id and publication_state<>'DRAFT') then
        retract:=private.ai_retract_published(lnk.issue_id,'CORRECTION_PENDING','AI_SOURCE_REVOKED','ai-withdraw:'||p_ai_issue||':'||p_version);
      else
        perform private.ai_clear_issue(lnk.issue_id);
      end if;
    end if;
    update private.ai_issue_links set current_version=p_version,state='WITHDRAWN',reason=p_reason,updated_at=now() where ai_issue_id=p_ai_issue;
    result:=jsonb_build_object('state','WITHDRAWN','ai_version',p_version,'issue_id',lnk.issue_id);
    if retract is not null then result:=result||jsonb_build_object('issue_state',retract->>'state');end if;
  end if;
  insert into private.audits(actor_id,action,entity_id,details) values('ai-inbox','AI_DRAFT_WITHDRAW_'||(result->>'state'),p_ai_issue,jsonb_build_object('ai_version',p_version,'reason',p_reason));
  return result;
end$$;

-- 30-day record rule for published real articles: once any fact record of the issue is past its 30 days, the article
-- (already hidden by the currency check) is withdrawn and its evidence deleted. Busy issues wait for the next run.
alter function private.ai_inbox_cleanup() rename to ai_inbox_cleanup_v1;
create function private.ai_inbox_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;skipped integer:=0;base jsonb;
begin
  base:=private.ai_inbox_cleanup_v1();
  for r in select i.id,i.revision,(select l.ai_issue_id from private.ai_issue_links l where l.issue_id=i.id) ai from private.issues i
    where i.sample_kind='PERMITTED_REAL' and i.publication_state<>'DRAFT' and exists(select 1 from private.claims c where c.issue_id=i.id and c.valid_until<=now())
    order by i.id limit 200 loop
    if r.ai is not null and not pg_try_advisory_xact_lock(hashtext('ai-issue:'||r.ai)) then skipped:=skipped+1;continue;end if;
    if not exists(select 1 from private.issues where id=r.id for update skip locked)
      or exists(select 1 from private.editor_drafts where issue_id=r.id) and not exists(select 1 from private.editor_drafts where issue_id=r.id for update skip locked) then
      skipped:=skipped+1;continue;
    end if;
    -- Re-read under the locks.
    if not exists(select 1 from private.issues i where i.id=r.id and i.publication_state<>'DRAFT'
      and exists(select 1 from private.claims c where c.issue_id=i.id and c.valid_until<=now())) then continue;end if;
    perform private.ai_retract_published(r.id,'WITHDRAWN','FACT_RECORD_EXPIRED','ai-expire:'||r.id||':'||(select revision from private.issues where id=r.id));
    update private.ai_issue_links set state='WITHDRAWN',reason='EXPIRED',updated_at=now() where issue_id=r.id;
    n:=n+1;
  end loop;
  return base||jsonb_build_object('published_expired',n,'published_skipped_busy',skipped);
end$$;

-- B7. Editor list: the reason of the latest internal or editor state change, for withdrawn or expired real articles.
create or replace function public.m1_editor_articles() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(row_to_json(t)) from(select i.id,i.publication_state,i.revision,d.revision draft_revision,d.content->>'title' title,d.updated_at,i.sample_kind,
  (select jsonb_build_object('state',l.state,'ai_version',l.current_version,'facts',(select jsonb_array_length(o.facts) from private.ai_draft_origin o where o.issue_id=i.id order by o.ai_version desc limit 1))
   from private.ai_issue_links l where l.issue_id=i.id) ai_origin,
  case when i.publication_state in ('CORRECTION_PENDING','WITHDRAWN','HIDDEN') then (select o.payload->>'reason' from private.outbox o
    where o.issue_id=i.id and o.event_type='ISSUE_'||i.publication_state::text order by o.created_at desc,o.id limit 1) end state_reason
  from private.issues i join private.editor_drafts d on d.issue_id=i.id order by d.updated_at desc limit 100)t),'[]');end$$;

-- New private functions: owner only. Renamed predecessors keep their old ACL on rename; they are internal now.
revoke all on function private.public_read_kind(), private.m0_publish_real(uuid,bigint,text,text,jsonb,text,bigint,bigint,text),
  private.reservation_publish_core_real(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid), private.m1_transition_internal(uuid,text,text,text),
  private.ai_retract_published(uuid,text,text,text), private.ai_inbox_cleanup(), private.ai_inbox_cleanup_v1()
  from public, anon, authenticated, service_role;
commit;
