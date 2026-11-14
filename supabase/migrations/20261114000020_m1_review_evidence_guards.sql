begin;
create function private.m1_independent_three(p_claim uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.evidence_edges a
 join private.evidence_edges b on a.claim_id=b.claim_id and a.id<b.id
 join private.evidence_edges c on b.claim_id=c.claim_id and b.id<c.id
 where a.claim_id=p_claim
 and a.origin_verified and a.newsroom_verified and a.owner_group_verified and a.independent_fact_verified
 and b.origin_verified and b.newsroom_verified and b.owner_group_verified and b.independent_fact_verified
 and c.origin_verified and c.newsroom_verified and c.owner_group_verified and c.independent_fact_verified
 and a.origin_group_id<>b.origin_group_id and b.origin_group_id<>c.origin_group_id and a.origin_group_id<>c.origin_group_id
 and a.newsroom_id<>b.newsroom_id and b.newsroom_id<>c.newsroom_id and a.newsroom_id<>c.newsroom_id
 and a.owner_group_id<>b.owner_group_id and b.owner_group_id<>c.owner_group_id and a.owner_group_id<>c.owner_group_id)
$$;
create function private.m1_claim_allowed(p_claim uuid,p_issue uuid,p_macro boolean,p_official boolean) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.claims c where c.id=p_claim and c.issue_id=p_issue
 and c.verified and c.fact_current and c.korea_path_verified and c.claim_type<>'SENSITIVE_UNCONFIRMED'
 and (c.valid_until is null or c.valid_until>now())
 and (not p_official or c.official_original)
 and (not(p_macro or c.claim_type='SYSTEMIC_MACRO') or c.official_original or private.m1_independent_three(c.id)))
$$;
create function private.m1_core_evidence(p_issue uuid,p_kind text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.claims where issue_id=p_issue)
 and not exists(select 1 from private.claims c where c.issue_id=p_issue and not private.m1_claim_allowed(c.id,p_issue,p_kind='MACRO',false))
$$;
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v4;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
begin
 if not private.m1_core_evidence(p_issue,coalesce(p_input->>'article_kind','')) then raise exception 'CLAIM_NOT_VERIFIED';end if;
 return private.m1_prepare_v4(p_issue,p_input,p_policy,p_catalog)||jsonb_build_object('_issue_id',p_issue);
end$$;
-- Publishing must never promote or downgrade an existing claim's classification.
create or replace function public.m1_publish_draft(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();perform 1 from private.issues where id=p_issue for update;
 return private.m1_publish_draft_v1(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key);
end$$;
alter function private.m1_current_evidence(uuid) rename to m1_current_evidence_v2;
create function private.m1_current_evidence(p_issue uuid) returns boolean language sql stable set search_path='' as $$
 select private.m1_current_evidence_v2(p_issue) and exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id
 where i.id=p_issue and private.m1_core_evidence(i.id,v.public_body->>'article_kind'))
$$;
create function private.m1_body_issue(p_body jsonb) returns uuid language sql stable set search_path='' as $$
 select coalesce(nullif(p_body->>'_issue_id','')::uuid,(select c.issue_id from jsonb_array_elements(coalesce(p_body->'impacts','[]')) x
 cross join lateral jsonb_array_elements_text(coalesce(x->'evidence_ids','[]')) e(id)
 join private.claims c on c.id=e.id::uuid limit 1))
$$;
create function private.m1_live_schedule(p_body jsonb,p_now timestamptz) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(case when x->>'kind'='EXACT' then jsonb_build_object('kind','EXACT','title',x->>'title','event_at',x->>'event_at','timezone',x->>'timezone')
 else jsonb_strip_nulls(jsonb_build_object('kind','PERIOD','title',x->>'title','period_label',x->>'period_label','date_note',case when x->>'precision'='DATE_RANGE' then null else '정확한 날짜 미정' end,'timezone',x->>'timezone')) end),'[]')
 from jsonb_array_elements(coalesce(p_body->'schedule','[]')) x
 where case when x->>'status'<>'VERIFIED' then false
 when x->>'kind'='EXACT' then (x->>'event_at')::timestamptz>p_now
 when x->>'kind'='PERIOD' then (x->>'period_end')::timestamptz>p_now else false end
 and jsonb_array_length(coalesce(x->'evidence_ids','[]'))>0
 and not exists(select 1 from jsonb_array_elements_text(x->'evidence_ids') e(id)
 where not private.m1_claim_allowed(e.id::uuid,private.m1_body_issue(p_body),false,true))
$$;
create or replace function private.visible_sections(p_profile text,p_body jsonb,p_as_of timestamptz,p_now timestamptz) returns text[] language plpgsql stable set search_path='' as $$
declare r text[]:=array['KEY_ISSUES','ISSUE_ANALYSIS'];
begin
 if p_body->>'_contract' is distinct from 'M1' then return private.m0_visible_sections(p_profile,p_body,p_as_of,p_now);end if;
 if p_profile is distinct from p_body->>'_profile' then raise exception 'SCENARIO_PATH_MISMATCH';end if;
 if jsonb_array_length(p_body->'_positive_paths')>0 then r:=array_append(r,'SCENARIOS');end if;
 if jsonb_array_length(p_body->'benefit_sector_ids')>0 then r:=array_append(r,'BENEFIT_SECTORS');end if;
 if jsonb_array_length(p_body->'damage_sector_ids')>0 then r:=array_append(r,'DAMAGE_SECTORS');end if;
 if jsonb_array_length(p_body->'related_sector_ids')>0 then r:=array_append(r,'RELATED_SECTORS');end if;
 if jsonb_array_length(p_body->'risks')>0 then r:=array_append(r,'RISKS');end if;
 if jsonb_array_length(private.m1_live_schedule(p_body,greatest(p_as_of,p_now)))>0 then r:=array_append(r,'SCHEDULE');end if;
 return array_append(r,'SOURCES');
end$$;
create or replace function private.public_body(p_body jsonb,p_sections text[],p_now timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb;impact jsonb;items jsonb:='[]';name text;
begin
 if p_body->>'_contract' is distinct from 'M1' then return private.m0_public_body(p_body,p_sections,p_now);end if;
 r:=jsonb_build_object('key_issues',p_body->'key_issues','issue_analysis',p_body->>'issue_analysis',
 'sources',(select coalesce(jsonb_agg(jsonb_build_object('name',x->>'name','url',x->>'url')),'[]') from jsonb_array_elements(p_body->'sources') x),
 'visible_sections',p_sections,'source_market',p_body->>'source_market','selection_market_basis',p_body->>'selection_market_basis','analysis_perspective','KR_EQUITY','impact_profile',p_body->>'_profile','article_kind',p_body->>'article_kind');
 for impact in select value from jsonb_array_elements(p_body->'impacts') loop
  select s.name into name from private.sectors s where s.id=(impact->>'sector_id')::uuid and s.active;
  if found then items:=items||jsonb_build_array(jsonb_build_object('sector_id',impact->>'sector_id','sector_name',name,'path_id',impact->>'path_id','direction',impact->>'direction','conditional_direction',impact->>'conditional_direction','description',impact->>'description','conditions',impact->'conditions'));end if;
 end loop;
 r:=r||jsonb_build_object('impacts',items);
 if 'SCENARIOS'=any(p_sections) then r:=r||jsonb_build_object('scenarios',(select jsonb_agg(jsonb_build_object('direction',x->>'direction','title',x->>'title','expected_result',x->>'expected_result','checks',x->'checks','path_ids',x->'path_ids')) from jsonb_array_elements(p_body->'scenarios') x));end if;
 if 'RISKS'=any(p_sections) then r:=r||jsonb_build_object('risks',p_body->'risks');end if;
 if 'SCHEDULE'=any(p_sections) then r:=r||jsonb_build_object('schedule',private.m1_live_schedule(p_body,p_now));end if;
 return r;
end$$;
create function public.m1_operation_status(p_issue uuid,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.outbox;
begin perform private.m1_assert_editor();
 if p_issue is null or p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'INVALID_OPERATION_KEY';end if;
 select * into o from private.outbox where issue_id=p_issue and effect_key=p_effect_key;
 if found then return jsonb_build_object('state','APPLIED','event_type',o.event_type,'version_id',o.version_id);end if;
 -- Absence is not proof that an uncertain request cannot still arrive.
 return jsonb_build_object('state','UNKNOWN');
end$$;
grant execute on function public.m1_operation_status(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
