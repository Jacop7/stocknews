begin;
-- Publish stage 1B, Codex round-2 review fix: the cause of a real article's removal is stored on the issue itself, the
-- first time evidence is retracted, and never changed by later link states (a newer AI version waiting beside it) or
-- mechanical transitions (correction timeout). The editor list reads it before any state event.
alter table private.issues add column removal_cause text check (removal_cause in ('AI_SOURCE_REVOKED','FACT_RECORD_EXPIRED'));

create or replace function private.ai_retract_published(p_issue uuid,p_state text,p_reason text,p_effect_key text) returns jsonb language plpgsql set search_path='' as $$
declare st private.publication_state;r jsonb:=null;
begin
  -- Same lock order as intake and the editor save path: issue row, then draft row.
  select publication_state into strict st from private.issues where id=p_issue for update;
  perform 1 from private.editor_drafts where issue_id=p_issue for update;
  if st='DRAFT' then raise exception 'AI_ISSUE_NOT_PUBLISHED';end if;
  if p_reason not in ('AI_SOURCE_REVOKED','FACT_RECORD_EXPIRED') then raise exception 'TRANSITION_REASON_REQUIRED';end if;
  if st='PUBLISHED' or p_state='WITHDRAWN' and st<>'WITHDRAWN' then r:=private.m1_transition_internal(p_issue,p_state,p_reason,p_effect_key);end if;
  update private.issues set removal_cause=p_reason where id=p_issue and removal_cause is null;
  delete from private.ai_claim_links where issue_id=p_issue;
  delete from private.evidence_edges where claim_id in (select id from private.claims where issue_id=p_issue);
  delete from private.claims where issue_id=p_issue;
  delete from private.ai_draft_origin where issue_id=p_issue;
  return jsonb_build_object('state',(select publication_state from private.issues where id=p_issue),'transition',r);
end$$;
revoke all on function private.ai_retract_published(uuid,text,text,text) from public, anon, authenticated, service_role;

create or replace function public.m1_editor_articles() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(row_to_json(t)) from(select i.id,i.publication_state,i.revision,d.revision draft_revision,d.content->>'title' title,d.updated_at,i.sample_kind,
  (select jsonb_build_object('state',l.state,'ai_version',l.current_version,'facts',(select jsonb_array_length(o.facts) from private.ai_draft_origin o where o.issue_id=i.id order by o.ai_version desc limit 1))
   from private.ai_issue_links l where l.issue_id=i.id) ai_origin,
  case when i.publication_state in ('CORRECTION_PENDING','WITHDRAWN','HIDDEN') then coalesce(i.removal_cause,
    (select o.payload->>'reason' from private.outbox o where o.issue_id=i.id and o.event_type='ISSUE_'||i.publication_state::text order by o.created_at desc,o.id limit 1)) end state_reason
  from private.issues i join private.editor_drafts d on d.issue_id=i.id order by d.updated_at desc limit 100)t),'[]');end$$;
commit;
