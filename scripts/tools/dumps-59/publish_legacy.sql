CREATE OR REPLACE FUNCTION private.m0_publish_legacy(p_issue uuid, p_expected_revision bigint, p_title text, p_summary text, p_body jsonb, p_profile text, p_policy bigint, p_catalog bigint, p_effect_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if i.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
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
end$function$

