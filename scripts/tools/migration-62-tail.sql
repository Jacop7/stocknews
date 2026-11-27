-- C3. Whether the newest held AI version can be adopted now (static conditions; revision and drift are checked at adoption).
create function private.ai_adoptable(p_issue uuid) returns boolean language sql stable set search_path='' as $$
  select private.real_mode_on() and exists(
    select 1 from private.issues i join private.ai_issue_links l on l.issue_id=i.id
      join private.ai_draft_origin o on o.issue_id=i.id and o.ai_version=l.current_version
    where i.id=p_issue and i.sample_kind='PERMITTED_REAL' and l.state='HOLD_EDITOR' and o.draft is not null and o.expires_at>now()
      and not exists(select 1 from jsonb_array_elements(o.facts) f where (f->>'recorded_at')::timestamptz+interval '30 days'<=now())
      and (i.publication_state in ('DRAFT','PUBLISHED')
        or i.publication_state='CORRECTION_PENDING' and i.correction_pending_since>now()-interval '24 hours'))
$$;
revoke all on function private.ai_adoptable(uuid) from public, anon, authenticated, service_role;

-- C3. Adoption (editor only). Lock order as intake: AI-issue advisory lock, catalog head (share), link, issue, draft,
-- evidence record. Exact replays come first, before any state check.
create function public.m1_adopt_ai_version(p_issue uuid,p_ai_version integer,p_expected_revision bigint,p_effect_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h text;prior private.ai_adoptions;lnk private.ai_issue_links;i private.issues;ed private.editor_drafts;o private.ai_draft_origin;
  head bigint;drift jsonb;result jsonb;rev bigint;
begin
  perform private.m1_assert_editor();
  if p_issue is null or p_ai_version is null or p_ai_version<1 or p_expected_revision is null then raise exception 'AI_ADOPT_INVALID';end if;
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  h:=encode(sha256(convert_to(jsonb_build_object('issue',p_issue,'ai_version',p_ai_version,'expected_revision',p_expected_revision)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtext('ai-adopt-key:'||p_effect_key));
  select * into prior from private.ai_adoptions where effect_key=p_effect_key;
  if found then
    if prior.request_sha256<>h then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
    return prior.result;
  end if;
  if not private.real_mode_on() then raise exception 'REAL_MODE_OFF';end if;
  select * into lnk from private.ai_issue_links where issue_id=p_issue;
  if not found then
    if exists(select 1 from private.issues where id=p_issue and sample_kind='PERMITTED_REAL') then raise exception 'AI_VERSION_NOT_ADOPTABLE';end if;
    raise exception 'REAL_ISSUE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai-issue:'||lnk.ai_issue_id));
  perform 1 from private.catalog_head where singleton for share;
  select version into strict head from private.catalog_head where singleton;
  select * into strict lnk from private.ai_issue_links where ai_issue_id=lnk.ai_issue_id for update;
  select * into strict i from private.issues where id=p_issue for update;
  select * into ed from private.editor_drafts where issue_id=p_issue for update;
  if lnk.issue_id is distinct from p_issue or i.sample_kind<>'PERMITTED_REAL' then raise exception 'REAL_ISSUE_REQUIRED';end if;
  if lnk.state<>'HOLD_EDITOR' or lnk.current_version<>p_ai_version then raise exception 'AI_VERSION_NOT_ADOPTABLE';end if;
  select * into o from private.ai_draft_origin where issue_id=p_issue and ai_version=p_ai_version for update;
  if not found or o.draft is null or o.expires_at<=now()
    or exists(select 1 from jsonb_array_elements(o.facts) f where (f->>'recorded_at')::timestamptz+interval '30 days'<=now()) then raise exception 'AI_VERSION_EXPIRED';end if;
  if ed.issue_id is null or ed.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if i.publication_state not in ('DRAFT','PUBLISHED','CORRECTION_PENDING') then raise exception 'AI_ISSUE_CLOSED';end if;
  if i.publication_state='CORRECTION_PENDING' and (i.correction_pending_since is null or i.correction_pending_since<=now()-interval '24 hours') then raise exception 'AI_CORRECTION_WINDOW_CLOSED';end if;
  drift:=private.ai_catalog_drift(o.draft,head);
  if jsonb_array_length(drift)>0 then raise exception 'CATALOG_DRIFT';end if;
  -- A published article leaves the public view first: its body must never be shown with the new claims.
  if i.publication_state='PUBLISHED' then
    perform private.m1_transition_internal(p_issue,'CORRECTION_PENDING','AI_VERSION_ADOPTED','ai-adopt:'||p_issue||':'||p_ai_version);
  end if;
  -- The adopted version keeps its own receipt time, retention and catalog version.
  perform private.ai_apply_version(p_issue,lnk.ai_issue_id,p_ai_version,jsonb_build_object('facts',o.facts,'catalog_ref',o.catalog_ref,'draft',o.draft),
    o.catalog_version,o.received_at,o.expires_at);
  update private.issues set removal_cause=null where id=p_issue and removal_cause='AI_SOURCE_REVOKED';
  select revision into strict rev from private.editor_drafts where issue_id=p_issue;
  result:=jsonb_build_object('state','ADOPTED','issue_id',p_issue,'ai_version',p_ai_version,'draft_revision',rev,
    'publication_state',(select publication_state from private.issues where id=p_issue));
  insert into private.ai_adoptions(effect_key,request_sha256,issue_id,ai_version,result,adopted_draft_revision) values(p_effect_key,h,p_issue,p_ai_version,result,rev);
  insert into private.audits(actor_id,action,entity_id,details) values(auth.uid()::text,'AI_VERSION_ADOPTED',p_issue::text,jsonb_build_object('ai_version',p_ai_version,'ai_issue_id',lnk.ai_issue_id));
  return result;
end$$;
revoke all on function public.m1_adopt_ai_version(uuid,integer,bigint,text) from public, anon, service_role;
grant execute on function public.m1_adopt_ai_version(uuid,integer,bigint,text) to authenticated;

-- C3. Publish dispatch (59) plus the adoption publication record: only a new article version (APPLIED) marks the
-- pending adoption published; a replayed earlier request (ALREADY_APPLIED) never does.
create or replace function private.reservation_publish_core(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text,p_actor uuid,p_schedule uuid)
returns jsonb language plpgsql set search_path='' as $$
declare k private.sample_kind;st text;r jsonb;
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
  r:=private.reservation_publish_core_real(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key,p_actor,p_schedule);
  if r->>'status'='APPLIED' then
    -- Only the latest adoption is published by this version; superseded adoptions stay unpublished.
    update private.ai_adoptions set published_at=now(),published_version_id=(r->>'version_id')::uuid
      where effect_key=(select a.effect_key from private.ai_adoptions a where a.issue_id=p_issue order by a.adopted_draft_revision desc,a.created_at desc limit 1)
        and published_at is null;
  end if;
  return r;
end$$;

-- C4. Whether the latest adoption of an issue was never published (the order used by publishing and cleanup alike).
create function private.ai_last_adoption_unpublished(p_issue uuid) returns boolean language sql stable set search_path='' as $$
  select coalesce((select a.published_at is null from private.ai_adoptions a where a.issue_id=p_issue order by a.adopted_draft_revision desc,a.created_at desc limit 1),false)
$$;
revoke all on function private.ai_last_adoption_unpublished(uuid) from public, anon, authenticated, service_role;

-- C4. Closed real issues (withdrawn by timeout or expiry, hidden by an editor) keep no evidence of the version they
-- carried and no ACTIVE link; the editor draft goes too when the latest adoption was never published. A version that
-- arrived after the issue closed waits beside it (HOLD_EDITOR) and expires through the normal 30-day rule.
create function private.ai_close_real_issue(p_issue uuid,p_reason text) returns void language plpgsql set search_path='' as $$
declare ev integer;
begin
  perform 1 from private.issues where id=p_issue for update;
  perform 1 from private.editor_drafts where issue_id=p_issue for update;
  if not exists(select 1 from private.issues where id=p_issue and sample_kind='PERMITTED_REAL' and publication_state in ('WITHDRAWN','HIDDEN')) then raise exception 'AI_ISSUE_NOT_CLOSED';end if;
  select max(c.ai_version) into ev from private.ai_claim_links c where c.issue_id=p_issue;
  delete from private.ai_claim_links where issue_id=p_issue;
  delete from private.evidence_edges where claim_id in (select id from private.claims where issue_id=p_issue);
  delete from private.claims where issue_id=p_issue;
  delete from private.ai_draft_origin where issue_id=p_issue and ai_version<=coalesce(ev,0);
  if private.ai_last_adoption_unpublished(p_issue) then delete from private.editor_drafts where issue_id=p_issue;end if;
  update private.ai_issue_links set state='WITHDRAWN',reason=p_reason,updated_at=now() where issue_id=p_issue and state='ACTIVE';
end$$;
revoke all on function private.ai_close_real_issue(uuid,text) from public, anon, authenticated, service_role;

alter function private.ai_inbox_cleanup() rename to ai_inbox_cleanup_v2;
create function private.ai_inbox_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;skipped integer:=0;base jsonb;
begin
  base:=private.ai_inbox_cleanup_v2();
  for r in select i.id,(select l.ai_issue_id from private.ai_issue_links l where l.issue_id=i.id) ai from private.issues i
    where i.sample_kind='PERMITTED_REAL' and i.publication_state in ('WITHDRAWN','HIDDEN')
      and (exists(select 1 from private.claims c where c.issue_id=i.id)
        or exists(select 1 from private.ai_issue_links l where l.issue_id=i.id and l.state='ACTIVE')
        or private.ai_last_adoption_unpublished(i.id) and exists(select 1 from private.editor_drafts d where d.issue_id=i.id))
    order by i.id limit 200 loop
    if r.ai is not null and not pg_try_advisory_xact_lock(hashtext('ai-issue:'||r.ai)) then skipped:=skipped+1;continue;end if;
    if not exists(select 1 from private.issues where id=r.id for update skip locked)
      or exists(select 1 from private.editor_drafts where issue_id=r.id) and not exists(select 1 from private.editor_drafts where issue_id=r.id for update skip locked) then
      skipped:=skipped+1;continue;
    end if;
    if not exists(select 1 from private.issues where id=r.id and publication_state in ('WITHDRAWN','HIDDEN')) then continue;end if;
    perform private.ai_close_real_issue(r.id,case when (select removal_cause from private.issues where id=r.id)='FACT_RECORD_EXPIRED' then 'EXPIRED' else 'ISSUE_CLOSED' end);
    n:=n+1;
  end loop;
  return base||jsonb_build_object('closed_cleared',n,'closed_skipped_busy',skipped);
end$$;
revoke all on function private.ai_inbox_cleanup(), private.ai_inbox_cleanup_v2() from public, anon, authenticated, service_role;
