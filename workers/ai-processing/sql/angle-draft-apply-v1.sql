-- Editor handoff for a separate synthetic issue under the existing story.
begin;
do $$
begin
  if session_user <> 'postgres'
      or pg_catalog.current_database() !~ '^p4_[0-9a-f]{32}$'
      or pg_catalog.current_setting('judoju.ai_proposal_fixture_v1',true)
          is distinct from pg_catalog.current_database()
      or pg_catalog.to_regclass('ai_proposal_private.pending_angles') is null
      or pg_catalog.to_regclass('private.stories') is null
      or pg_catalog.to_regprocedure('public.catalog_save_draft(uuid,bigint,jsonb,bigint)') is null
  then raise exception 'AI_ANGLE_DRAFT_FIXTURE_REQUIRED'; end if;
end;
$$;

-- Seeded by the fixture authority after checking current source rights, wording,
-- policy and catalog. No editor or worker can extend this authorization.
create table ai_proposal_private.angle_draft_context (
  angle_id uuid primary key references ai_proposal_private.pending_angles(angle_id),
  effect_key text not null references ai_proposal_private.analysis_intents(effect_key),
  candidate_digest text not null,
  story_event_key text not null,
  catalog_version bigint not null check (catalog_version > 0),
  policy_version bigint not null check (policy_version > 0),
  usable_until timestamptz not null check (pg_catalog.isfinite(usable_until)),
  draft_content jsonb not null check (pg_catalog.jsonb_typeof(draft_content)='object')
);

create table ai_proposal_private.angle_draft_receipts (
  angle_id uuid primary key references ai_proposal_private.pending_angles(angle_id),
  effect_key text not null references ai_proposal_private.analysis_intents(effect_key),
  issue_id uuid not null unique references private.issues(id),
  draft_revision bigint not null check (draft_revision > 0)
);
revoke all on ai_proposal_private.angle_draft_context,ai_proposal_private.angle_draft_receipts
  from public,authenticated,ai_proposal_executor_v1;

create function ai_proposal_api.ai_angle_apply_draft_v1(p_effect text,p_work_digest text,p_candidate_digest text,p_angle_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  intent ai_proposal_private.analysis_intents%rowtype;
  ctx ai_proposal_private.angle_draft_context%rowtype;
  receipt ai_proposal_private.angle_draft_receipts%rowtype;
  story_id_value uuid;
  issue_id_value uuid;
  expected_issues jsonb;
  current_issues jsonb;
  synthetic_issues boolean;
  saved jsonb;
  reply jsonb;
begin
  perform private.m1_assert_editor();
  if p_effect is null or p_effect !~ '^analysis:[0-9a-f]{64}$'
      or p_work_digest is null or p_work_digest !~ '^[0-9a-f]{64}$'
      or p_candidate_digest is null or p_candidate_digest !~ '^[0-9a-f]{64}$'
      or p_angle_id is null
  then raise exception 'AI_ANGLE_DRAFT_INVALID'; end if;
  reply := pg_catalog.jsonb_build_object('effectKey',p_effect,'workDigest',p_work_digest,'angleDigest',p_candidate_digest);
  select * into intent from ai_proposal_private.analysis_intents where effect_key=p_effect for share;
  if not found then return reply || '{"state":"NOT_FOUND"}'::jsonb; end if;
  if intent.state<>'ANGLE_PENDING' or intent.work_digest<>p_work_digest
    or intent.angle_digest<>p_candidate_digest or intent.angle_id<>p_angle_id
  then return reply || '{"state":"CONFLICT"}'::jsonb; end if;

  -- A second delivery of the same angle waits on the same item before looking up its receipt.
  perform 1 from ai_proposal_private.pending_angles where angle_id=intent.angle_id for update;
  select * into receipt from ai_proposal_private.angle_draft_receipts where angle_id=intent.angle_id;
  if found then
    return reply || pg_catalog.jsonb_build_object('state',case when receipt.effect_key=p_effect
      then 'ANGLE_DRAFT_CREATED' else 'ANGLE_ALREADY_DRAFTED' end,'angleId',intent.angle_id,
      'issueId',receipt.issue_id,'draftRevision',receipt.draft_revision::text);
  end if;
  select * into ctx from ai_proposal_private.angle_draft_context where angle_id=intent.angle_id for share;
  if not found or ctx.effect_key<>p_effect or ctx.candidate_digest<>p_candidate_digest
      or ctx.usable_until<=pg_catalog.clock_timestamp()
      or (intent.angle_candidate->>'storyId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then return reply || '{"state":"STALE_CONTEXT"}'::jsonb; end if;

  perform 1 from private.catalog_head where singleton and version=ctx.catalog_version for share;
  if not found then return reply || '{"state":"STALE_CONTEXT"}'::jsonb; end if;
  perform 1 from private.policies where active and version=ctx.policy_version for share;
  if not found then return reply || '{"state":"STALE_CONTEXT"}'::jsonb; end if;
  story_id_value := (intent.angle_candidate->>'storyId')::uuid;
  perform 1 from private.stories where id=story_id_value and event_key=ctx.story_event_key for update;
  if not found then return reply || '{"state":"STALE_CONTEXT"}'::jsonb; end if;
  select pg_catalog.jsonb_agg(value order by value->>'issueId') into expected_issues
    from pg_catalog.jsonb_array_elements(intent.angle_candidate->'issueVersions');
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('issueId',i.id::text,'issueVersion',i.revision::text)
      order by i.id::text),pg_catalog.bool_and(i.sample_kind='SYNTHETIC') into current_issues,synthetic_issues
    from (select id,revision,sample_kind from private.issues where story_id=story_id_value order by id for update) i;
  if synthetic_issues is not true or current_issues is distinct from expected_issues
  then return reply || '{"state":"REVISION_CONFLICT"}'::jsonb; end if;
  if ctx.usable_until<=pg_catalog.clock_timestamp() then return reply || '{"state":"STALE_CONTEXT"}'::jsonb; end if;

  insert into private.issues(story_id,angle_key,sample_kind)
    values(story_id_value,intent.angle_candidate->>'angleCode','SYNTHETIC')
    on conflict(story_id,angle_key) do nothing returning id into issue_id_value;
  if not found then return reply || '{"state":"REVISION_CONFLICT"}'::jsonb; end if;
  insert into private.editor_drafts(issue_id,revision,content,updated_by)
    values(issue_id_value,0,'{}'::jsonb,auth.uid());
  saved := public.catalog_save_draft(issue_id_value,0,ctx.draft_content,ctx.catalog_version);
  if (saved->>'draft_revision') is distinct from '1' then raise exception 'AI_ANGLE_DRAFT_INVALID_RECEIPT'; end if;
  insert into ai_proposal_private.angle_draft_receipts(angle_id,effect_key,issue_id,draft_revision)
    values(intent.angle_id,p_effect,issue_id_value,1);
  return reply || pg_catalog.jsonb_build_object('state','ANGLE_DRAFT_CREATED','angleId',intent.angle_id,
    'issueId',issue_id_value,'draftRevision','1');
end;
$$;

revoke all on function ai_proposal_api.ai_angle_apply_draft_v1(text,text,text,uuid) from public,ai_proposal_executor_v1;
grant usage on schema ai_proposal_api to authenticated;
grant execute on function ai_proposal_api.ai_angle_apply_draft_v1(text,text,text,uuid) to authenticated;
commit;
