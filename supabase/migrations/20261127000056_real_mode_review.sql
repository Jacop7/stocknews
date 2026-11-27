begin;
-- Publish stage 1A (docs/publish-stage1-plan.md, Codex plan APPROVE 2026-11-27): real-data review without any public
-- exposure. A1 switch and source-URL rule, A2 a separate real-data validator chain, the public fence, the 1A publish
-- block and the admin DTO fields. The synthetic path is unchanged.

-- A1. Real-data mode: one row, off by default, changeable only by postgres, and only on a local environment.
create table private.real_mode (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  allowed_source_hosts text[] not null,
  changed_at timestamptz not null default now(),
  note text not null default ''
);
alter table private.real_mode enable row level security;
revoke all on private.real_mode from public, anon, authenticated, service_role;
insert into private.real_mode(id, enabled, allowed_source_hosts, note)
  values (1, false, array['dart.fss.or.kr', 'kind.krx.co.kr'], 'stage 1A: official filings only');

create function private.real_mode_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>1 then raise exception 'REAL_MODE_SINGLETON';end if;
  if new.enabled and not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'REAL_MODE_LOCAL_ONLY_1A';end if;
  if cardinality(new.allowed_source_hosts) not between 1 and 20
    or exists(select 1 from unnest(new.allowed_source_hosts) h where h is null or h!~'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or length(h)>253) then raise exception 'REAL_MODE_HOSTS_INVALID';end if;
  new.changed_at:=now();
  return new;
end$$;
create trigger real_mode_guard before insert or update on private.real_mode for each row execute function private.real_mode_guard();

create function private.real_mode_on() returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.real_mode where id=1 and enabled)
     and exists(select 1 from private.runtime_identity where environment='local')
$$;

-- Source URLs of real articles: https, no userinfo or port, an exactly listed lowercase host (no subdomain matching,
-- no trailing dot, no percent-encoding in the authority), no whitespace, control characters or backslashes.
create function private.real_source_url_ok(p_url text) returns boolean language plpgsql stable set search_path='' as $$
declare m text[];
begin
  if p_url is null or length(p_url) not between 9 and 2000 or p_url ~ '[[:space:][:cntrl:]\\]' then return false;end if;
  m:=regexp_match(p_url,'^https://([^/?#]*)([/?#].*)?$');
  if m is null or m[1]!~'^[a-z0-9.-]+$' or m[1] like '%.' then return false;end if;
  return coalesce((select m[1]=any(r.allowed_source_hosts) from private.real_mode r where r.id=1),false);
end$$;

revoke all on function private.real_mode_guard(), private.real_mode_on(), private.real_source_url_ok(text) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_issue(p_issue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare canonical uuid:=p_issue;i private.issues;visited uuid[]:='{}';k integer;
begin
  for k in 1..16 loop
    if canonical=any(visited) then raise exception 'ALIAS_CYCLE';end if;visited:=array_append(visited,canonical);
    if not exists(select 1 from private.issue_aliases where alias_id=canonical) then exit;end if;
    select canonical_issue_id into canonical from private.issue_aliases where alias_id=canonical;
  end loop;
  if exists(select 1 from private.issue_aliases where alias_id=canonical) then raise exception 'ALIAS_CHAIN_LIMIT';end if;
  select * into i from private.issues where id=canonical;
  if not found or i.publication_state='DRAFT' or i.sample_kind<>'SYNTHETIC' then return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');end if;
  return jsonb_build_object('canonical_issue_id',i.id,'state',i.publication_state,'message',case i.publication_state when 'PUBLISHED' then '공개된 글' when 'CORRECTION_PENDING' then '내용 확인 중 · 기존 내용 제공 중지' when 'WITHDRAWN' then '근거 확인 불가로 게시 중단' else '현재 제공하지 않는 글' end);
end$function$;

-- Real-data validator chain (generated from the live M1 chain by scripts/tools/gen-migration-56.mjs).
CREATE OR REPLACE FUNCTION private.m1_prepare_real_v1(p_issue uuid, p_input jsonb, p_policy bigint, p_catalog bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b jsonb:=p_input;x jsonb;e uuid;sector uuid;path text;direction text;cd text;positive text[]:='{}';negative text[]:='{}';
  benefit jsonb:='[]';damage jsonb:='[]';related jsonb:='[]';all_sectors jsonb:='[]';impacts jsonb:='[]';scenarios jsonb;profile text;
  pos_count integer;neg_count integer;title text;valid boolean;seen text[]:='{}';key text;schedules jsonb:='[]';kind text;tz text;start_at timestamptz;end_at timestamptz;
begin
  if b is null or jsonb_typeof(b)<>'object' or pg_column_size(b)>131072 then raise exception 'INVALID_EDITOR_CONTENT';end if;
  if b ? 'scheduled_publish_at' or b ? 'sample_kind' and b->>'sample_kind'<>'PERMITTED_REAL' then raise exception 'RESERVATION_OR_REAL_MODE_NOT_ENABLED';end if;
  if not exists(select 1 from private.policies where version=p_policy and active) or not exists(select 1 from private.catalog_versions where version=p_catalog and active) then raise exception 'STALE_POLICY_OR_CATALOG';end if;
  if not private.real_mode_on() then raise exception 'REAL_MODE_OFF';end if;
  if not exists(select 1 from private.issues where id=p_issue and sample_kind='PERMITTED_REAL') then raise exception 'REAL_ISSUE_REQUIRED';end if;
  if length(trim(coalesce(b->>'title',''))) not between 1 and 200 or length(trim(coalesce(b->>'summary',''))) not between 1 and 1500
    or length(trim(coalesce(b->>'issue_analysis',''))) not between 1 and 20000 then raise exception 'CORE_TEXT_REQUIRED';end if;
  if coalesce(b->>'article_kind','') not in ('SECTOR','MACRO','COMPANY') or coalesce(b->>'source_market','') not in ('KR','US','GLOBAL') or coalesce(b->>'selection_market_basis','') not in ('KR','FOREIGN_US') then raise exception 'ARTICLE_MARKET_REQUIRED';end if;
  if b ? 'analysis_perspective' and b->>'analysis_perspective'<>'KR_EQUITY' then raise exception 'KR_PERSPECTIVE_REQUIRED';end if;
  sector:=nullif(b->>'primary_sector_id','')::uuid;
  if (b->>'article_kind'='SECTOR' or b->>'article_kind'='COMPANY' and jsonb_typeof(b->'impacts')='array' and jsonb_array_length(b->'impacts')>0) and sector is null then raise exception 'PRIMARY_SECTOR_REQUIRED';end if;
  if sector is not null and not private.catalog_sector_selectable(sector,p_catalog,'PERMITTED_REAL') then raise exception 'PRIMARY_SECTOR_INACTIVE';end if;
  if jsonb_typeof(b->'key_issues') is distinct from 'array' or jsonb_array_length(b->'key_issues') not between 1 and 12 then raise exception 'KEY_ISSUES_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'key_issues') loop if jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 1000 then raise exception 'INVALID_KEY_ISSUE';end if;end loop;
  if jsonb_typeof(b->'sources') is distinct from 'array' or jsonb_array_length(b->'sources') not between 1 and 12 then raise exception 'SOURCES_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'sources') loop
    if length(trim(coalesce(x->>'name',''))) not between 1 and 100 or not private.real_source_url_ok(x->>'url') then raise exception 'REAL_SOURCE_NOT_ALLOWED';end if;
  end loop;
  if jsonb_typeof(b->'impacts') is distinct from 'array' or jsonb_array_length(b->'impacts') not between (case when b->>'article_kind'='COMPANY' then 0 else 1 end) and 30 then raise exception 'KR_IMPACT_PATH_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'impacts') loop
    sector:=(x->>'sector_id')::uuid;path:=x->>'path_id';direction:=x->>'direction';cd:=coalesce(x->>'conditional_direction','NONE');
    if sector is null or not private.catalog_sector_selectable(sector,p_catalog,'PERMITTED_REAL') then raise exception 'IMPACT_SECTOR_INACTIVE';end if;
    if path is null or path!~'^[A-Za-z0-9_-]{1,80}$' or coalesce(direction,'') not in ('BENEFIT','DAMAGE','RELATED') or cd not in ('NONE','POSITIVE','NEGATIVE') or direction<>'RELATED' and cd<>'NONE' then raise exception 'INVALID_IMPACT_PATH';end if;
    key:=sector::text||':'||path;if key=any(seen) then raise exception 'DUPLICATE_SECTOR_PATH';end if;seen:=array_append(seen,key);
    if length(trim(coalesce(x->>'description',''))) not between 1 and 1500 then raise exception 'IMPACT_DESCRIPTION_REQUIRED';end if;
    if jsonb_typeof(x->'evidence_ids') is distinct from 'array' or jsonb_array_length(x->'evidence_ids') not between 1 and 10 then raise exception 'PATH_EVIDENCE_REQUIRED';end if;
    for e in select value::uuid from jsonb_array_elements_text(x->'evidence_ids') loop
      if e is null or not exists(select 1 from private.claims where id=e and issue_id=p_issue and verified and korea_path_verified and fact_current and sample_kind='PERMITTED_REAL' and claim_type<>'SENSITIVE_UNCONFIRMED' and (valid_until is null or valid_until>now())) then raise exception 'PATH_EVIDENCE_NOT_VERIFIED';end if;
    end loop;
    if jsonb_typeof(coalesce(x->'conditions','[]'))<>'array' or direction='RELATED' and cd<>'NONE' and jsonb_array_length(coalesce(x->'conditions','[]'))=0 then raise exception 'PATH_CONDITION_REQUIRED';end if;
    if direction='BENEFIT' or cd='POSITIVE' then positive:=array_append(positive,path);end if;
    if direction='DAMAGE' or cd='NEGATIVE' then negative:=array_append(negative,path);end if;
    if direction='BENEFIT' then benefit:=benefit||jsonb_build_array(sector);elsif direction='DAMAGE' then damage:=damage||jsonb_build_array(sector);else related:=related||jsonb_build_array(sector);end if;
    all_sectors:=all_sectors||jsonb_build_array(sector);
    impacts:=impacts||jsonb_build_array(jsonb_build_object('sector_id',sector,'path_id',path,'direction',direction,'conditional_direction',cd,'description',x->>'description','conditions',coalesce(x->'conditions','[]'),'evidence_ids',x->'evidence_ids'));
  end loop;
  if jsonb_array_length(benefit)=0 and jsonb_array_length(damage)=0 then profile:='RELATED_CONDITIONAL';
  elsif cardinality(positive)>0 and cardinality(negative)>0 then profile:='POSITIVE_NEGATIVE';
  elsif cardinality(positive)>0 then profile:='POSITIVE_ONLY';else profile:='DAMAGE_ONLY';end if;
  scenarios:=coalesce(b->'scenarios','[]');if jsonb_typeof(scenarios)<>'array' then raise exception 'INVALID_SCENARIOS';end if;
  select count(*) filter(where value->>'direction'='POSITIVE'),count(*) filter(where value->>'direction'='NEGATIVE') into pos_count,neg_count from jsonb_array_elements(scenarios);
  if cardinality(positive)=0 then
    if jsonb_array_length(scenarios)<>0 then raise exception 'NO_POSITIVE_PATH_NO_SCENARIOS';end if;
  elsif pos_count<>1 or neg_count<>(case when cardinality(negative)>0 then 1 else 0 end) or jsonb_array_length(scenarios)<>pos_count+neg_count then raise exception 'SCENARIO_PATH_MISMATCH';end if;
  for x in select value from jsonb_array_elements(scenarios) loop
    if length(trim(coalesce(x->>'title',''))) not between 1 and 200 or length(trim(coalesce(x->>'expected_result',''))) not between 1 and 2000 or jsonb_typeof(x->'checks') is distinct from 'array' or jsonb_array_length(x->'checks')=0
      or jsonb_typeof(x->'path_ids') is distinct from 'array' or jsonb_array_length(x->'path_ids')=0 then raise exception 'SCENARIO_CONTENT_REQUIRED';end if;
    for path in select value from jsonb_array_elements_text(x->'path_ids') loop
      if path is null or not path=any(case when x->>'direction'='POSITIVE' then positive else negative end) then raise exception 'SCENARIO_EVIDENCE_PATH_MISMATCH';end if;
    end loop;
  end loop;
  if jsonb_typeof(coalesce(b->'risks','[]'))<>'array' then raise exception 'INVALID_RISKS';end if;
  if profile='DAMAGE_ONLY' and jsonb_array_length(coalesce(b->'risks','[]'))=0 then raise exception 'DAMAGE_REQUIRES_RISKS';end if;
  if jsonb_typeof(coalesce(b->'schedule','[]'))<>'array' then raise exception 'INVALID_SCHEDULE';end if;
  for x in select value from jsonb_array_elements(coalesce(b->'schedule','[]')) loop
    if coalesce(x->>'status','') not in ('VERIFIED','CANCELLED','UNVERIFIED','SUPERSEDED') then raise exception 'SCHEDULE_STATUS_REQUIRED';end if;
    if x->>'status'='VERIFIED' then
      kind:=x->>'kind';tz:=x->>'timezone';
      if coalesce(kind,'') not in ('EXACT','PERIOD') or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) or length(trim(coalesce(x->>'title',''))) not between 1 and 200 or nullif(x->>'evidence_as_of','')::timestamptz is null or (x->>'evidence_as_of')::timestamptz>now() then raise exception 'SCHEDULE_VERIFICATION_REQUIRED';end if;
      if jsonb_typeof(x->'evidence_ids') is distinct from 'array' or jsonb_array_length(x->'evidence_ids')=0 then raise exception 'SCHEDULE_EVIDENCE_REQUIRED';end if;
      for e in select value::uuid from jsonb_array_elements_text(x->'evidence_ids') loop
        if not exists(select 1 from private.claims where id=e and issue_id=p_issue and verified and fact_current and official_original and (valid_until is null or valid_until>now())) then raise exception 'SCHEDULE_OFFICIAL_EVIDENCE_REQUIRED';end if;
      end loop;
      if kind='EXACT' then
        if nullif(x->>'event_at','')::timestamptz is null then raise exception 'SCHEDULE_INSTANT_REQUIRED';end if;
      else
        start_at:=nullif(x->>'period_start','')::timestamptz;end_at:=nullif(x->>'period_end','')::timestamptz;
        if start_at is null or end_at is null or start_at>=end_at or length(trim(coalesce(x->>'period_label',''))) not between 1 and 100 or length(trim(coalesce(x->>'precision',''))) not between 1 and 40 or x ? 'event_at' then raise exception 'SCHEDULE_PERIOD_REQUIRED';end if;
      end if;
    end if;
    schedules:=schedules||jsonb_build_array(x);
  end loop;
  return jsonb_build_object('_contract','M1','_profile',profile,'_positive_paths',to_jsonb(positive),'_negative_paths',to_jsonb(negative),
    'title',b->>'title','summary',b->>'summary','article_kind',b->>'article_kind','primary_sector_id',nullif(b->>'primary_sector_id','')::uuid,
    'source_market',b->>'source_market','selection_market_basis',b->>'selection_market_basis','analysis_perspective','KR_EQUITY',
    'key_issues',b->'key_issues','issue_analysis',b->>'issue_analysis','sources',b->'sources','scenarios',scenarios,'impacts',impacts,
    'benefit_sector_ids',benefit,'damage_sector_ids',damage,'related_sector_ids',related,'filter_sector_ids',all_sectors,'risks',coalesce(b->'risks','[]'),'schedule',schedules);
end$function$;

CREATE OR REPLACE FUNCTION private.m1_prepare_real_v2(p_issue uuid, p_input jsonb, p_policy bigint, p_catalog bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b jsonb;k text;items jsonb;
begin
  b:=private.m1_prepare_real_v1(p_issue,p_input,p_policy,p_catalog);
  foreach k in array array['benefit_sector_ids','damage_sector_ids','related_sector_ids','filter_sector_ids'] loop
    select coalesce(jsonb_agg(value order by value),'[]') into items from(select distinct value from jsonb_array_elements(b->k)) s;
    b:=jsonb_set(b,array[k],items);
  end loop;return b;
end$function$;

CREATE OR REPLACE FUNCTION private.m1_prepare_real_v3(p_issue uuid, p_input jsonb, p_policy bigint, p_catalog bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b jsonb;x jsonb;key text;
begin
  b:=private.m1_prepare_real_v2(p_issue,p_input,p_policy,p_catalog);
  if not private.m1_text_array(b->'risks',20,1500) then raise exception 'INVALID_RISK_TEXT';end if;
  for x in select value from jsonb_array_elements(b->'impacts') loop if not private.m1_text_array(x->'conditions',10,1000) then raise exception 'INVALID_CONDITION_TEXT';end if;end loop;
  for x in select value from jsonb_array_elements(b->'scenarios') loop
    if jsonb_typeof(x->'title') is distinct from 'string' or jsonb_typeof(x->'expected_result') is distinct from 'string' or not private.m1_text_array(x->'checks',10,1000) then raise exception 'INVALID_SCENARIO_TEXT';end if;
  end loop;
  for x in select value from jsonb_array_elements(b->'schedule') where value->>'status'='VERIFIED' loop
    foreach key in array (case when x->>'kind'='EXACT' then array['event_at','evidence_as_of'] else array['period_start','period_end','evidence_as_of'] end) loop
      if coalesce(x->>key,'')!~'T[^[:space:]]*(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'SCHEDULE_OFFSET_REQUIRED';end if;
    end loop;
  end loop;
  return b;
end$function$;

CREATE OR REPLACE FUNCTION private.m1_prepare_real_v4(p_issue uuid, p_input jsonb, p_policy bigint, p_catalog bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b jsonb;
begin
 b:=private.m1_prepare_real_v3(p_issue,p_input,p_policy,p_catalog);
 if (b->>'article_kind'='SECTOR' or b->>'article_kind'='COMPANY' and b->>'primary_sector_id' is not null) and not exists(select 1 from jsonb_array_elements_text(b->'filter_sector_ids') x where x=b->>'primary_sector_id') then raise exception 'PRIMARY_SECTOR_PATH_REQUIRED';end if;
 return b;
end$function$;

CREATE OR REPLACE FUNCTION private.m1_prepare_real_v5(p_issue uuid, p_input jsonb, p_policy bigint, p_catalog bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if not private.m1_core_evidence(p_issue,coalesce(p_input->>'article_kind','')) then raise exception 'CLAIM_NOT_VERIFIED';end if;
 return private.m1_prepare_real_v4(p_issue,p_input,p_policy,p_catalog)||jsonb_build_object('_issue_id',p_issue);
end$function$;

CREATE OR REPLACE FUNCTION private.m1_prepare_real_v7(p_issue uuid, p_input jsonb, p_policy bigint, p_catalog bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b jsonb;kind text:=p_input->>'article_kind';refs jsonb:=coalesce(p_input->'company_refs','[]'::jsonb);x jsonb;primary_ref uuid;
 uuid_text constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if jsonb_typeof(refs)<>'array' or jsonb_array_length(refs)>30 then raise exception 'COMPANY_REFS_INVALID';end if;
 for x in select value from jsonb_array_elements(refs) loop
  if jsonb_typeof(x)<>'string' or x#>>'{}'!~uuid_text then raise exception 'COMPANY_REFS_INVALID';end if;
  if not exists(select 1 from private.catalog_source_companies c where c.id=(x#>>'{}')::uuid and c.active
   and exists(select 1 from private.catalog_memberships m where m.source_company_ref=c.id and private.search_membership_visible(m.id,p_catalog))) then raise exception 'COMPANY_REF_INACTIVE';end if;
 end loop;
 if (select count(distinct value) from jsonb_array_elements_text(refs))<>jsonb_array_length(refs) then raise exception 'COMPANY_REFS_INVALID';end if;
 if p_input ? 'primary_company_ref' and jsonb_typeof(p_input->'primary_company_ref')<>'null' then
  if jsonb_typeof(p_input->'primary_company_ref')<>'string' or p_input->>'primary_company_ref'!~uuid_text then raise exception 'PRIMARY_COMPANY_REQUIRED';end if;
  primary_ref:=(p_input->>'primary_company_ref')::uuid;
 end if;
 if kind='COMPANY' then
  if primary_ref is null or not refs ? primary_ref::text then raise exception 'PRIMARY_COMPANY_REQUIRED';end if;
  b:=private.m1_prepare_real_v5(p_issue,p_input,p_policy,p_catalog);
 else
  if primary_ref is not null then raise exception 'PRIMARY_COMPANY_ONLY_FOR_COMPANY_SCOPE';end if;
  b:=private.m1_prepare_real_v5(p_issue,p_input,p_policy,p_catalog);
 end if;
 return b||jsonb_build_object('company_refs',refs,'primary_company_ref',primary_ref);
end$function$;

CREATE OR REPLACE FUNCTION private.m1_prepare_real(p_issue uuid, p_input jsonb, p_policy bigint, p_catalog bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b jsonb;input_impact jsonb;x jsonb;stored jsonb:='[]';item jsonb;companies jsonb;seen text[];company_name text;
begin
 b:=private.m1_prepare_real_v7(p_issue,p_input,p_policy,p_catalog);
 -- Real MACRO articles: every fact must be an official original (independent-source edges come in 1B).
 if b->>'article_kind'='MACRO' and exists(select 1 from private.claims c where c.issue_id=p_issue and not c.official_original) then raise exception 'REAL_MACRO_REQUIRES_OFFICIAL';end if;
 for item in select value from jsonb_array_elements(b->'impacts') loop
  select value into input_impact from jsonb_array_elements(p_input->'impacts') where value->>'sector_id'=item->>'sector_id' and value->>'path_id'=item->>'path_id' limit 1;
  companies:='[]';seen:='{}';
  if input_impact ? 'companies' then
   if jsonb_typeof(input_impact->'companies')<>'array' or jsonb_array_length(input_impact->'companies')>20 then raise exception 'IMPACT_COMPANIES_INVALID';end if;
   for x in select value from jsonb_array_elements(input_impact->'companies') loop
    if jsonb_typeof(x)<>'object' or jsonb_typeof(x->'company_ref')<>'string' or jsonb_typeof(x->'role')<>'string' or length(btrim(x->>'role')) not between 2 and 80
     or not (b->'company_refs') ? (x->>'company_ref') or x->>'company_ref'=any(seen) then raise exception 'IMPACT_COMPANIES_INVALID';end if;
    select c.name into company_name from private.catalog_source_companies c where c.id=(x->>'company_ref')::uuid and c.active;
    -- The role explains the link; repeating the company name is not a reason.
    if company_name is null or btrim(x->>'role')=company_name then raise exception 'IMPACT_COMPANIES_INVALID';end if;
    seen:=array_append(seen,x->>'company_ref');companies:=companies||jsonb_build_array(jsonb_build_object('company_ref',x->>'company_ref','role',btrim(x->>'role')));
   end loop;
  end if;
  stored:=stored||jsonb_build_array(item||jsonb_build_object('companies',companies));
 end loop;
 return b||jsonb_build_object('impacts',stored);
end$function$;

-- Reference-catalog sectors are selectable for real issues while real mode is on; fixture sectors stay synthetic-only.
CREATE OR REPLACE FUNCTION private.catalog_sector_selectable(p_sector uuid, p_catalog bigint, p_article_mode text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select (p_article_mode='SYNTHETIC' or p_article_mode='PERMITTED_REAL' and private.real_mode_on())
 and exists(select 1 from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null)
 and exists(select 1 from private.catalog_head h join private.catalog_versions v on v.version=h.version and v.active
 join private.catalog_approvals a on a.version=h.version and a.state='APPROVED'
 join private.catalog_snapshots c on c.version=h.version
 join private.catalog_version_sectors m on m.version=h.version and m.sector_id=p_sector and m.active and m.catalog_kind='LEAF'
 join private.sectors s on s.id=m.sector_id and s.active and s.catalog_kind='LEAF' and s.catalog_version=h.version
 left join private.sectors parent on parent.id=s.parent_id
 where h.version=p_catalog and
 ((c.usage_scope='LOCAL_REFERENCE' and m.metadata_kind='USER_REFERENCE_UNVERIFIED' and s.metadata_kind='USER_REFERENCE_UNVERIFIED' and s.sample_kind is null
 and parent.active and parent.catalog_kind='PARENT' and parent.metadata_kind='USER_REFERENCE_UNVERIFIED' and parent.catalog_version=h.version)
 or (p_article_mode='SYNTHETIC' and c.usage_scope='LEGACY_FIXTURE' and m.metadata_kind='SYNTHETIC_FIXTURE' and s.metadata_kind='SYNTHETIC_FIXTURE' and s.sample_kind='SYNTHETIC')))
$function$;

-- A2. Dispatcher: real issues go to the real chain, everything else to the unchanged synthetic chain. A draft may never
-- mix sample kinds (claims of another kind on the issue).
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v8;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare k private.sample_kind;
begin
  select sample_kind into k from private.issues where id=p_issue;
  if k is null then raise exception 'ISSUE_NOT_FOUND';end if;
  if exists(select 1 from private.claims c where c.issue_id=p_issue and c.sample_kind<>k) then raise exception 'MIXED_SAMPLE_KIND';end if;
  if k='PERMITTED_REAL' then return private.m1_prepare_real(p_issue,p_input,p_policy,p_catalog);end if;
  return private.m1_prepare_v8(p_issue,p_input,p_policy,p_catalog);
end$$;

-- 1A publish block: no real article is published or scheduled (both go through the publish core).
alter function private.reservation_publish_core(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid) rename to reservation_publish_core_v1;
create function private.reservation_publish_core(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text,p_actor uuid,p_schedule uuid)
returns jsonb language plpgsql set search_path='' as $$
begin
  if exists(select 1 from private.issues where id=p_issue and sample_kind<>'SYNTHETIC') then raise exception 'REAL_PUBLICATION_NOT_ENABLED_1A';end if;
  return private.reservation_publish_core_v1(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key,p_actor,p_schedule);
end$$;

-- Public fence (1A): every public read boundary requires a synthetic issue directly, so even a mistakenly published
-- real article never leaves the database.
alter function private.m1_current_evidence(uuid) rename to m1_current_evidence_v3;
create function private.m1_current_evidence(p_issue uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.issues where id=p_issue and sample_kind='SYNTHETIC') and private.m1_current_evidence_v3(p_issue)
$$;
create or replace function public.is_news_visible(p_issue uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=p_issue and i.publication_state='PUBLISHED'
   and i.sample_kind='SYNTHETIC'
   and (v.public_body->>'_contract' is distinct from 'M1' or private.m1_current_evidence(i.id)))
$$;
alter function private.m0_get_public_article_legacy(uuid) rename to m0_get_public_article_legacy_v1;
create function private.m0_get_public_article_legacy(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  r:=private.m0_get_public_article_legacy_v1(p_issue);
  if r ? 'issue_id' and not exists(select 1 from private.issues where id=(r->>'issue_id')::uuid and sample_kind='SYNTHETIC') then
    return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
  end if;
  return r;
end$$;

-- A5 (DB part). The preview carries the issue's own sample kind; draft detail and list carry it too.
create or replace function public.m1_preview_draft(p_issue uuid,p_expected_revision bigint,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.editor_drafts;b jsonb;sections text[];k private.sample_kind;
begin perform private.m1_assert_editor();select * into strict d from private.editor_drafts where issue_id=p_issue;
  if d.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  select sample_kind into strict k from private.issues where id=p_issue;
  b:=private.m1_prepare(p_issue,d.content,p_policy,p_catalog);sections:=private.visible_sections(b->>'_profile',b,now(),now());
  return jsonb_build_object('title',b->>'title','summary',b->>'summary','body',private.public_body(b,sections,now()),'sample_kind',k);
end$$;
create or replace function public.m1_get_draft(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;labels jsonb;head bigint;k private.sample_kind;
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
 return result||jsonb_build_object('sector_labels',labels,'sample_kind',k);
end$$;
create or replace function public.m1_editor_articles() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(row_to_json(t)) from(select i.id,i.publication_state,i.revision,d.revision draft_revision,d.content->>'title' title,d.updated_at,i.sample_kind from private.issues i join private.editor_drafts d on d.issue_id=i.id order by d.updated_at desc limit 100)t),'[]');end$$;

-- New private functions: owner only.
revoke all on function private.m1_prepare(uuid,jsonb,bigint,bigint), private.m1_prepare_real(uuid,jsonb,bigint,bigint),
  private.m1_prepare_real_v1(uuid,jsonb,bigint,bigint), private.m1_prepare_real_v2(uuid,jsonb,bigint,bigint), private.m1_prepare_real_v3(uuid,jsonb,bigint,bigint),
  private.m1_prepare_real_v4(uuid,jsonb,bigint,bigint), private.m1_prepare_real_v5(uuid,jsonb,bigint,bigint), private.m1_prepare_real_v7(uuid,jsonb,bigint,bigint),
  private.reservation_publish_core(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid), private.m1_current_evidence(uuid), private.m0_get_public_article_legacy(uuid)
  from public, anon, authenticated, service_role;
-- Renamed predecessors keep their old ACL on rename; they are internal now.
revoke all on function private.m1_prepare_v8(uuid,jsonb,bigint,bigint), private.reservation_publish_core_v1(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid),
  private.m1_current_evidence_v3(uuid), private.m0_get_public_article_legacy_v1(uuid) from public, anon, authenticated, service_role;
commit;
