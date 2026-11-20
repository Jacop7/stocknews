-- Run this file standalone in a fresh, isolated P4 fixture database.
begin;
do $$
begin
  if session_user <> 'postgres'
      or pg_catalog.current_database() !~ '^p4_[0-9a-f]{32}$'
      or pg_catalog.current_setting('judoju.ai_proposal_fixture_v1',true)
          is distinct from pg_catalog.current_database()
      or not exists (select 1 from pg_catalog.pg_roles where rolname='ai_proposal_executor_v1'
        and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb)
  then
    raise exception 'AI_PROPOSAL_FIXTURE_REQUIRED';
  end if;
end;
$$;

create schema ai_proposal_private;
create schema ai_proposal_api;
revoke all on schema ai_proposal_private, ai_proposal_api from public;
grant usage on schema ai_proposal_api to ai_proposal_executor_v1;

create table ai_proposal_private.proposals (
  proposal_id uuid primary key default pg_catalog.gen_random_uuid(),
  effect_key text unique not null,
  request_digest text not null,
  proposal jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table ai_proposal_private.draft_outbox (
  proposal_id uuid primary key references ai_proposal_private.proposals(proposal_id),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

create function ai_proposal_api.ai_proposal_lookup_v1(p_effect text, p_request_digest text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  found_row record;
  reply jsonb;
begin
  if p_effect is null or p_effect !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
  end if;
  reply := pg_catalog.jsonb_build_object('effectKey',p_effect,'requestDigest',p_request_digest);
  select p.proposal_id,p.request_digest into found_row
  from ai_proposal_private.proposals p
  join ai_proposal_private.draft_outbox o using (proposal_id)
  where p.effect_key=p_effect;
  if not found then
    return reply || '{"state":"NOT_FOUND"}'::jsonb;
  end if;
  if found_row.request_digest <> p_request_digest then
    return reply || '{"state":"CONFLICT"}'::jsonb;
  end if;
  return reply || pg_catalog.jsonb_build_object('state','PENDING_DRAFT','proposalId',found_row.proposal_id);
end;
$$;

create function ai_proposal_api.ai_proposal_save_v1(p_effect text,p_request_digest text,p_proposal jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  field text;
  prior record;
  inserted_id uuid;
  elements integer;
  distinct_elements integer;
  canonical text;
begin
  if p_effect is null or p_effect !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$'
      or pg_catalog.jsonb_typeof(p_proposal) is distinct from 'object' then
    raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_proposal)) <> 13 then
    raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
  end if;
  foreach field in array array['inputDigest','bodyDigest','policyDigest','catalogDigest',
      'modelRequestDigest','analysisValidationDigest'] loop
    if pg_catalog.jsonb_typeof(p_proposal->field) is distinct from 'string'
        or (p_proposal->>field) !~ '^[a-f0-9]{64}$' then
      raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
    end if;
  end loop;
  foreach field in array array['action','issueId','issueVersion','expectedDraftRevision','angleCode'] loop
    if pg_catalog.jsonb_typeof(p_proposal->field) is distinct from 'string' then
      raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
    end if;
  end loop;
  if (p_proposal->>'action') not in ('UPDATE','CORRECTION')
      or (p_proposal->>'issueId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (p_proposal->>'expectedDraftRevision') !~ '^(0|[1-9][0-9]{0,18})$'
      or (p_proposal->>'issueVersion') !~ '^[a-zA-Z0-9_.:-]{1,160}$'
      or (p_proposal->>'angleCode') !~ '^[a-zA-Z0-9_.:-]{1,160}$' then
    raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
  end if;
  if (p_proposal->>'expectedDraftRevision')::numeric > 9223372036854775807 then
    raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
  end if;
  foreach field in array array['claimIds','pathIds'] loop
    if pg_catalog.jsonb_typeof(p_proposal->field) is distinct from 'array'
        or pg_catalog.jsonb_array_length(p_proposal->field) > 100 then
      raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
    end if;
    if exists (select 1 from pg_catalog.jsonb_array_elements(p_proposal->field) e(value)
        where pg_catalog.jsonb_typeof(e.value) <> 'string'
          or (e.value #>> array[]::text[]) !~ '^[a-zA-Z0-9_.:-]{1,160}$') then
      raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
    end if;
    select pg_catalog.count(*),pg_catalog.count(distinct value)
      into elements,distinct_elements from pg_catalog.jsonb_array_elements(p_proposal->field);
    if elements <> distinct_elements then
      raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
    end if;
  end loop;

  canonical := pg_catalog.concat_ws(pg_catalog.chr(10),'AI_PROPOSAL_OUTBOX_V1',
    p_effect,p_proposal->>'issueId',p_proposal->>'action',p_proposal->>'angleCode',p_proposal->>'issueVersion',
    p_proposal->>'expectedDraftRevision',
    coalesce((select pg_catalog.string_agg(value,',' order by ordinal)
      from pg_catalog.jsonb_array_elements_text(p_proposal->'claimIds') with ordinality e(value,ordinal)),''),
    coalesce((select pg_catalog.string_agg(value,',' order by ordinal)
      from pg_catalog.jsonb_array_elements_text(p_proposal->'pathIds') with ordinality e(value,ordinal)),''),
    p_proposal->>'inputDigest',p_proposal->>'bodyDigest',p_proposal->>'policyDigest',
    p_proposal->>'catalogDigest',p_proposal->>'modelRequestDigest',p_proposal->>'analysisValidationDigest');
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(canonical,'UTF8')),'hex') <> p_request_digest then
    raise exception 'AI_PROPOSAL_OUTBOX_INVALID';
  end if;

  insert into ai_proposal_private.proposals (effect_key,request_digest,proposal)
  values (p_effect,p_request_digest,p_proposal)
  on conflict (effect_key) do nothing returning proposal_id into inserted_id;
  if inserted_id is not null then
    insert into ai_proposal_private.draft_outbox (proposal_id) values (inserted_id);
    return pg_catalog.jsonb_build_object('state','PENDING_DRAFT','effectKey',p_effect,
      'requestDigest',p_request_digest,'proposalId',inserted_id);
  end if;
  select p.request_digest,p.proposal into strict prior
    from ai_proposal_private.proposals p where p.effect_key=p_effect;
  if prior.request_digest <> p_request_digest or prior.proposal <> p_proposal then
    return pg_catalog.jsonb_build_object('state','CONFLICT','effectKey',p_effect,'requestDigest',p_request_digest);
  end if;
  return ai_proposal_api.ai_proposal_lookup_v1(p_effect,p_request_digest);
end;
$$;

revoke all on function ai_proposal_api.ai_proposal_save_v1(text,text,jsonb),
  ai_proposal_api.ai_proposal_lookup_v1(text,text) from public;
grant execute on function ai_proposal_api.ai_proposal_save_v1(text,text,jsonb),
  ai_proposal_api.ai_proposal_lookup_v1(text,text) to ai_proposal_executor_v1;

commit;
