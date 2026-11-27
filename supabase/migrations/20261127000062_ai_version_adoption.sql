begin;
-- Publish stage 1C (docs/publish-stage1c-plan.md): an editor adopts the newest held AI version of a real issue, then
-- republishes it through the 1B publisher. Local only (real mode). C1 keeps the AI draft with each evidence record,
-- C2 moves the intake apply block into one owner-only function shared by intake and adoption, C3 the adoption function,
-- C4 retention of adopted drafts that were never republished.

-- C1. The AI draft of each received version (null for rows received before 62: not adoptable).
alter table private.ai_draft_origin add column draft jsonb;

-- C3. Adoption receipts: exact replays return the stored result; a different request under the same key conflicts.
create table private.ai_adoptions (
  effect_key text primary key check (length(effect_key) between 1 and 200),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  issue_id uuid not null references private.issues(id),
  ai_version integer not null check (ai_version > 0),
  result jsonb not null,
  adopted_draft_revision bigint not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_version_id uuid
);
create index ai_adoptions_issue on private.ai_adoptions(issue_id, created_at desc);
alter table private.ai_adoptions enable row level security;
revoke all on private.ai_adoptions from public, anon, authenticated, service_role;

-- C2. Common apply (owner only; called by private.ai_ingest_draft and public.m1_adopt_ai_version, which hold the AI-issue
-- advisory lock, the link row, the issue row and the draft row). The intake block moved verbatim (generated).
create function private.ai_apply_version(p_issue uuid,p_ai text,p_version integer,p_payload jsonb,p_catalog bigint,p_received_at timestamptz,p_expires_at timestamptz)
returns void language plpgsql set search_path='' as $$
declare iss uuid:=p_issue;ai text:=p_ai;ver integer:=p_version;head bigint:=p_catalog;d jsonb:=p_payload->'draft';
  x jsonb;map jsonb:='{}';cid uuid;v_content jsonb;items jsonb;
begin
  if not exists(select 1 from private.issues where id=iss and sample_kind='PERMITTED_REAL') then raise exception 'REAL_ISSUE_REQUIRED';end if;
  if p_received_at is null or p_expires_at is null or p_expires_at<=p_received_at then raise exception 'AI_ORIGIN_TIMES_INVALID';end if;
      -- Claims are replaced as a whole: the evidence rule checks every claim of the issue.
      delete from private.ai_claim_links where issue_id=iss;
      delete from private.evidence_edges where claim_id in (select id from private.claims where issue_id=iss);
      delete from private.claims where issue_id=iss;
      for x in select value from jsonb_array_elements(p_payload->'facts') loop
        insert into private.claims(issue_id,claim_type,korea_path_verified,fact_current,official_original,verified,valid_until,sample_kind)
          -- Trust is derived here: the claim type is the AI verification class, and a fact is an official original only
          -- when every source it cites is on an official-filing host (database classification, not the sender's label).
          values(iss,x->>'verification_class',
            (x->>'korea_path_verified')::boolean,(x->>'recorded_at')::timestamptz>now()-interval '30 days',
            not exists(select 1 from jsonb_array_elements_text(x->'source_urls') u where not private.real_source_host(u.value)=any(coalesce((select official_source_hosts from private.real_mode where id=1),'{}'::text[]))),
            (x->>'independently_verified')::boolean,(x->>'recorded_at')::timestamptz+interval '30 days','PERMITTED_REAL') returning id into cid;
        insert into private.ai_claim_links(issue_id,fact_id,claim_id,ai_version) values(iss,x->>'id',cid,ver);
        map:=map||jsonb_build_object(x->>'id',cid);
      end loop;
      -- AI fact IDs become claim UUIDs only here, after the claims exist.
      v_content:=d||jsonb_build_object('analysis_perspective','KR_EQUITY','primary_sector_id',coalesce(d->'primary_sector_id','null'::jsonb),
        'key_issues',coalesce(d->'key_issues','[]'),'risks',coalesce(d->'risks','[]'),'scenarios',coalesce(d->'scenarios','[]'),
        'company_refs',coalesce(d->'company_refs','[]'));
      select coalesce(jsonb_agg((it.value-'evidence_fact_ids')||jsonb_build_object('evidence_ids',(select coalesce(jsonb_agg(map->(f#>>'{}')),'[]') from jsonb_array_elements(it.value->'evidence_fact_ids') f))),'[]')
        into items from jsonb_array_elements(coalesce(d->'impacts','[]')) it;
      v_content:=v_content||jsonb_build_object('impacts',items);
      select coalesce(jsonb_agg((it.value-'evidence_fact_ids')||jsonb_build_object('evidence_ids',(select coalesce(jsonb_agg(map->(f#>>'{}')),'[]') from jsonb_array_elements(it.value->'evidence_fact_ids') f))),'[]')
        into items from jsonb_array_elements(coalesce(d->'schedule','[]')) it;
      v_content:=v_content||jsonb_build_object('schedule',items,'sources',(select jsonb_agg(s-'role') from jsonb_array_elements(d->'sources') s));
      perform private.m1_draft_shape(v_content);
      perform 1 from private.editor_drafts where issue_id=iss for update;
      if found then update private.editor_drafts set content=v_content,revision=revision+1,updated_at=now(),updated_by=null where issue_id=iss;
      else insert into private.editor_drafts(issue_id,content,updated_by) values(iss,v_content,null);end if;
      delete from private.ai_draft_origin where issue_id=iss;
      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,received_at,expires_at,draft)
        values(iss,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',p_received_at,p_expires_at,d);
      insert into private.ai_issue_links(ai_issue_id,issue_id,current_version,state) values(ai,iss,ver,'ACTIVE')
        on conflict(ai_issue_id) do update set issue_id=excluded.issue_id,current_version=excluded.current_version,state='ACTIVE',reason='',updated_at=now();
end$$;
revoke all on function private.ai_apply_version(uuid,text,integer,jsonb,bigint,timestamptz,timestamptz) from public, anon, authenticated, service_role;

-- Intake calls the common apply (generated from the live definition).
CREATE OR REPLACE FUNCTION private.ai_ingest_draft(p_effect_key text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ai text:=p_payload->>'ai_issue_id';ver integer;h text;rcpt private.ai_draft_receipts;lnk private.ai_issue_links;d jsonb;x jsonb;
  iss uuid;st uuid;head bigint;result jsonb;map jsonb:='{}';cid uuid;v_content jsonb;items jsonb;drift jsonb;i private.issues;ed private.editor_drafts;
begin
  if current_user<>'postgres' then raise exception 'AI_INBOX_POSTGRES_ONLY';end if;
  -- Identity, lock and receipt first: an exact retry always gets its stored result, a different payload for the same
  -- AI issue and version always gets AI_DRAFT_CONFLICT, whatever the switch or the validation rules say now.
  if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'ai_issue_id') is distinct from 'string' or coalesce(ai,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_payload->'ai_version')<>'number' or (p_payload->>'ai_version')!~'^[1-9][0-9]{0,8}$' then raise exception 'AI_DRAFT_VERSION';end if;
  ver:=(p_payload->>'ai_version')::integer;
  if p_effect_key is distinct from 'ai:'||ai||':'||ver then raise exception 'AI_EFFECT_KEY_MISMATCH';end if;
  perform pg_advisory_xact_lock(hashtext('ai-issue:'||ai));
  h:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  select * into rcpt from private.ai_draft_receipts where effect_key=p_effect_key;
  if found then
    if rcpt.payload_sha256<>h then raise exception 'AI_DRAFT_CONFLICT';end if;
    return rcpt.result;
  end if;
  if not private.real_mode_on() then raise exception 'REAL_MODE_OFF';end if;
  perform private.ai_payload_check(p_payload);
  d:=p_payload->'draft';
  perform 1 from private.catalog_head where singleton for share;
  select version into strict head from private.catalog_head where singleton;
  select * into lnk from private.ai_issue_links where ai_issue_id=ai for update;
  if lnk.issue_id is not null then
    select * into strict i from private.issues where id=lnk.issue_id for update;
    select * into ed from private.editor_drafts where issue_id=lnk.issue_id for update;
  end if;
  if lnk.ai_issue_id is not null and ver<=lnk.current_version then
    result:=jsonb_build_object('state',case when lnk.state='WITHDRAWN' then 'WITHDRAWN' else 'STALE_VERSION' end,'ai_version',ver,'current_version',lnk.current_version);
  else
    drift:=private.ai_catalog_drift(d,head);
    if jsonb_array_length(drift)>0 then
      result:=jsonb_build_object('state','CATALOG_DRIFT','ai_version',ver,'catalog_version',head,'refs',drift);
    elsif lnk.issue_id is not null and (ed.issue_id is not null and (i.manual_protected or ed.updated_by is not null) or i.publication_state<>'DRAFT') then
      -- The editor owns this draft now: keep it, keep its claims, and show the new evidence beside it.
      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at,draft)
        values(lnk.issue_id,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',now()+interval '30 days',d);
      update private.ai_issue_links set current_version=ver,state='HOLD_EDITOR',reason='EDITOR_OWNS_DRAFT',updated_at=now() where ai_issue_id=ai;
      result:=jsonb_build_object('state','HOLD_EDITOR','ai_version',ver,'issue_id',lnk.issue_id);
    else
      iss:=lnk.issue_id;
      if iss is null then
        insert into private.stories(event_key) values('ai:'||(p_payload->>'story_key')) on conflict(event_key) do nothing;
        select id into strict st from private.stories where event_key='ai:'||(p_payload->>'story_key');
        insert into private.issues(story_id,angle_key,sample_kind,manual_protected) values(st,'ai:'||(p_payload->>'angle_key'),'PERMITTED_REAL',false) returning id into iss;
      elsif i.publication_state<>'DRAFT' then raise exception 'AI_ISSUE_NOT_DRAFT';
      end if;
      perform private.ai_apply_version(iss,ai,ver,p_payload,head,now(),now()+interval '30 days');
      result:=jsonb_build_object('state','RECEIVED','ai_version',ver,'issue_id',iss,'catalog_version',head,'claims',jsonb_array_length(p_payload->'facts'));
    end if;
  end if;
  insert into private.ai_draft_receipts(effect_key,ai_issue_id,ai_version,payload_sha256,result) values(p_effect_key,ai,ver,h,result);
  insert into private.audits(actor_id,action,entity_id,details) values('ai-inbox','AI_DRAFT_'||(result->>'state'),ai,jsonb_build_object('ai_version',ver,'issue_id',result->'issue_id'));
  return result;
end$function$;

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

-- Draft detail with the adoptable flag (generated).
CREATE OR REPLACE FUNCTION public.m1_get_draft(p_issue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;labels jsonb;companies jsonb;head bigint;k private.sample_kind;origin jsonb;
begin
 perform private.m1_assert_editor();result:=private.m1_get_draft_legacy(p_issue);
 if result is null then return null;end if;
 select sample_kind into k from private.issues where id=p_issue;
 head:=(result->>'catalog_version')::bigint;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.id),'[]') into labels from(
  select s.id,s.name,s.metadata_kind,s.active,private.catalog_sector_selectable(s.id,head,k::text) selectable
  from private.sectors s where s.id::text=result->'content'->>'primary_sector_id'
  or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(result->'content'->'impacts')='array' then result->'content'->'impacts' else '[]' end) item where item->>'sector_id'=s.id::text)
  order by s.id limit 64
 )page;
 -- Names of the companies the draft refers to, for review of company scope.
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.active) order by c.name,c.id),'[]') into companies
  from private.catalog_source_companies c where c.id::text in (
   select result->'content'->>'primary_company_ref'
   union select value from jsonb_array_elements_text(case when jsonb_typeof(result->'content'->'company_refs')='array' then result->'content'->'company_refs' else '[]' end)
   union select x->>'company_ref' from jsonb_array_elements(case when jsonb_typeof(result->'content'->'impacts')='array' then result->'content'->'impacts' else '[]' end) i,
     jsonb_array_elements(case when jsonb_typeof(i->'companies')='array' then i->'companies' else '[]' end) x);
 -- The draft's own evidence (the version its claims came from) and, when the editor holds the draft, the newest
 -- evidence waiting beside it; versions are never mixed.
 if exists(select 1 from private.ai_issue_links l where l.issue_id=p_issue) then
  select jsonb_build_object(
   'link_state',(select l.state from private.ai_issue_links l where l.issue_id=p_issue),
   'adoptable',private.ai_adoptable(p_issue),
   'draft',(select jsonb_build_object('ai_version',o.ai_version,'facts',o.facts,'sources',o.sources,'received_at',o.received_at,
      'claim_ids',(select coalesce(jsonb_object_agg(c.fact_id,c.claim_id),'{}') from private.ai_claim_links c where c.issue_id=p_issue and c.ai_version=o.ai_version))
     from private.ai_draft_origin o where o.issue_id=p_issue and o.ai_version=(select max(c.ai_version) from private.ai_claim_links c where c.issue_id=p_issue)),
   'pending',(select jsonb_build_object('ai_version',o.ai_version,'facts',o.facts,'sources',o.sources,'received_at',o.received_at)
     from private.ai_draft_origin o where o.issue_id=p_issue and o.ai_version>coalesce((select max(c.ai_version) from private.ai_claim_links c where c.issue_id=p_issue),0)
     order by o.ai_version desc limit 1)) into origin;
 end if;
 return result||jsonb_build_object('sector_labels',labels,'sample_kind',k,'ai_origin',origin,'company_labels',companies,'real_publish_allowed',k='PERMITTED_REAL' and private.public_read_kind()='PERMITTED_REAL'
   and exists(select 1 from private.ai_issue_links l where l.issue_id=p_issue and l.state='ACTIVE'));
end$function$;
commit;
