-- Standalone installation in the same isolated P4 fixture as the outbox and catalog.
begin;
do $$
begin
  if session_user <> 'postgres'
      or pg_catalog.current_database() !~ '^p4_[0-9a-f]{32}$'
      or pg_catalog.current_setting('judoju.ai_proposal_fixture_v1',true)
          is distinct from pg_catalog.current_database()
      or pg_catalog.to_regprocedure('public.catalog_save_draft(uuid,bigint,jsonb,bigint)') is null
      or pg_catalog.to_regprocedure('ai_proposal_api.ai_proposal_lookup_v1(text,text)') is null
  then
    raise exception 'AI_DRAFT_APPLY_FIXTURE_REQUIRED';
  end if;
end;
$$;

-- Only the fixture authority seeds this table after checking the current
-- source, body, policy and catalog bindings. Neither worker nor editor can write it.
create table ai_proposal_private.draft_apply_context (
  proposal_id uuid primary key references ai_proposal_private.proposals(proposal_id),
  current_proposal jsonb not null,
  catalog_version bigint not null check (catalog_version > 0),
  policy_version bigint not null check (policy_version > 0),
  usable_until timestamptz not null check (pg_catalog.isfinite(usable_until)),
  draft_content jsonb not null check (pg_catalog.jsonb_typeof(draft_content)='object')
);
revoke all on ai_proposal_private.draft_apply_context from public, authenticated, ai_proposal_executor_v1;

create function ai_proposal_api.ai_proposal_apply_draft_v1(p_effect text,p_request_digest text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  receipt jsonb;
  reply jsonb;
  proposal_id_value uuid;
  issue_id_value uuid;
  expected_issue_revision text;
  expected_draft_revision bigint;
  current_draft_revision bigint;
  applied_revision bigint;
  stored_proposal jsonb;
  context ai_proposal_private.draft_apply_context%rowtype;
  saved jsonb;
begin
  perform private.m1_assert_editor();
  receipt := ai_proposal_api.ai_proposal_lookup_v1(p_effect,p_request_digest);
  if receipt->>'state' <> 'PENDING_DRAFT' then
    return receipt;
  end if;
  reply := pg_catalog.jsonb_build_object('effectKey',p_effect,'requestDigest',p_request_digest);
  proposal_id_value := (receipt->>'proposalId')::uuid;

  -- Serialize consumers of this item. Catalog-before-issue ordering below
  -- matches the existing manual draft RPC.
  select o.applied_draft_revision into strict applied_revision
    from ai_proposal_private.draft_outbox o where o.proposal_id=proposal_id_value for update;
  if applied_revision is not null then
    return reply || pg_catalog.jsonb_build_object('state','DRAFT_APPLIED','proposalId',proposal_id_value,
      'draftRevision',applied_revision::text);
  end if;
  select p.proposal into strict stored_proposal
    from ai_proposal_private.proposals p where p.proposal_id=proposal_id_value;
  select * into context from ai_proposal_private.draft_apply_context c
    where c.proposal_id=proposal_id_value for share;
  if not found or context.current_proposal is distinct from stored_proposal
      or context.usable_until <= pg_catalog.clock_timestamp() then
    return reply || '{"state":"STALE_CONTEXT"}'::jsonb;
  end if;

  issue_id_value := (stored_proposal->>'issueId')::uuid;
  expected_draft_revision := (stored_proposal->>'expectedDraftRevision')::bigint;
  perform 1 from private.catalog_head where singleton and version=context.catalog_version for share;
  if not found then return reply || '{"state":"STALE_CONTEXT"}'::jsonb; end if;
  perform 1 from private.policies where active and version=context.policy_version for share;
  if not found then return reply || '{"state":"STALE_CONTEXT"}'::jsonb; end if;
  select i.revision::text into expected_issue_revision from private.issues i
    where i.id=issue_id_value and i.sample_kind='SYNTHETIC' for update;
  if not found or expected_issue_revision is distinct from stored_proposal->>'issueVersion' then
    return reply || '{"state":"REVISION_CONFLICT"}'::jsonb;
  end if;
  select d.revision into current_draft_revision from private.editor_drafts d
    where d.issue_id=issue_id_value for update;
  if not found or current_draft_revision is distinct from expected_draft_revision then
    return reply || '{"state":"REVISION_CONFLICT"}'::jsonb;
  end if;
  if context.usable_until <= pg_catalog.clock_timestamp() then
    return reply || '{"state":"STALE_CONTEXT"}'::jsonb;
  end if;

  saved := public.catalog_save_draft(issue_id_value,expected_draft_revision,context.draft_content,context.catalog_version);
  applied_revision := expected_draft_revision+1;
  if (saved->>'draft_revision') is distinct from applied_revision::text then
    raise exception 'AI_DRAFT_APPLY_INVALID_RECEIPT';
  end if;
  update ai_proposal_private.draft_outbox set applied_draft_revision=applied_revision
    where proposal_id=proposal_id_value;
  return reply || pg_catalog.jsonb_build_object('state','DRAFT_APPLIED','proposalId',proposal_id_value,
    'draftRevision',applied_revision::text);
end;
$$;

grant usage on schema ai_proposal_api to authenticated;
revoke all on function ai_proposal_api.ai_proposal_apply_draft_v1(text,text) from public;
grant execute on function ai_proposal_api.ai_proposal_apply_draft_v1(text,text) to authenticated;
commit;
