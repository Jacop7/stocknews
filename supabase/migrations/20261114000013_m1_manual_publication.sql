begin;
create table private.editor_drafts (
  issue_id uuid primary key references private.issues(id), revision bigint not null default 0,
  content jsonb not null, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
alter table private.editor_drafts enable row level security;
revoke all on private.editor_drafts from public,anon,authenticated;
alter table private.impacts drop constraint impacts_pkey;
alter table private.impacts add primary key(version_id,sector_id,direction,path_id);

create function private.m1_assert_editor() returns void language plpgsql set search_path='' as $$
begin perform private.assert_initialized();if not private.is_admin() then raise exception 'EDITOR_ONLY' using errcode='42501';end if;end$$;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare b jsonb:=p_input;x jsonb;e uuid;sector uuid;path text;direction text;cd text;positive text[]:='{}';negative text[]:='{}';
  benefit jsonb:='[]';damage jsonb:='[]';related jsonb:='[]';all_sectors jsonb:='[]';impacts jsonb:='[]';scenarios jsonb;profile text;
  pos_count integer;neg_count integer;title text;valid boolean;seen text[]:='{}';key text;schedules jsonb:='[]';kind text;tz text;start_at timestamptz;end_at timestamptz;
begin
  if b is null or jsonb_typeof(b)<>'object' or pg_column_size(b)>131072 then raise exception 'INVALID_EDITOR_CONTENT';end if;
  if b ? 'scheduled_publish_at' or b ? 'sample_kind' and b->>'sample_kind'<>'SYNTHETIC' then raise exception 'RESERVATION_OR_REAL_MODE_NOT_ENABLED';end if;
  if not exists(select 1 from private.policies where version=p_policy and active) or not exists(select 1 from private.catalog_versions where version=p_catalog and active) then raise exception 'STALE_POLICY_OR_CATALOG';end if;
  if not exists(select 1 from private.issues where id=p_issue and sample_kind='SYNTHETIC') then raise exception 'SYNTHETIC_ISSUE_REQUIRED';end if;
  if length(trim(coalesce(b->>'title',''))) not between 1 and 200 or length(trim(coalesce(b->>'summary',''))) not between 1 and 1500
    or length(trim(coalesce(b->>'issue_analysis',''))) not between 1 and 20000 then raise exception 'CORE_TEXT_REQUIRED';end if;
  if coalesce(b->>'article_kind','') not in ('SECTOR','MACRO') or coalesce(b->>'source_market','') not in ('KR','US','GLOBAL','SYNTHETIC') or coalesce(b->>'selection_market_basis','') not in ('KR','FOREIGN_US') then raise exception 'ARTICLE_MARKET_REQUIRED';end if;
  if b ? 'analysis_perspective' and b->>'analysis_perspective'<>'KR_EQUITY' then raise exception 'KR_PERSPECTIVE_REQUIRED';end if;
  sector:=nullif(b->>'primary_sector_id','')::uuid;
  if b->>'article_kind'='SECTOR' and sector is null then raise exception 'PRIMARY_SECTOR_REQUIRED';end if;
  if sector is not null and not exists(select 1 from private.sectors where id=sector and active and catalog_version=p_catalog and sample_kind='SYNTHETIC') then raise exception 'PRIMARY_SECTOR_INACTIVE';end if;
  if jsonb_typeof(b->'key_issues') is distinct from 'array' or jsonb_array_length(b->'key_issues') not between 1 and 12 then raise exception 'KEY_ISSUES_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'key_issues') loop if jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 1000 then raise exception 'INVALID_KEY_ISSUE';end if;end loop;
  if jsonb_typeof(b->'sources') is distinct from 'array' or jsonb_array_length(b->'sources') not between 1 and 12 then raise exception 'SOURCES_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'sources') loop
    if length(trim(coalesce(x->>'name',''))) not between 1 and 100 or coalesce(x->>'url','')!~'^https://[a-z0-9.-]+\.invalid(/[^[:space:]]*)?$' or length(x->>'url')>2048 then raise exception 'SYNTHETIC_SOURCE_REQUIRED';end if;
  end loop;
  if jsonb_typeof(b->'impacts') is distinct from 'array' or jsonb_array_length(b->'impacts') not between 1 and 30 then raise exception 'KR_IMPACT_PATH_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'impacts') loop
    sector:=(x->>'sector_id')::uuid;path:=x->>'path_id';direction:=x->>'direction';cd:=coalesce(x->>'conditional_direction','NONE');
    if sector is null or not exists(select 1 from private.sectors where id=sector and active and catalog_version=p_catalog and sample_kind='SYNTHETIC') then raise exception 'IMPACT_SECTOR_INACTIVE';end if;
    if path is null or path!~'^[A-Za-z0-9_-]{1,80}$' or coalesce(direction,'') not in ('BENEFIT','DAMAGE','RELATED') or cd not in ('NONE','POSITIVE','NEGATIVE') or direction<>'RELATED' and cd<>'NONE' then raise exception 'INVALID_IMPACT_PATH';end if;
    key:=sector::text||':'||path;if key=any(seen) then raise exception 'DUPLICATE_SECTOR_PATH';end if;seen:=array_append(seen,key);
    if length(trim(coalesce(x->>'description',''))) not between 1 and 1500 then raise exception 'IMPACT_DESCRIPTION_REQUIRED';end if;
    if jsonb_typeof(x->'evidence_ids') is distinct from 'array' or jsonb_array_length(x->'evidence_ids') not between 1 and 10 then raise exception 'PATH_EVIDENCE_REQUIRED';end if;
    for e in select value::uuid from jsonb_array_elements_text(x->'evidence_ids') loop
      if e is null or not exists(select 1 from private.claims where id=e and issue_id=p_issue and verified and korea_path_verified and fact_current and sample_kind='SYNTHETIC' and claim_type<>'SENSITIVE_UNCONFIRMED' and (valid_until is null or valid_until>now())) then raise exception 'PATH_EVIDENCE_NOT_VERIFIED';end if;
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
end$$;

create function private.m1_schedule(p_items jsonb,p_now timestamptz) returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(case when x->>'kind'='EXACT' then jsonb_build_object('kind','EXACT','title',x->>'title','event_at',x->>'event_at','timezone',x->>'timezone')
    else jsonb_build_object('kind','PERIOD','title',x->>'title','period_label',x->>'period_label','date_note','정확한 날짜 미정','timezone',x->>'timezone') end),'[]')
  from jsonb_array_elements(coalesce(p_items,'[]')) x
  where x->>'status'='VERIFIED' and case when x->>'kind'='EXACT' then (x->>'event_at')::timestamptz>p_now when x->>'kind'='PERIOD' then (x->>'period_end')::timestamptz>p_now else false end
$$;
alter function private.visible_sections(text,jsonb,timestamptz,timestamptz) rename to m0_visible_sections;
create function private.visible_sections(p_profile text,p_body jsonb,p_as_of timestamptz,p_now timestamptz) returns text[] language plpgsql stable set search_path='' as $$
declare r text[]:=array['KEY_ISSUES','ISSUE_ANALYSIS'];
begin
  if p_body->>'_contract' is distinct from 'M1' then return private.m0_visible_sections(p_profile,p_body,p_as_of,p_now);end if;
  if p_profile is distinct from p_body->>'_profile' then raise exception 'SCENARIO_PATH_MISMATCH';end if;
  if jsonb_array_length(p_body->'_positive_paths')>0 then r:=array_append(r,'SCENARIOS');end if;
  if jsonb_array_length(p_body->'benefit_sector_ids')>0 then r:=array_append(r,'BENEFIT_SECTORS');end if;
  if jsonb_array_length(p_body->'damage_sector_ids')>0 then r:=array_append(r,'DAMAGE_SECTORS');end if;
  if jsonb_array_length(p_body->'related_sector_ids')>0 then r:=array_append(r,'RELATED_SECTORS');end if;
  if jsonb_array_length(p_body->'risks')>0 then r:=array_append(r,'RISKS');end if;
  if jsonb_array_length(private.m1_schedule(p_body->'schedule',greatest(p_as_of,p_now)))>0 then r:=array_append(r,'SCHEDULE');end if;
  return array_append(r,'SOURCES');
end$$;
alter function private.public_body(jsonb,text[],timestamptz) rename to m0_public_body;
create function private.public_body(p_body jsonb,p_sections text[],p_now timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb;impact jsonb;items jsonb:='[]';name text;
begin
  if p_body->>'_contract' is distinct from 'M1' then return private.m0_public_body(p_body,p_sections,p_now);end if;
  r:=jsonb_build_object('key_issues',p_body->'key_issues','issue_analysis',p_body->>'issue_analysis','sources',p_body->'sources','visible_sections',p_sections,
    'source_market',p_body->>'source_market','selection_market_basis',p_body->>'selection_market_basis','analysis_perspective','KR_EQUITY','impact_profile',p_body->>'_profile','article_kind',p_body->>'article_kind');
  for impact in select value from jsonb_array_elements(p_body->'impacts') loop
    select s.name into name from private.sectors s where s.id=(impact->>'sector_id')::uuid and s.active;
    if found then items:=items||jsonb_build_array(jsonb_build_object('sector_id',impact->>'sector_id','sector_name',name,'path_id',impact->>'path_id','direction',impact->>'direction','conditional_direction',impact->>'conditional_direction','description',impact->>'description','conditions',impact->'conditions'));end if;
  end loop;
  r:=r||jsonb_build_object('impacts',items);
  if 'SCENARIOS'=any(p_sections) then r:=r||jsonb_build_object('scenarios',p_body->'scenarios');end if;
  if 'RISKS'=any(p_sections) then r:=r||jsonb_build_object('risks',p_body->'risks');end if;
  if 'SCHEDULE'=any(p_sections) then r:=r||jsonb_build_object('schedule',private.m1_schedule(p_body->'schedule',p_now));end if;
  return r;
end$$;

-- The old endpoint is retained for explicit M0 service fixtures, never an alternate editor protocol.
alter function public.m0_publish(uuid,bigint,text,text,jsonb,text,bigint,bigint,text) rename to m0_publish_legacy;
alter function public.m0_publish_legacy(uuid,bigint,text,text,jsonb,text,bigint,bigint,text) set schema private;
create function public.m0_publish(p_issue uuid,p_expected_revision bigint,p_title text,p_summary text,p_body jsonb,p_profile text,p_policy bigint,p_catalog bigint,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.assert_editor();if private.caller_role()='authenticated' then raise exception 'M1_EDITOR_RPC_REQUIRED' using errcode='42501';end if;
return private.m0_publish_legacy(p_issue,p_expected_revision,p_title,p_summary,p_body,p_profile,p_policy,p_catalog,p_effect_key);end$$;
grant execute on function public.m0_publish(uuid,bigint,text,text,jsonb,text,bigint,bigint,text) to authenticated,service_role;

create function public.m1_create_draft(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare story uuid;issue uuid;claim uuid;content jsonb;
begin perform private.m1_assert_editor();if p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
  insert into private.stories(event_key) values('M1:'||p_request::text) on conflict(event_key) do nothing;
  select id into strict story from private.stories where event_key='M1:'||p_request::text for update;
  select id into issue from private.issues where story_id=story and angle_key='MANUAL';
  if issue is null then
    insert into private.issues(story_id,angle_key,sample_kind,manual_protected) values(story,'MANUAL','SYNTHETIC',true) returning id into issue;
    insert into private.claims(issue_id,claim_type,korea_path_verified,fact_current,official_original,verified,sample_kind) values(issue,'ORDINARY_FACT',true,true,true,true,'SYNTHETIC') returning id into claim;
    content:=jsonb_build_object('title','','summary','','article_kind','SECTOR','primary_sector_id',null,'source_market','US','selection_market_basis','FOREIGN_US','analysis_perspective','KR_EQUITY','key_issues','[]'::jsonb,'issue_analysis','','sources',jsonb_build_array(jsonb_build_object('name','SYNTHETIC 검증 근거','url','https://example.invalid/manual')),'impacts','[]'::jsonb,'scenarios','[]'::jsonb,'risks','[]'::jsonb,'schedule','[]'::jsonb);
    insert into private.editor_drafts(issue_id,content,updated_by) values(issue,content,auth.uid());
  end if;
  return jsonb_build_object('issue_id',issue);
end$$;
create function public.m1_get_draft(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return(select jsonb_build_object('issue_id',i.id,'issue_revision',i.revision,'state',i.publication_state,'draft_revision',d.revision,'content',d.content,'claim_id',(select c.id from private.claims c where c.issue_id=i.id order by c.id limit 1),'policy_version',(select version from private.policies where active),'catalog_version',(select version from private.catalog_versions where active)) from private.issues i join private.editor_drafts d on d.issue_id=i.id where i.id=p_issue);end$$;
create function public.m1_save_draft(p_issue uuid,p_expected_revision bigint,p_content jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.editor_drafts;
begin perform private.m1_assert_editor();
  if p_content is null or jsonb_typeof(p_content)<>'object' or pg_column_size(p_content)>131072 or p_content ? 'scheduled_publish_at' then raise exception 'INVALID_DRAFT_OR_RESERVATION';end if;
  select * into strict d from private.editor_drafts where issue_id=p_issue for update;
  if d.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  update private.editor_drafts set content=p_content,revision=revision+1,updated_at=now(),updated_by=auth.uid() where issue_id=p_issue;
  update private.issues set manual_protected=true where id=p_issue;
  insert into private.audits(actor_id,action,entity_id) values(auth.uid()::text,'MANUAL_DRAFT_SAVE',p_issue::text);
  return jsonb_build_object('draft_revision',d.revision+1);
end$$;
create function public.m1_preview_draft(p_issue uuid,p_expected_revision bigint,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.editor_drafts;b jsonb;sections text[];
begin perform private.m1_assert_editor();select * into strict d from private.editor_drafts where issue_id=p_issue;
  if d.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  b:=private.m1_prepare(p_issue,d.content,p_policy,p_catalog);sections:=private.visible_sections(b->>'_profile',b,now(),now());
  return jsonb_build_object('title',b->>'title','summary',b->>'summary','body',private.public_body(b,sections,now()),'sample_kind','SYNTHETIC');
end$$;
create function public.m1_publish_draft(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.editor_drafts;b jsonb;result jsonb;i private.issues;request_hash text;prior private.outbox;
begin perform private.m1_assert_editor();
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  select * into strict i from private.issues where id=p_issue for update;select * into strict d from private.editor_drafts where issue_id=p_issue for update;
  request_hash:=encode(extensions.digest(convert_to(jsonb_build_object('issue',p_issue,'draft_revision',p_expected_revision,'issue_revision',p_issue_revision,'policy',p_policy,'catalog',p_catalog)::text,'UTF8'),'sha256'),'hex');
  select * into prior from private.outbox where effect_key=p_effect_key;
  if found then
    if prior.issue_id is distinct from p_issue or prior.payload->>'editor_request_hash' is distinct from request_hash then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
    return jsonb_build_object('status','ALREADY_APPLIED','issue_id',i.id,'revision',i.revision,'version_id',prior.version_id);
  end if;
  if d.revision is distinct from p_expected_revision or i.revision is distinct from p_issue_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if i.scheduled_publish_at is not null then raise exception 'RESERVATION_NOT_ENABLED';end if;
  b:=private.m1_prepare(p_issue,d.content,p_policy,p_catalog);
  update private.issues set primary_sector_id=nullif(b->>'primary_sector_id','')::uuid,manual_protected=true where id=p_issue;
  result:=private.m0_publish_legacy(p_issue,p_issue_revision,b->>'title',b->>'summary',b,b->>'_profile',p_policy,p_catalog,p_effect_key);
  -- Replace M0's synthetic placeholder paths with the verified per-path input.
  delete from private.impacts where version_id=(result->>'version_id')::uuid;
  insert into private.impacts(version_id,sector_id,direction,path_id,conditions,evidence_ids)
    select (result->>'version_id')::uuid,(x->>'sector_id')::uuid,x->>'direction',x->>'path_id',x->'conditions',array(select value::uuid from jsonb_array_elements_text(x->'evidence_ids')) from jsonb_array_elements(b->'impacts') x;
  update private.outbox set payload=payload||jsonb_build_object('editor_request_hash',request_hash,'editor_draft_revision',d.revision) where effect_key=p_effect_key;
  insert into private.audits(actor_id,action,entity_id) values(auth.uid()::text,'MANUAL_PUBLISH',p_issue::text);
  return result;
end$$;
create function public.m1_set_state(p_issue uuid,p_expected_revision bigint,p_state text,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;h text;prior private.outbox;
begin perform private.m1_assert_editor();
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  perform 1 from private.issues where id=p_issue for update;
  h:=encode(extensions.digest(convert_to(jsonb_build_object('issue',p_issue,'revision',p_expected_revision,'state',p_state)::text,'UTF8'),'sha256'),'hex');
  select * into prior from private.outbox where effect_key=p_effect_key;
  if found then if prior.issue_id is distinct from p_issue or prior.payload->>'editor_request_hash' is distinct from h then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;return jsonb_build_object('status','ALREADY_APPLIED');end if;
  r:=public.m0_set_publication_state(p_issue,p_expected_revision,p_state);
  insert into private.outbox(issue_id,event_type,effect_key,payload) values(p_issue,'ISSUE_'||p_state,p_effect_key,jsonb_build_object('issue_id',p_issue,'sample_kind','SYNTHETIC','editor_request_hash',h));
  insert into private.audits(actor_id,action,entity_id) values(auth.uid()::text,'MANUAL_'||p_state,p_issue::text);return r;
end$$;
create function public.m1_editor_catalog() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description) order by display_order,id) from private.sectors where active and sample_kind='SYNTHETIC' and name not like 'SYNTHETIC M0%'),'[]');end$$;
create function public.m1_editor_articles() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(row_to_json(t)) from(select i.id,i.publication_state,i.revision,d.revision draft_revision,d.content->>'title' title,d.updated_at from private.issues i join private.editor_drafts d on d.issue_id=i.id order by d.updated_at desc limit 100)t),'[]');end$$;
create function public.m1_public_catalog() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description) order by display_order,id),'[]') from private.sectors where active and sample_kind='SYNTHETIC' and name in ('반도체 후공정/패키징','전력','원자력 SMR')
$$;
create function public.m1_public_articles(p_sector uuid default null,p_limit integer default 20,p_cursor timestamptz default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_PAGE_SIZE';end if;
  return coalesce((select jsonb_agg(row_to_json(t)) from(
    select n.issue_id,n.version_id,n.title,n.summary,n.first_published_at,n.material_change_at,n.sample_kind,v.public_body->>'article_kind' article_kind,s.name sector_name
    from public.news_public n join private.issues i on i.id=n.issue_id join private.article_versions v on v.id=n.version_id
    left join private.sectors s on s.id=i.primary_sector_id and s.active
    where n.publication_state='PUBLISHED' and n.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1'
      and (p_sector is null or exists(select 1 from private.impacts z where z.version_id=v.id and z.sector_id=p_sector))
      and (p_cursor is null or n.first_published_at<p_cursor)
    order by n.first_published_at desc,n.issue_id limit p_limit
  )t),'[]');
end$$;
grant execute on function public.m1_create_draft(uuid),public.m1_get_draft(uuid),public.m1_save_draft(uuid,bigint,jsonb),public.m1_preview_draft(uuid,bigint,bigint,bigint),public.m1_publish_draft(uuid,bigint,bigint,bigint,bigint,text),public.m1_set_state(uuid,bigint,text,text),public.m1_editor_catalog(),public.m1_editor_articles() to authenticated;
grant execute on function public.m1_public_catalog(),public.m1_public_articles(uuid,integer,timestamptz) to anon,authenticated;
notify pgrst,'reload schema';
commit;
