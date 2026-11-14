begin;
create function private.caller_role() returns text language sql stable set search_path='' as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('role',true),'none'),session_user)
$$;
create function private.is_admin() returns boolean language sql stable set search_path='' as $$
  select private.caller_role()='authenticated' and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->'app_metadata'->>'app_role','')='admin'
$$;
create function private.assert_server() returns void language plpgsql set search_path='' as $$
begin
  if private.caller_role() not in ('postgres','supabase_admin','service_role') then raise exception 'SERVER_ONLY' using errcode='42501'; end if;
end$$;
create function private.assert_editor() returns void language plpgsql set search_path='' as $$
begin
  if not private.is_admin() and private.caller_role() not in ('postgres','supabase_admin','service_role') then raise exception 'EDITOR_ONLY' using errcode='42501'; end if;
end$$;
create function private.assert_initialized() returns void language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null) then raise exception 'LOCAL_PRODUCT_NOT_INITIALIZED'; end if;
end$$;
create function public.m0_bootstrap(p_bootstrap uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.runtime_identity;
begin
  perform private.assert_server();
  if p_bootstrap is null then raise exception 'BOOTSTRAP_ID_REQUIRED'; end if;
  select * into r from private.runtime_identity where singleton for update;
  if r.product_id<>'judoju-news' or r.environment<>'local' or r.bootstrap_id is not null and r.bootstrap_id<>p_bootstrap then raise exception 'PRODUCT_FINGERPRINT_MISMATCH'; end if;
  update private.runtime_identity set bootstrap_id=p_bootstrap where singleton;
  return jsonb_build_object('productId',r.product_id,'environment',r.environment,'bootstrapId',p_bootstrap,'schemaVersion',r.schema_version);
end$$;
create function public.m0_runtime_identity() returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.runtime_identity;
begin perform private.assert_server();select * into r from private.runtime_identity where singleton;
  return jsonb_build_object('productId',r.product_id,'environment',r.environment,'bootstrapId',r.bootstrap_id,'schemaVersion',r.schema_version);
end$$;

create function public.m0_pre_request() returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.set_config('lock_timeout','2s',true);
  perform pg_catalog.set_config('statement_timeout','5s',true);
  perform pg_catalog.set_config('idle_in_transaction_session_timeout','5s',true);
  perform pg_catalog.set_config('transaction_timeout','5s',true);
end$$;
alter role authenticator set pgrst.db_pre_request='public.m0_pre_request';
notify pgrst,'reload config';

-- Pure server visibility policy. Public client-supplied visible_sections is never trusted.
create function private.visible_sections(p_profile text,p_body jsonb,p_as_of timestamptz,p_now timestamptz) returns text[] language plpgsql immutable set search_path='' as $$
declare result text[]:=array['KEY_ISSUES','ISSUE_ANALYSIS']; positive_count integer;negative_count integer;
begin
  if p_profile not in ('POSITIVE_ONLY','POSITIVE_NEGATIVE','DAMAGE_ONLY','RELATED_CONDITIONAL') then raise exception 'UNKNOWN_IMPACT_PROFILE'; end if;
  if jsonb_typeof(p_body)<>'object' then raise exception 'BODY_OBJECT_REQUIRED'; end if;
  select count(*) filter(where x->>'direction'='POSITIVE'),count(*) filter(where x->>'direction'='NEGATIVE') into positive_count,negative_count from jsonb_array_elements(coalesce(p_body->'scenarios','[]')) x;
  if p_profile='DAMAGE_ONLY' then
    if jsonb_array_length(coalesce(p_body->'risks','[]'))=0 then raise exception 'DAMAGE_REQUIRES_RISKS'; end if;
    if positive_count+negative_count>0 then raise exception 'DAMAGE_ONLY_NO_SCENARIO'; end if;
  else
    if positive_count<1 or p_profile='POSITIVE_ONLY' and negative_count>0 or p_profile='POSITIVE_NEGATIVE' and negative_count<1 then raise exception 'SCENARIO_PROFILE_MISMATCH'; end if;
    result:=array_append(result,'SCENARIOS');
  end if;
  if jsonb_array_length(coalesce(p_body->'benefit_sector_ids','[]'))>0 then
    if p_profile in ('DAMAGE_ONLY','RELATED_CONDITIONAL') then raise exception 'BENEFIT_NOT_ESTABLISHED'; end if;
    result:=array_append(result,'BENEFIT_SECTORS');
  end if;
  if jsonb_array_length(coalesce(p_body->'damage_sector_ids','[]'))>0 then
    if p_profile in ('POSITIVE_ONLY','RELATED_CONDITIONAL') then raise exception 'DAMAGE_NOT_ESTABLISHED'; end if;
    result:=array_append(result,'DAMAGE_SECTORS');
  end if;
  if jsonb_array_length(coalesce(p_body->'related_sector_ids','[]'))>0 then result:=array_append(result,'RELATED_SECTORS'); end if;
  if p_profile='DAMAGE_ONLY' and not 'DAMAGE_SECTORS'=any(result) then raise exception 'DAMAGE_SECTOR_REQUIRED'; end if;
  if p_profile='RELATED_CONDITIONAL' and not 'RELATED_SECTORS'=any(result) then raise exception 'RELATED_SECTOR_REQUIRED'; end if;
  if jsonb_array_length(coalesce(p_body->'risks','[]'))>0 then result:=array_append(result,'RISKS'); end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_body->'schedule','[]')) x where (x->>'event_at')::timestamptz>greatest(p_as_of,p_now)) then result:=array_append(result,'SCHEDULE'); end if;
  return array_append(result,'SOURCES');
end$$;

create function private.public_body(p_body jsonb,p_sections text[],p_now timestamptz) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
  result:=jsonb_build_object('key_issues',coalesce(p_body->'key_issues','[]'),'issue_analysis',coalesce(p_body->'issue_analysis','""'),'sources',coalesce(p_body->'sources','[]'),'visible_sections',p_sections);
  if 'SCENARIOS'=any(p_sections) then result:=result||jsonb_build_object('scenarios',p_body->'scenarios');end if;
  if 'BENEFIT_SECTORS'=any(p_sections) then result:=result||jsonb_build_object('benefit_sector_ids',p_body->'benefit_sector_ids');end if;
  if 'DAMAGE_SECTORS'=any(p_sections) then result:=result||jsonb_build_object('damage_sector_ids',p_body->'damage_sector_ids');end if;
  if 'RELATED_SECTORS'=any(p_sections) then result:=result||jsonb_build_object('related_sector_ids',p_body->'related_sector_ids');end if;
  if 'RISKS'=any(p_sections) then result:=result||jsonb_build_object('risks',p_body->'risks');end if;
  if 'SCHEDULE'=any(p_sections) then result:=result||jsonb_build_object('schedule',(select jsonb_agg(x) from jsonb_array_elements(p_body->'schedule') x where (x->>'event_at')::timestamptz>p_now));end if;
  return result;
end$$;
create function private.sync_public_issue() returns trigger language plpgsql security definer set search_path='' as $$
declare v private.article_versions;
begin
  if new.publication_state='PUBLISHED' and new.current_version_id is not null then
    select * into strict v from private.article_versions where id=new.current_version_id and issue_id=new.id;
    insert into public.news_public(issue_id,version_id,publication_state,title,summary,body,first_published_at,material_change_at,sample_kind)
    values(new.id,v.id,new.publication_state,v.title,v.summary,private.public_body(v.public_body,v.visible_sections,now()),new.first_published_at,new.material_change_at,new.sample_kind)
    on conflict(issue_id) do update set version_id=excluded.version_id,publication_state=excluded.publication_state,title=excluded.title,summary=excluded.summary,body=excluded.body,first_published_at=excluded.first_published_at,material_change_at=excluded.material_change_at;
  else
    update public.news_public set publication_state=new.publication_state,title=null,summary=null,body=null where issue_id=new.id;
  end if;
  return new;
end$$;
create trigger issue_projection_sync after insert or update on private.issues for each row execute function private.sync_public_issue();

create function public.m0_publish(p_issue uuid,p_expected_revision bigint,p_title text,p_summary text,p_body jsonb,p_profile text,p_policy bigint,p_catalog bigint,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.issues;v_id uuid:=gen_random_uuid();sections text[];claim private.claims;independent_three boolean;sector uuid;request_hash text;
begin
  perform private.assert_editor();perform private.assert_initialized();
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  request_hash:=encode(extensions.digest(convert_to(jsonb_build_object('issue',p_issue,'expected_revision',p_expected_revision,'title',p_title,'summary',p_summary,'body',p_body,'profile',p_profile,'policy',p_policy,'catalog',p_catalog)::text,'UTF8'),'sha256'),'hex');
  select * into strict i from private.issues where id=p_issue for update;
  if exists(select 1 from private.outbox where effect_key=p_effect_key and issue_id=p_issue) then
    if not exists(select 1 from private.outbox where effect_key=p_effect_key and payload->>'request_hash'=request_hash) then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
    return jsonb_build_object('status','ALREADY_APPLIED','issue_id',i.id,'revision',i.revision,'version_id',i.current_version_id);
  end if;
  if exists(select 1 from private.outbox where effect_key=p_effect_key) then raise exception 'EFFECT_KEY_CONFLICT';end if;
  if i.revision<>p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if i.publication_state in ('HIDDEN','WITHDRAWN') then raise exception 'NO_AUTOMATIC_REPUBLISH';end if;
  if i.scheduled_publish_at is not null and i.scheduled_publish_at>now() then raise exception 'SCHEDULE_NOT_DUE';end if;
  if not exists(select 1 from private.policies where version=p_policy and active) or not exists(select 1 from private.catalog_versions where version=p_catalog and active) then raise exception 'STALE_POLICY_OR_CATALOG';end if;
  if i.sample_kind<>'SYNTHETIC' then raise exception 'REAL_PUBLICATION_NOT_ENABLED_STAGE_4';end if;
  if not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'SYNTHETIC_PUBLICATION_FORBIDDEN';end if;
  if i.primary_sector_id is not null and not exists(select 1 from private.sectors where id=i.primary_sector_id and active and catalog_version=p_catalog) then raise exception 'PRIMARY_SECTOR_INACTIVE';end if;
  if not exists(select 1 from private.claims where issue_id=i.id) then raise exception 'CLAIM_REQUIRED';end if;
  for claim in select * from private.claims where issue_id=i.id loop
    if not claim.verified or not claim.korea_path_verified or not claim.fact_current or claim.valid_until is not null and claim.valid_until<=now() or claim.claim_type='SENSITIVE_UNCONFIRMED' then raise exception 'CLAIM_NOT_VERIFIED';end if;
    if claim.claim_type='SYSTEMIC_MACRO' and not claim.official_original then
      select exists(select 1 from private.evidence_edges a join private.evidence_edges b on a.claim_id=b.claim_id and a.id<b.id join private.evidence_edges c on b.claim_id=c.claim_id and b.id<c.id
        where a.claim_id=claim.id
        and a.origin_verified and a.newsroom_verified and a.owner_group_verified and a.independent_fact_verified
        and b.origin_verified and b.newsroom_verified and b.owner_group_verified and b.independent_fact_verified
        and c.origin_verified and c.newsroom_verified and c.owner_group_verified and c.independent_fact_verified
        and a.origin_group_id<>b.origin_group_id and b.origin_group_id<>c.origin_group_id and a.origin_group_id<>c.origin_group_id
        and a.newsroom_id<>b.newsroom_id and b.newsroom_id<>c.newsroom_id and a.newsroom_id<>c.newsroom_id
        and a.owner_group_id<>b.owner_group_id and b.owner_group_id<>c.owner_group_id and a.owner_group_id<>c.owner_group_id
      ) into independent_three;
      if not independent_three then raise exception 'MACRO_INDEPENDENT_THREE_REQUIRED';end if;
    end if;
  end loop;
  sections:=private.visible_sections(p_profile,p_body,now(),now());
  for sector in select value::text::uuid from jsonb_array_elements_text(coalesce(p_body->'benefit_sector_ids','[]')||coalesce(p_body->'damage_sector_ids','[]')||coalesce(p_body->'related_sector_ids','[]')) loop
    if not exists(select 1 from private.sectors where id=sector and active and catalog_version=p_catalog) then raise exception 'IMPACT_SECTOR_INACTIVE';end if;
  end loop;
  insert into private.article_versions(id,issue_id,title,summary,public_body,source_market,selection_market_basis,analysis_perspective,impact_profile,visibility_policy_version,catalog_version,evidence_as_of,visible_sections)
  values(v_id,i.id,p_title,p_summary,p_body,coalesce(p_body->>'source_market','SYNTHETIC'),coalesce(p_body->>'selection_market_basis','KR'),'KR_EQUITY',p_profile,p_policy,p_catalog,now(),sections);
  insert into private.impacts(version_id,sector_id,direction,path_id,conditions)
    select v_id,x::uuid,'BENEFIT','SYNTHETIC', '[]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'benefit_sector_ids','[]')) x
    union all select v_id,x::uuid,'DAMAGE','SYNTHETIC','[]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'damage_sector_ids','[]')) x
    union all select v_id,x::uuid,'RELATED','SYNTHETIC','["조건부"]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'related_sector_ids','[]')) x;
  update private.issues set current_version_id=v_id,publication_state='PUBLISHED',first_published_at=coalesce(first_published_at,now()),material_change_at=now(),revision=revision+1 where id=i.id;
  insert into private.outbox(issue_id,version_id,event_type,effect_key,payload) values(i.id,v_id,'ISSUE_PUBLISHED',p_effect_key,jsonb_build_object('issue_id',i.id,'version_id',v_id,'sample_kind','SYNTHETIC','request_hash',request_hash));
  return jsonb_build_object('status','APPLIED','issue_id',i.id,'revision',i.revision+1,'version_id',v_id,'visible_sections',sections);
end$$;

create function public.m0_set_publication_state(p_issue uuid,p_expected_revision bigint,p_state text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.issues;
begin
  perform private.assert_editor();perform private.assert_initialized();
  if p_state not in ('CORRECTION_PENDING','WITHDRAWN','HIDDEN') then raise exception 'INVALID_TRANSITION';end if;
  select * into strict i from private.issues where id=p_issue for update;
  if i.revision<>p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  update private.issues set publication_state=p_state::private.publication_state,revision=revision+1 where id=i.id;
  return jsonb_build_object('issue_id',i.id,'state',p_state,'revision',i.revision+1);
end$$;
create function public.resolve_issue(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare canonical uuid:=p_issue;i private.issues;visited uuid[]:='{}';k integer;
begin
  for k in 1..16 loop
    if canonical=any(visited) then raise exception 'ALIAS_CYCLE';end if;visited:=array_append(visited,canonical);
    if not exists(select 1 from private.issue_aliases where alias_id=canonical) then exit;end if;
    select canonical_issue_id into canonical from private.issue_aliases where alias_id=canonical;
  end loop;
  select * into i from private.issues where id=canonical;
  if not found or i.publication_state='DRAFT' then return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');end if;
  return jsonb_build_object('canonical_issue_id',i.id,'state',i.publication_state,'message',case i.publication_state when 'PUBLISHED' then '공개된 글' when 'CORRECTION_PENDING' then '내용 확인 중 · 기존 내용 제공 중지' when 'WITHDRAWN' then '근거 확인 불가로 게시 중단' else '현재 제공하지 않는 글' end);
end$$;
create function public.get_public_article(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;p public.news_public;v private.article_versions;sections text[];
begin
  r:=public.resolve_issue(p_issue);
  if r->>'state'<>'PUBLISHED' then return r;end if;
  select * into p from public.news_public where issue_id=(r->>'canonical_issue_id')::uuid and publication_state='PUBLISHED';
  if not found then return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');end if;
  select * into strict v from private.article_versions where id=p.version_id and issue_id=p.issue_id;
  sections:=private.visible_sections(v.impact_profile,v.public_body,v.evidence_as_of,now());
  return jsonb_build_object('issue_id',p.issue_id,'version_id',p.version_id,'state',p.publication_state,'title',p.title,'summary',p.summary,'body',private.public_body(v.public_body,sections,now()),'first_published_at',p.first_published_at,'material_change_at',p.material_change_at,'sample_kind',p.sample_kind);
end$$;
create function public.m0_hold_for_timeout(p_seconds numeric) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.assert_server();perform private.assert_initialized();if p_seconds<0 or p_seconds>10 then raise exception 'INVALID_TEST_DELAY';end if;
  insert into private.audits(actor_id,action,entity_id) values('M0_TEST','TIMEOUT_PROBE','TEST');perform pg_catalog.pg_sleep(p_seconds);
  return jsonb_build_object('completed',true,'lock_timeout',current_setting('lock_timeout'),'statement_timeout',current_setting('statement_timeout'),'transaction_timeout',current_setting('transaction_timeout'));
end$$;

revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on function public.m0_bootstrap(uuid),public.m0_runtime_identity(),public.m0_hold_for_timeout(numeric) from public,anon,authenticated;
grant execute on function public.m0_bootstrap(uuid),public.m0_runtime_identity(),public.m0_hold_for_timeout(numeric) to service_role;
revoke execute on function public.m0_pre_request(),public.resolve_issue(uuid),public.get_public_article(uuid) from public;
grant execute on function public.m0_pre_request(),public.resolve_issue(uuid),public.get_public_article(uuid) to anon,authenticated,service_role;
revoke execute on function public.m0_publish(uuid,bigint,text,text,jsonb,text,bigint,bigint,text),public.m0_set_publication_state(uuid,bigint,text) from public,anon;
grant execute on function public.m0_publish(uuid,bigint,text,text,jsonb,text,bigint,bigint,text),public.m0_set_publication_state(uuid,bigint,text) to authenticated,service_role;
commit;
