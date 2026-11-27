begin;
-- Publish stage 1B, Codex step-1 review (HOLD) fixes for migration 59.
-- 1. A withdrawal is stale only when it is older than the evidence the issue actually carries (its claims' AI
--    version), not older than the newest version seen. When v1 is published and v2 waits beside it (HOLD_EDITOR),
--    withdrawing v1 now retracts the published v1 evidence; the waiting v2 evidence goes with it (the source is
--    withdrawn, and adopting a newer version is stage 1C). The link keeps the newest version number.
-- 2. The editor list keeps the cause of a real article's removal (source withdrawn or record expired) after later
--    mechanical transitions such as the correction timeout, and also when the article was already off the public view
--    when the withdrawal arrived.

create or replace function private.ai_withdraw_draft(p_ai_issue text,p_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare lnk private.ai_issue_links;result jsonb;retract jsonb:=null;evidence integer;linked boolean;
begin
  if current_user<>'postgres' then raise exception 'AI_INBOX_POSTGRES_ONLY';end if;
  if p_ai_issue is null or p_ai_issue!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_version is null or p_version<1
    or length(coalesce(p_reason,'')) not between 1 and 80 then raise exception 'AI_WITHDRAW_INVALID';end if;
  perform pg_advisory_xact_lock(hashtext('ai-issue:'||p_ai_issue));
  select * into lnk from private.ai_issue_links where ai_issue_id=p_ai_issue for update;
  linked:=found;
  if linked and lnk.issue_id is not null then
    select max(c.ai_version) into evidence from private.ai_claim_links c where c.issue_id=lnk.issue_id;
  end if;
  if not linked then
    -- Withdrawal before any draft arrived: a tombstone stops this and older versions.
    insert into private.ai_issue_links(ai_issue_id,issue_id,current_version,state,reason) values(p_ai_issue,null,p_version,'WITHDRAWN',p_reason);
    result:=jsonb_build_object('state','WITHDRAWN','ai_version',p_version,'tombstone',true);
  elsif p_version<coalesce(evidence,lnk.current_version) then
    result:=jsonb_build_object('state','STALE_VERSION','ai_version',p_version,'current_version',lnk.current_version);
  else
    if lnk.issue_id is not null then
      if exists(select 1 from private.issues where id=lnk.issue_id and publication_state<>'DRAFT') then
        retract:=private.ai_retract_published(lnk.issue_id,'CORRECTION_PENDING','AI_SOURCE_REVOKED','ai-withdraw:'||p_ai_issue||':'||p_version);
      else
        perform private.ai_clear_issue(lnk.issue_id);
      end if;
    end if;
    update private.ai_issue_links set current_version=greatest(current_version,p_version),state='WITHDRAWN',reason=p_reason,updated_at=now() where ai_issue_id=p_ai_issue;
    result:=jsonb_build_object('state','WITHDRAWN','ai_version',p_version,'issue_id',lnk.issue_id);
    if retract is not null then result:=result||jsonb_build_object('issue_state',retract->>'state');end if;
  end if;
  insert into private.audits(actor_id,action,entity_id,details) values('ai-inbox','AI_DRAFT_WITHDRAW_'||(result->>'state'),p_ai_issue,jsonb_build_object('ai_version',p_version,'reason',p_reason));
  return result;
end$$;

-- The cause comes from the AI link (durable, set only by withdrawal or record expiry of a once-published issue), the
-- latest state event otherwise.
create or replace function public.m1_editor_articles() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(row_to_json(t)) from(select i.id,i.publication_state,i.revision,d.revision draft_revision,d.content->>'title' title,d.updated_at,i.sample_kind,
  (select jsonb_build_object('state',l.state,'ai_version',l.current_version,'facts',(select jsonb_array_length(o.facts) from private.ai_draft_origin o where o.issue_id=i.id order by o.ai_version desc limit 1))
   from private.ai_issue_links l where l.issue_id=i.id) ai_origin,
  case when i.publication_state in ('CORRECTION_PENDING','WITHDRAWN','HIDDEN') then coalesce(
    (select case when l.reason='EXPIRED' then 'FACT_RECORD_EXPIRED' else 'AI_SOURCE_REVOKED' end from private.ai_issue_links l
      where l.issue_id=i.id and l.state='WITHDRAWN' and i.first_published_at is not null),
    (select o.payload->>'reason' from private.outbox o where o.issue_id=i.id and o.event_type='ISSUE_'||i.publication_state::text order by o.created_at desc,o.id limit 1)) end state_reason
  from private.issues i join private.editor_drafts d on d.issue_id=i.id order by d.updated_at desc limit 100)t),'[]');end$$;
commit;
