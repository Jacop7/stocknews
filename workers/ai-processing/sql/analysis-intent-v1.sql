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

-- One pending angle per story, with independent evidence attached to each delivering intent.
create table ai_proposal_private.pending_angles (
  angle_id uuid primary key default pg_catalog.gen_random_uuid(),
  story_id text not null,
  angle_code text not null,
  unique (story_id,angle_code)
);

create table ai_proposal_private.analysis_intents (
  effect_key text primary key,
  work_digest text not null,
  owner_nonce uuid not null,
  state text not null default 'INDETERMINATE'
    check (state in ('INDETERMINATE','HELD','NO_PROPOSAL','PROPOSAL_STORED','ANGLE_PENDING')),
  proposal_id uuid references ai_proposal_private.proposals(proposal_id),
  proposal_digest text,
  check ((state='PROPOSAL_STORED') = (proposal_id is not null and proposal_digest is not null)),
  angle_id uuid references ai_proposal_private.pending_angles(angle_id),
  angle_digest text,
  angle_candidate jsonb,
  check ((proposal_id is null) = (proposal_digest is null)),
  check ((state='ANGLE_PENDING') = (angle_id is not null)),
  check ((angle_id is null) = (angle_digest is null)),
  check ((angle_id is null) = (angle_candidate is null))
);
revoke all on ai_proposal_private.analysis_intents,ai_proposal_private.pending_angles from public,ai_proposal_executor_v1;

create function ai_proposal_private.angle_digest_v1(p_effect text,p_candidate jsonb)
returns text language plpgsql immutable set search_path='' as $$
declare
  field text;
  item jsonb;
  seen text[];
  issue_list text[] := array[]::text[];
  claim_list text[];
  path_list text[];
  id_pattern constant text := '^[a-zA-Z0-9_.:-]{1,160}$';
  canonical text;
begin
  if pg_catalog.jsonb_typeof(p_candidate) is distinct from 'object'
    or pg_catalog.pg_column_size(p_candidate)>131072
  then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_candidate))<>12 then
    raise exception 'AI_ANGLE_CANDIDATE_INVALID';
  end if;
  foreach field in array array['storyId','storyVersion','angleCode'] loop
    if pg_catalog.jsonb_typeof(p_candidate->field) is distinct from 'string'
      or (p_candidate->>field) collate "C" !~ id_pattern
    then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
  end loop;
  foreach field in array array['inputDigest','bodyDigest','policyDigest','catalogDigest','routingDigest','validationDigest'] loop
    if pg_catalog.jsonb_typeof(p_candidate->field) is distinct from 'string'
      or (p_candidate->>field) collate "C" !~ '^[a-f0-9]{64}$'
    then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
  end loop;
  if pg_catalog.jsonb_typeof(p_candidate->'issueVersions') is distinct from 'array' then
    raise exception 'AI_ANGLE_CANDIDATE_INVALID';
  end if;
  if pg_catalog.jsonb_array_length(p_candidate->'issueVersions') > 100 then
    raise exception 'AI_ANGLE_CANDIDATE_INVALID';
  end if;
  seen := array[]::text[];
  for item in select value from pg_catalog.jsonb_array_elements(p_candidate->'issueVersions') loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object' then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
      or pg_catalog.jsonb_typeof(item->'issueId') is distinct from 'string'
      or pg_catalog.jsonb_typeof(item->'issueVersion') is distinct from 'string'
      or (item->>'issueId') collate "C" !~ id_pattern or (item->>'issueVersion') collate "C" !~ id_pattern
      or (item->>'issueId')=any(seen)
    then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
    seen := pg_catalog.array_append(seen,item->>'issueId');
    issue_list := pg_catalog.array_append(issue_list,(item->>'issueId')||','||(item->>'issueVersion'));
  end loop;
  foreach field in array array['claimIds','pathIds'] loop
    if pg_catalog.jsonb_typeof(p_candidate->field) is distinct from 'array' then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
    if pg_catalog.jsonb_array_length(p_candidate->field)>300 then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
    seen := array[]::text[];
    for item in select value from pg_catalog.jsonb_array_elements(p_candidate->field) loop
      if pg_catalog.jsonb_typeof(item) is distinct from 'string' or (item#>>'{}') collate "C" !~ id_pattern
        or (item#>>'{}')=any(seen)
      then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
      seen := pg_catalog.array_append(seen,item#>>'{}');
    end loop;
    if field='claimIds' then claim_list:=seen; else path_list:=seen; end if;
  end loop;
  if pg_catalog.cardinality(claim_list)=0 or
    (pg_catalog.cardinality(issue_list)=0 and pg_catalog.cardinality(path_list)=0)
  then raise exception 'AI_ANGLE_CANDIDATE_INVALID'; end if;
  canonical := pg_catalog.concat_ws(pg_catalog.chr(10),'AI_ANGLE_CANDIDATE_V1',
    p_effect,p_candidate->>'storyId',p_candidate->>'storyVersion',p_candidate->>'angleCode',
    pg_catalog.array_to_string(issue_list,';'),pg_catalog.array_to_string(claim_list,','),pg_catalog.array_to_string(path_list,','),
    p_candidate->>'inputDigest',p_candidate->>'bodyDigest',p_candidate->>'policyDigest',p_candidate->>'catalogDigest',
    p_candidate->>'routingDigest',p_candidate->>'validationDigest');
  return pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(canonical,'UTF8')),'hex');
end;
$$;
revoke all on function ai_proposal_private.angle_digest_v1(text,jsonb) from public,ai_proposal_executor_v1;

create function ai_proposal_api.ai_analysis_intent_v1(
  p_operation text, p_effect text, p_work_digest text, p_nonce uuid,
  p_proposal_digest text, p_proposal jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  intent ai_proposal_private.analysis_intents%rowtype;
  base jsonb;
  saved jsonb;
  queued_id uuid;
begin
  if p_operation is null or p_operation not in ('RESERVE','OBSERVE','FINISH','HOLD','QUEUE_ANGLE')
      or p_effect is null or p_effect !~ '^analysis:[0-9a-f]{64}$'
      or p_work_digest is null or p_work_digest !~ '^[0-9a-f]{64}$'
      or ((p_operation='OBSERVE') <> (p_nonce is null))
      or (p_operation not in ('FINISH','QUEUE_ANGLE') and (p_proposal_digest is not null or p_proposal is not null))
      or (p_operation='QUEUE_ANGLE' and p_proposal is null)
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

  if p_operation='OBSERVE' then
    select * into intent from ai_proposal_private.analysis_intents where effect_key=p_effect;
  else
    select * into intent from ai_proposal_private.analysis_intents where effect_key=p_effect for update;
  end if;
  if not found then
    return base || '{"state":"NOT_FOUND"}'::jsonb;
  end if;
  if intent.work_digest<>p_work_digest
    or (p_operation in ('FINISH','HOLD','QUEUE_ANGLE') and intent.owner_nonce<>p_nonce)
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
    elsif intent.state not in ('NO_PROPOSAL','PROPOSAL_STORED')
      or intent.proposal_digest is distinct from p_proposal_digest then
      return base || '{"state":"CONFLICT"}'::jsonb;
    end if;
  elsif p_operation='QUEUE_ANGLE' then
    if ai_proposal_private.angle_digest_v1(p_effect,p_proposal) is distinct from p_proposal_digest then
      raise exception 'AI_ANGLE_CANDIDATE_INVALID';
    end if;
    if intent.state='INDETERMINATE' then
      insert into ai_proposal_private.pending_angles(story_id,angle_code)
        values(p_proposal->>'storyId',p_proposal->>'angleCode')
        on conflict (story_id,angle_code) do nothing returning angle_id into queued_id;
      if queued_id is null then
        select angle_id into strict queued_id from ai_proposal_private.pending_angles
          where story_id=p_proposal->>'storyId' and angle_code=p_proposal->>'angleCode';
      end if;
      update ai_proposal_private.analysis_intents
        set state='ANGLE_PENDING',angle_id=queued_id,angle_digest=p_proposal_digest,angle_candidate=p_proposal
        where effect_key=p_effect returning * into intent;
    elsif intent.state<>'ANGLE_PENDING' or intent.angle_digest is distinct from p_proposal_digest
      or intent.angle_candidate is distinct from p_proposal then
      return base || '{"state":"CONFLICT"}'::jsonb;
    end if;
  end if;
  base := base || pg_catalog.jsonb_build_object('state',intent.state);
  if intent.state='PROPOSAL_STORED' then
    return base || pg_catalog.jsonb_build_object('proposalId',intent.proposal_id,'proposalDigest',intent.proposal_digest);
  end if;
  if intent.state='ANGLE_PENDING' then
    return base || pg_catalog.jsonb_build_object('angleId',intent.angle_id,
      'angleDigest',intent.angle_digest,'candidate',intent.angle_candidate);
  end if;
  return base;
end;
$$;

revoke all on function ai_proposal_api.ai_analysis_intent_v1(text,text,text,uuid,text,jsonb) from public;
grant execute on function ai_proposal_api.ai_analysis_intent_v1(text,text,text,uuid,text,jsonb) to ai_proposal_executor_v1;
commit;
