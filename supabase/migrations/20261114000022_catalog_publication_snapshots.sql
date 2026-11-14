begin;
-- Copy of original13 prepare with only its two sector predicates replaced. Original SHA 47d2bcfacc550160a1deb8ee2835f8b2c2092d639cd50f45c7f3c62b33e29235
create or replace function private.m1_prepare_v1(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
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
  if sector is not null and not private.catalog_sector_selectable(sector,p_catalog,'SYNTHETIC') then raise exception 'PRIMARY_SECTOR_INACTIVE';end if;
  if jsonb_typeof(b->'key_issues') is distinct from 'array' or jsonb_array_length(b->'key_issues') not between 1 and 12 then raise exception 'KEY_ISSUES_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'key_issues') loop if jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 1000 then raise exception 'INVALID_KEY_ISSUE';end if;end loop;
  if jsonb_typeof(b->'sources') is distinct from 'array' or jsonb_array_length(b->'sources') not between 1 and 12 then raise exception 'SOURCES_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'sources') loop
    if length(trim(coalesce(x->>'name',''))) not between 1 and 100 or coalesce(x->>'url','')!~'^https://[a-z0-9.-]+\.invalid(/[^[:space:]]*)?$' or length(x->>'url')>2048 then raise exception 'SYNTHETIC_SOURCE_REQUIRED';end if;
  end loop;
  if jsonb_typeof(b->'impacts') is distinct from 'array' or jsonb_array_length(b->'impacts') not between 1 and 30 then raise exception 'KR_IMPACT_PATH_REQUIRED';end if;
  for x in select value from jsonb_array_elements(b->'impacts') loop
    sector:=(x->>'sector_id')::uuid;path:=x->>'path_id';direction:=x->>'direction';cd:=coalesce(x->>'conditional_direction','NONE');
    if sector is null or not private.catalog_sector_selectable(sector,p_catalog,'SYNTHETIC') then raise exception 'IMPACT_SECTOR_INACTIVE';end if;
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

-- Keep historical approved snapshots separate from current metadata/head.
create or replace function private.catalog_version_sector_allowed(p_catalog bigint,p_sector uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.catalog_approvals a
 join private.catalog_version_sectors m on m.version=a.version and m.sector_id=p_sector and m.active and m.catalog_kind='LEAF'
 join private.sectors s on s.id=m.sector_id and s.active and s.catalog_kind='LEAF' and s.metadata_kind=m.metadata_kind
 where a.version=p_catalog and a.state='APPROVED')
$$;
create or replace function private.m1_current_evidence(p_issue uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id
 where i.id=p_issue and i.publication_state='PUBLISHED' and i.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1'
 and exists(select 1 from private.policies p where p.version=v.visibility_policy_version and p.active)
 and exists(select 1 from private.catalog_approvals a where a.version=v.catalog_version and a.state='APPROVED')
 and exists(select 1 from private.impacts z where z.version_id=v.id)
 and not exists(select 1 from private.claims c where c.issue_id=i.id and (not c.verified or not c.fact_current or not c.korea_path_verified or c.claim_type='SENSITIVE_UNCONFIRMED' or c.valid_until<=now()))
 and (i.primary_sector_id is null or private.catalog_version_sector_allowed(v.catalog_version,i.primary_sector_id))
 and not exists(select 1 from private.impacts z where z.version_id=v.id and not private.catalog_version_sector_allowed(v.catalog_version,z.sector_id))
 and not exists(select 1 from private.impacts z where z.version_id=v.id and cardinality(z.evidence_ids)=0)
 and not exists(select 1 from private.impacts z cross join lateral unnest(z.evidence_ids) e(id)
 left join private.claims c on c.id=e.id and c.issue_id=i.id
 where z.version_id=v.id and (c.id is null or not c.verified or not c.fact_current or not c.korea_path_verified or c.valid_until<=now()))
 and private.m1_core_evidence(i.id,v.public_body->>'article_kind'))
$$;
-- Catalog mutation takes the head lock first, then affected issue locks in ID order.
-- All M1 publications share this head lock before taking an issue lock.
create or replace function public.m1_publish_draft(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.m1_assert_editor();perform 1 from private.catalog_head where singleton for share;
 perform 1 from private.issues where id=p_issue for update;
 return private.m1_publish_draft_v1(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key);
end$$;
notify pgrst,'reload schema';
commit;
