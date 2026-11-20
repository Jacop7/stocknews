-- Single-dispatch analysis intent and proposal receipt in an isolated P4 fixture.
begin;
do $$
begin
  if session_user <> 'postgres'
      or pg_catalog.current_database() !~ '^p4_[0-9a-f]{32}$'
      or pg_catalog.current_setting('judoju.ai_proposal_fixture_v1',true)
          is distinct from pg_catalog.current_database()
      or pg_catalog.to_regprocedure('ai_proposal_api.ai_proposal_save_v1(text,text,jsonb)') is null
  then
    raise exception 'AI_PROPOSAL_FIXTURE_REQUIRED';
  end if;
end;
$$;

create table ai_proposal_private.analysis_intents (
  effect_key text primary key,
  work_digest text not null,
  owner_nonce uuid not null,
  state text not null default 'INDETERMINATE'
    check (state in ('INDETERMINATE','HELD','NO_PROPOSAL','PROPOSAL_STORED')),
  proposal_id uuid references ai_proposal_private.proposals(proposal_id),
  proposal_digest text,
  check ((state='PROPOSAL_STORED') = (proposal_id is not null and proposal_digest is not null)),
  check ((proposal_id is null) = (proposal_digest is null))
);
revoke all on ai_proposal_private.analysis_intents from public,ai_proposal_executor_v1;

create function ai_proposal_api.ai_analysis_intent_v1(
  p_operation text, p_effect text, p_work_digest text, p_nonce uuid,
  p_proposal_digest text, p_proposal jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  intent ai_proposal_private.analysis_intents%rowtype;
  base jsonb;
  saved jsonb;
begin
  if p_operation is null or p_operation not in ('RESERVE','OBSERVE','FINISH','HOLD')
      or p_effect is null or p_effect !~ '^analysis:[0-9a-f]{64}$'
      or p_work_digest is null or p_work_digest !~ '^[0-9a-f]{64}$'
      or ((p_operation='OBSERVE') <> (p_nonce is null))
      or (p_operation<>'FINISH' and (p_proposal_digest is not null or p_proposal is not null))
      or ((p_proposal_digest is null) <> (p_proposal is null))
  then
    raise exception 'AI_ANALYSIS_INTENT_INVALID';
  end if;
  base := pg_catalog.jsonb_build_object('effectKey',p_effect,'workDigest',p_work_digest);
  if p_operation='RESERVE' then
    insert into ai_proposal_private.analysis_intents(effect_key,work_digest,owner_nonce)
    values(p_effect,p_work_digest,p_nonce)
    on conflict (effect_key) do nothing returning * into intent;
    if found then
      return base || '{"state":"START_ONCE"}'::jsonb;
    end if;
  end if;

  select * into intent from ai_proposal_private.analysis_intents where effect_key=p_effect for update;
  if not found then
    return base || '{"state":"NOT_FOUND"}'::jsonb;
  end if;
  if intent.work_digest<>p_work_digest
    or (p_operation in ('FINISH','HOLD') and intent.owner_nonce<>p_nonce)
  then
    return base || '{"state":"CONFLICT"}'::jsonb;
  end if;
  if p_operation='HOLD' and intent.state='INDETERMINATE' then
    update ai_proposal_private.analysis_intents set state='HELD'
      where effect_key=p_effect returning * into intent;
  elsif p_operation='HOLD' and intent.state<>'HELD' then
    return base || '{"state":"CONFLICT"}'::jsonb;
  elsif p_operation='FINISH' then
    if intent.state='INDETERMINATE' then
      if p_proposal is null then
        update ai_proposal_private.analysis_intents set state='NO_PROPOSAL'
          where effect_key=p_effect returning * into intent;
      else
        saved := ai_proposal_api.ai_proposal_save_v1(p_effect,p_proposal_digest,p_proposal);
        if saved->>'state' <> 'PENDING_DRAFT' then
          return base || '{"state":"CONFLICT"}'::jsonb;
        end if;
        update ai_proposal_private.analysis_intents
          set state='PROPOSAL_STORED',proposal_id=(saved->>'proposalId')::uuid,proposal_digest=p_proposal_digest
          where effect_key=p_effect returning * into intent;
      end if;
    elsif intent.state='HELD' or intent.proposal_digest is distinct from p_proposal_digest then
      return base || '{"state":"CONFLICT"}'::jsonb;
    end if;
  end if;
  base := base || pg_catalog.jsonb_build_object('state',intent.state);
  if intent.state='PROPOSAL_STORED' then
    return base || pg_catalog.jsonb_build_object('proposalId',intent.proposal_id,'proposalDigest',intent.proposal_digest);
  end if;
  return base;
end;
$$;

revoke all on function ai_proposal_api.ai_analysis_intent_v1(text,text,text,uuid,text,jsonb) from public;
grant execute on function ai_proposal_api.ai_analysis_intent_v1(text,text,text,uuid,text,jsonb) to ai_proposal_executor_v1;
commit;
