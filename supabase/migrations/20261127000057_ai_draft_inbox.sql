begin;
-- Publish stage 1A, A3 (docs/publish-stage1-plan.md): AI drafts inbox. The AI processor's verified drafts arrive as
-- AI_DRAFT_V1 payloads (pulled by an ops script and passed in by postgres; no API role may call anything here).
-- Each AI issue maps to one PERMITTED_REAL issue; versions only move forward; editor work is never overwritten;
-- withdrawals leave a tombstone; unpublished AI evidence is removed after 30 days.

-- Which allowed hosts publish official filings is decided here, never by the sender: a fact is an official original
-- only when every source it cites is on an official-filing host.
alter table private.real_mode add column official_source_hosts text[] not null default array['dart.fss.or.kr','kind.krx.co.kr'];
alter table private.real_mode add constraint real_mode_official_subset check (official_source_hosts<@allowed_source_hosts);
create function private.real_source_host(p_url text) returns text language sql immutable set search_path='' as $f$
  select (regexp_match(p_url,'^https://([^/?#]*)'))[1]
$f$;

create table private.ai_issue_links (
  ai_issue_id text primary key check (ai_issue_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  issue_id uuid unique references private.issues(id),
  current_version integer not null check (current_version >= 1),
  state text not null check (state in ('ACTIVE', 'WITHDRAWN', 'HOLD_EDITOR')),
  reason text not null default '',
  updated_at timestamptz not null default now()
);
create table private.ai_draft_receipts (
  effect_key text primary key check (length(effect_key) between 10 and 120),
  ai_issue_id text not null,
  ai_version integer not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  received_at timestamptz not null default now()
);
-- Evidence the editor sees next to the draft. Not part of the editable draft, so an edit can never alter it.
create table private.ai_draft_origin (
  issue_id uuid not null references private.issues(id),
  ai_version integer not null,
  facts jsonb not null,
  sources jsonb not null,
  catalog_version bigint not null,
  catalog_ref jsonb not null,
  received_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (issue_id, ai_version)
);
create table private.ai_claim_links (
  issue_id uuid not null references private.issues(id),
  fact_id text not null,
  claim_id uuid not null unique references private.claims(id) on delete cascade,
  ai_version integer not null,
  primary key (issue_id, fact_id)
);
alter table private.ai_issue_links enable row level security;
alter table private.ai_draft_receipts enable row level security;
alter table private.ai_draft_origin enable row level security;
alter table private.ai_claim_links enable row level security;
revoke all on private.ai_issue_links, private.ai_draft_receipts, private.ai_draft_origin, private.ai_claim_links from public, anon, authenticated, service_role;

-- Payload checks shared by intake. Raises on any malformed input (nothing is stored then). Every object at every depth
-- has a fixed key set and typed values, so no original text or control field can ride along in a nested object.
create function private.ai_string_array(p jsonb,p_max integer,p_len integer) returns boolean language sql immutable set search_path='' as $$
  select jsonb_typeof(p)='array' and jsonb_array_length(p)<=p_max
    and not exists(select 1 from jsonb_array_elements(p) v where jsonb_typeof(v.value)<>'string' or length(v.value#>>'{}')>p_len)
$$;
create function private.ai_keys_ok(p jsonb,p_allowed text[],p_required text[]) returns boolean language sql immutable set search_path='' as $$
  select jsonb_typeof(p)='object'
    and (select coalesce(array_agg(key),'{}') from jsonb_object_keys(p) key)<@p_allowed
    and p_required<@(select coalesce(array_agg(key),'{}') from jsonb_object_keys(p) key)
$$;
create function private.ai_payload_check(p jsonb) returns void language plpgsql immutable set search_path='' as $$
declare d jsonb;x jsonb;y jsonb;k text;facts text[]:='{}';fid text;
  text_fields constant text[]:=array['title','summary','issue_analysis','article_kind','source_market','selection_market_basis'];
  draft_keys constant text[]:=array['title','summary','issue_analysis','key_issues','risks','article_kind','primary_sector_id','primary_company_ref','company_refs',
    'source_market','selection_market_basis','sources','impacts','scenarios','schedule'];
  impact_keys constant text[]:=array['sector_id','path_id','direction','conditional_direction','description','conditions','evidence_fact_ids','companies'];
  scenario_keys constant text[]:=array['direction','title','expected_result','checks','path_ids'];
  schedule_keys constant text[]:=array['kind','status','title','timezone','evidence_as_of','event_at','period_label','period_start','period_end','precision','evidence_fact_ids'];
  fact_keys constant text[]:=array['id','statement','verification_class','independently_verified','korea_path_verified','recorded_at','source_urls'];
begin
  if p is null or jsonb_typeof(p)<>'object' or pg_column_size(p)>262144 then raise exception 'AI_DRAFT_INVALID';end if;
  if not private.ai_keys_ok(p,array['ai_issue_id','ai_version','angle_key','catalog_ref','draft','facts','format','story_key'],
    array['ai_issue_id','ai_version','angle_key','catalog_ref','draft','facts','format','story_key']) then raise exception 'AI_DRAFT_KEYS';end if;
  if p->>'format' is distinct from 'AI_DRAFT_V1' then raise exception 'AI_DRAFT_FORMAT';end if;
  if jsonb_typeof(p->'ai_version')<>'number' or (p->>'ai_version')!~'^[1-9][0-9]{0,8}$' then raise exception 'AI_DRAFT_VERSION';end if;
  if jsonb_typeof(p->'story_key')<>'string' or jsonb_typeof(p->'angle_key')<>'string' or jsonb_typeof(p->'ai_issue_id')<>'string'
    or p->>'story_key'!~'^[A-Za-z0-9_.:-]{1,200}$' or p->>'angle_key'!~'^[A-Za-z0-9_.:-]{1,200}$' then raise exception 'AI_DRAFT_KEYS';end if;
  -- The server's catalog reference is recorded for audit; IDs are checked one by one against the DB head.
  if not private.ai_keys_ok(p->'catalog_ref',array['registry','sha256'],array['registry','sha256'])
    or jsonb_typeof(p->'catalog_ref'->'registry')<>'string' or jsonb_typeof(p->'catalog_ref'->'sha256')<>'string' or p->'catalog_ref'->>'registry'!~'^[A-Za-z0-9_.:-]{1,120}$'
    or coalesce(p->'catalog_ref'->>'sha256','')!~'^[0-9a-f]{64}$' then raise exception 'AI_CATALOG_REF_INVALID';end if;
  -- Facts: 1-30, statements only. Trust (claim type, official origin) is derived by the database, never sent.
  if jsonb_typeof(p->'facts')<>'array' or jsonb_array_length(p->'facts') not between 1 and 30 then raise exception 'AI_FACTS_INVALID';end if;
  for x in select value from jsonb_array_elements(p->'facts') loop
    if not private.ai_keys_ok(x,fact_keys,fact_keys) then raise exception 'AI_FACTS_INVALID';end if;
    fid:=x->>'id';
    if jsonb_typeof(x->'id')<>'string' or fid!~'^[A-Za-z0-9_.:-]{1,80}$' or fid=any(facts) or jsonb_typeof(x->'statement')<>'string' or length(btrim(x->>'statement')) not between 1 and 1000
      or coalesce(x->>'verification_class','') not in ('ORDINARY_FACT','SYSTEMIC_MACRO','SENSITIVE_UNCONFIRMED')
      or jsonb_typeof(x->'independently_verified')<>'boolean' or jsonb_typeof(x->'korea_path_verified')<>'boolean'
      or jsonb_typeof(x->'recorded_at')<>'string' or not private.ai_string_array(x->'source_urls',12,2000) or jsonb_array_length(x->'source_urls')=0 then raise exception 'AI_FACTS_INVALID';end if;
    perform (x->>'recorded_at')::timestamptz;
    if (x->>'recorded_at')::timestamptz>now()+interval '5 minutes' then raise exception 'AI_FACTS_INVALID';end if;
    for y in select value from jsonb_array_elements(x->'source_urls') loop if not private.real_source_url_ok(y#>>'{}') then raise exception 'AI_FACT_SOURCE_NOT_ALLOWED';end if;end loop;
    facts:=array_append(facts,fid);
  end loop;
  -- Draft: known keys only (no reservation, sample kind or other control fields), typed at every depth.
  d:=p->'draft';
  if not private.ai_keys_ok(d,draft_keys,array['title','summary','issue_analysis','article_kind','source_market','selection_market_basis','sources']) then raise exception 'AI_DRAFT_FIELDS';end if;
  foreach k in array text_fields loop if jsonb_typeof(d->k)<>'string' then raise exception 'AI_DRAFT_FIELDS';end if;end loop;
  if coalesce(d->>'article_kind','') not in ('SECTOR','MACRO','COMPANY') then raise exception 'AI_DRAFT_FIELDS';end if;
  -- Core text and market values as the publication rules require them, so a received draft is always previewable text.
  if length(btrim(d->>'title')) not between 1 and 200 or length(btrim(d->>'summary')) not between 1 and 1500 or length(btrim(d->>'issue_analysis')) not between 1 and 20000
    or d->>'source_market' not in ('KR','US','GLOBAL') or d->>'selection_market_basis' not in ('KR','FOREIGN_US') then raise exception 'AI_DRAFT_CORE_INVALID';end if;
  foreach k in array array['primary_sector_id','primary_company_ref'] loop
    if d ? k and jsonb_typeof(d->k) not in ('string','null') then raise exception 'AI_DRAFT_FIELDS';end if;
  end loop;
  if d ? 'key_issues' and not private.ai_string_array(d->'key_issues',12,1000) or d ? 'risks' and not private.ai_string_array(d->'risks',20,1500)
    or d ? 'company_refs' and not private.ai_string_array(d->'company_refs',30,36) then raise exception 'AI_DRAFT_FIELDS';end if;
  if jsonb_typeof(d->'sources')<>'array' or jsonb_array_length(d->'sources') not between 1 and 12 then raise exception 'AI_SOURCES_INVALID';end if;
  for x in select value from jsonb_array_elements(d->'sources') loop
    if not private.ai_keys_ok(x,array['name','url','role'],array['name','url','role']) or jsonb_typeof(x->'name')<>'string' or length(btrim(x->>'name')) not between 1 and 100
      or coalesce(x->>'role','') not in ('PRIMARY','REPORTED') or not private.real_source_url_ok(x->>'url') then raise exception 'AI_SOURCES_INVALID';end if;
    -- The role label must agree with the database's own host classification.
    if (x->>'role'='PRIMARY') is distinct from (private.real_source_host(x->>'url')=any(coalesce((select official_source_hosts from private.real_mode where id=1),'{}'::text[]))) then raise exception 'AI_SOURCE_ROLE_MISMATCH';end if;
  end loop;
  for x in select value from jsonb_array_elements(p->'facts') loop
    for y in select value from jsonb_array_elements(x->'source_urls') loop
      if not exists(select 1 from jsonb_array_elements(d->'sources') s where s.value->>'url'=y#>>'{}') then raise exception 'AI_FACT_SOURCE_UNLISTED';end if;
    end loop;
  end loop;
  if d ? 'impacts' and (jsonb_typeof(d->'impacts')<>'array' or jsonb_array_length(d->'impacts')>30) then raise exception 'AI_IMPACTS_INVALID';end if;
  for x in select value from jsonb_array_elements(coalesce(d->'impacts','[]')) loop
    if not private.ai_keys_ok(x,impact_keys,array['sector_id','path_id','direction','description','evidence_fact_ids'])
      or exists(select 1 from unnest(array['sector_id','path_id','direction','conditional_direction','description']) f where x ? f and jsonb_typeof(x->f)<>'string')
      or x ? 'conditions' and not private.ai_string_array(x->'conditions',10,1000) or not private.ai_string_array(x->'evidence_fact_ids',10,80)
      or x ? 'companies' and (jsonb_typeof(x->'companies')<>'array' or jsonb_array_length(x->'companies')>20) then raise exception 'AI_IMPACTS_INVALID';end if;
    for y in select value from jsonb_array_elements(coalesce(x->'companies','[]')) loop
      if not private.ai_keys_ok(y,array['company_ref','role'],array['company_ref','role']) or jsonb_typeof(y->'company_ref')<>'string' or jsonb_typeof(y->'role')<>'string' or length(y->>'role')>80 then raise exception 'AI_IMPACTS_INVALID';end if;
    end loop;
    for y in select value from jsonb_array_elements(x->'evidence_fact_ids') loop if not (y#>>'{}')=any(facts) then raise exception 'UNKNOWN_FACT_REF';end if;end loop;
  end loop;
  if d ? 'scenarios' and (jsonb_typeof(d->'scenarios')<>'array' or jsonb_array_length(d->'scenarios')>2) then raise exception 'AI_SCENARIOS_INVALID';end if;
  for x in select value from jsonb_array_elements(coalesce(d->'scenarios','[]')) loop
    if not private.ai_keys_ok(x,scenario_keys,scenario_keys) or jsonb_typeof(x->'direction')<>'string' or jsonb_typeof(x->'title')<>'string' or jsonb_typeof(x->'expected_result')<>'string'
      or not private.ai_string_array(x->'checks',10,1000) or not private.ai_string_array(x->'path_ids',30,80) then raise exception 'AI_SCENARIOS_INVALID';end if;
  end loop;
  if d ? 'schedule' and (jsonb_typeof(d->'schedule')<>'array' or jsonb_array_length(d->'schedule')>20) then raise exception 'AI_SCHEDULE_INVALID';end if;
  for x in select value from jsonb_array_elements(coalesce(d->'schedule','[]')) loop
    if not private.ai_keys_ok(x,schedule_keys,array['kind','status','title','timezone','evidence_as_of','evidence_fact_ids'])
      or exists(select 1 from unnest(schedule_keys) f where f<>'evidence_fact_ids' and x ? f and (jsonb_typeof(x->f)<>'string' or length(x->>f)>200))
      or not private.ai_string_array(x->'evidence_fact_ids',10,80) then raise exception 'AI_SCHEDULE_INVALID';end if;
    for y in select value from jsonb_array_elements(x->'evidence_fact_ids') loop if not (y#>>'{}')=any(facts) then raise exception 'UNKNOWN_FACT_REF';end if;end loop;
  end loop;
end$$;

-- Catalog IDs the draft refers to, checked one by one against the current head (no version-string matching). A company
-- named on an impact must be a visible member of that impact's sector.
create function private.ai_catalog_drift(d jsonb,p_head bigint) returns jsonb language sql stable set search_path='' as $$
  with sectors as (
    select d->>'primary_sector_id' ref where jsonb_typeof(d->'primary_sector_id')='string'
    union select x->>'sector_id' from jsonb_array_elements(coalesce(d->'impacts','[]')) x
  ), companies as (
    select d->>'primary_company_ref' ref where jsonb_typeof(d->'primary_company_ref')='string'
    union select value from jsonb_array_elements_text(coalesce(d->'company_refs','[]'))
    union select c->>'company_ref' from jsonb_array_elements(coalesce(d->'impacts','[]')) x,jsonb_array_elements(coalesce(x->'companies','[]')) c
  ), placed as (
    select c->>'company_ref' company,x->>'sector_id' sector from jsonb_array_elements(coalesce(d->'impacts','[]')) x,jsonb_array_elements(coalesce(x->'companies','[]')) c
  ), uuid_re as (select '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text re)
  select coalesce(jsonb_agg(item order by item),'[]') from (
    select 'sector:'||coalesce(s.ref,'null') item from sectors s,uuid_re u
      where s.ref is null or s.ref!~u.re or not private.catalog_sector_selectable(s.ref::uuid,p_head,'PERMITTED_REAL')
    union all
    select 'company:'||coalesce(k.ref,'null') from companies k,uuid_re u
      where k.ref is null or k.ref!~u.re or not exists(select 1 from private.catalog_source_companies c where c.id=k.ref::uuid and c.active
        and exists(select 1 from private.catalog_memberships m where m.source_company_ref=c.id and private.search_membership_visible(m.id,p_head)))
    union all
    select 'company_sector:'||pl.company||'@'||pl.sector from placed pl,uuid_re u
      where pl.company~u.re and pl.sector~u.re and not exists(select 1 from private.catalog_memberships m
        where m.source_company_ref=pl.company::uuid and m.sector_id=pl.sector::uuid and m.active and private.search_membership_visible(m.id,p_head))
  ) bad
$$;

-- Removes the local draft, claims and evidence of an AI-linked issue (unpublished only in 1A).
create function private.ai_clear_issue(p_issue uuid) returns void language plpgsql set search_path='' as $$
begin
  if exists(select 1 from private.issues where id=p_issue and publication_state<>'DRAFT') then raise exception 'AI_ISSUE_NOT_DRAFT';end if;
  delete from private.ai_claim_links where issue_id=p_issue;
  delete from private.evidence_edges where claim_id in (select id from private.claims where issue_id=p_issue);
  delete from private.claims where issue_id=p_issue;
  delete from private.editor_drafts where issue_id=p_issue;
  delete from private.ai_draft_origin where issue_id=p_issue;
end$$;

create function private.ai_ingest_draft(p_effect_key text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
    elsif lnk.issue_id is not null and (i.manual_protected or ed.updated_by is not null) then
      -- The editor owns this draft now: keep it, keep its claims, and show the new evidence beside it.
      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at)
        values(lnk.issue_id,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',now()+interval '30 days');
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
      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at)
        values(iss,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',now()+interval '30 days');
      insert into private.ai_issue_links(ai_issue_id,issue_id,current_version,state) values(ai,iss,ver,'ACTIVE')
        on conflict(ai_issue_id) do update set issue_id=excluded.issue_id,current_version=excluded.current_version,state='ACTIVE',reason='',updated_at=now();
      result:=jsonb_build_object('state','RECEIVED','ai_version',ver,'issue_id',iss,'catalog_version',head,'claims',jsonb_array_length(p_payload->'facts'));
    end if;
  end if;
  insert into private.ai_draft_receipts(effect_key,ai_issue_id,ai_version,payload_sha256,result) values(p_effect_key,ai,ver,h,result);
  insert into private.audits(actor_id,action,entity_id,details) values('ai-inbox','AI_DRAFT_'||(result->>'state'),ai,jsonb_build_object('ai_version',ver,'issue_id',result->'issue_id'));
  return result;
end$$;

create function private.ai_withdraw_draft(p_ai_issue text,p_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare lnk private.ai_issue_links;result jsonb;
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
    if lnk.issue_id is not null then perform private.ai_clear_issue(lnk.issue_id);end if;
    update private.ai_issue_links set current_version=p_version,state='WITHDRAWN',reason=p_reason,updated_at=now() where ai_issue_id=p_ai_issue;
    result:=jsonb_build_object('state','WITHDRAWN','ai_version',p_version,'issue_id',lnk.issue_id);
  end if;
  insert into private.audits(actor_id,action,entity_id,details) values('ai-inbox','AI_DRAFT_WITHDRAW_'||(result->>'state'),p_ai_issue,jsonb_build_object('ai_version',p_version,'reason',p_reason));
  return result;
end$$;

-- 30-day retention of unpublished AI drafts and their evidence; runs inside the existing daily retention tick.
create function private.ai_inbox_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;iss uuid;n integer:=0;
begin
  -- Each issue is handled under the same per-issue lock as intake and withdrawal, and re-read after taking it, so a
  -- concurrent intake can never be undone by a stale view.
  for r in select l.ai_issue_id from private.ai_issue_links l where l.state in ('ACTIVE','HOLD_EDITOR') and l.issue_id is not null order by l.ai_issue_id loop
    perform pg_advisory_xact_lock(hashtext('ai-issue:'||r.ai_issue_id));
    -- A draft expires 30 days after its own evidence arrived; newer pending versions beside a held draft never extend it.
    select l.issue_id into iss from private.ai_issue_links l join private.issues i on i.id=l.issue_id
      where l.ai_issue_id=r.ai_issue_id and l.state in ('ACTIVE','HOLD_EDITOR') and i.publication_state='DRAFT'
        and coalesce((select o.expires_at from private.ai_draft_origin o where o.issue_id=l.issue_id
          and o.ai_version=(select max(c.ai_version) from private.ai_claim_links c where c.issue_id=l.issue_id)),'-infinity')<=now()
      for update of l;
    if found then
      perform private.ai_clear_issue(iss);
      update private.ai_issue_links set state='WITHDRAWN',reason='EXPIRED',updated_at=now() where ai_issue_id=r.ai_issue_id;
      n:=n+1;
    else
      -- Expired pending evidence goes; the evidence of the draft itself stays with it.
      delete from private.ai_draft_origin o using private.ai_issue_links l where l.ai_issue_id=r.ai_issue_id and o.issue_id=l.issue_id and o.expires_at<=now()
        and o.ai_version is distinct from (select max(c.ai_version) from private.ai_claim_links c where c.issue_id=o.issue_id);
    end if;
  end loop;
  -- Receipts are permanent (small, and they keep replays and conflicts exact forever).
  return jsonb_build_object('expired',n);
end$$;
alter function private.retention_tick() rename to retention_tick_v1;
create function private.retention_tick() returns jsonb language plpgsql security definer set search_path='' as $$
begin return private.retention_tick_v1()||jsonb_build_object('ai_inbox',private.ai_inbox_cleanup());end$$;

-- A5 (DB part): the editor sees that a draft came from the AI and the evidence behind it.
create or replace function public.m1_get_draft(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;labels jsonb;head bigint;k private.sample_kind;origin jsonb;
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
 -- The draft's own evidence (the version its claims came from) and, when the editor holds the draft, the newest
 -- evidence waiting beside it; versions are never mixed.
 if exists(select 1 from private.ai_issue_links l where l.issue_id=p_issue) then
  select jsonb_build_object(
   'link_state',(select l.state from private.ai_issue_links l where l.issue_id=p_issue),
   'draft',(select jsonb_build_object('ai_version',o.ai_version,'facts',o.facts,'sources',o.sources,'received_at',o.received_at,
      'claim_ids',(select coalesce(jsonb_object_agg(c.fact_id,c.claim_id),'{}') from private.ai_claim_links c where c.issue_id=p_issue and c.ai_version=o.ai_version))
     from private.ai_draft_origin o where o.issue_id=p_issue and o.ai_version=(select max(c.ai_version) from private.ai_claim_links c where c.issue_id=p_issue)),
   'pending',(select jsonb_build_object('ai_version',o.ai_version,'facts',o.facts,'sources',o.sources,'received_at',o.received_at)
     from private.ai_draft_origin o where o.issue_id=p_issue and o.ai_version>coalesce((select max(c.ai_version) from private.ai_claim_links c where c.issue_id=p_issue),0)
     order by o.ai_version desc limit 1)) into origin;
 end if;
 return result||jsonb_build_object('sector_labels',labels,'sample_kind',k,'ai_origin',origin);
end$$;
create or replace function public.m1_editor_articles() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(row_to_json(t)) from(select i.id,i.publication_state,i.revision,d.revision draft_revision,d.content->>'title' title,d.updated_at,i.sample_kind,
  (select jsonb_build_object('state',l.state,'ai_version',l.current_version,'facts',(select jsonb_array_length(o.facts) from private.ai_draft_origin o where o.issue_id=i.id order by o.ai_version desc limit 1))
   from private.ai_issue_links l where l.issue_id=i.id) ai_origin from private.issues i join private.editor_drafts d on d.issue_id=i.id order by d.updated_at desc limit 100)t),'[]');end$$;

revoke all on function private.real_source_host(text), private.ai_string_array(jsonb,integer,integer), private.ai_keys_ok(jsonb,text[],text[]), private.ai_payload_check(jsonb), private.ai_catalog_drift(jsonb,bigint), private.ai_clear_issue(uuid), private.ai_ingest_draft(text,jsonb),
  private.ai_withdraw_draft(text,integer,text), private.ai_inbox_cleanup(), private.retention_tick(), private.retention_tick_v1() from public, anon, authenticated, service_role;
commit;
