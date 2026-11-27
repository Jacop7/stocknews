begin;
-- Publish stage 1B (docs/publish-stage1b-plan.md rev 3.1, Codex plan APPROVE 2026-11-27): local real-data publishing
-- and the review read mode. B1 the public-kind switch, B2 the public read paths (generated), B3 the real publisher
-- (generated), B4 withdrawal and expiry of published real articles, B7 admin fields. Exactly one kind is public at a time.

-- B1. Public-kind switch: off by default; like `enabled`, only postgres can change it and only on a local environment.
alter table private.real_mode add column public_read_enabled boolean not null default false;

create or replace function private.real_mode_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>1 then raise exception 'REAL_MODE_SINGLETON';end if;
  if new.enabled and not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'REAL_MODE_LOCAL_ONLY_1A';end if;
  if new.public_read_enabled and not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'REAL_PUBLIC_READ_LOCAL_ONLY_1B';end if;
  if cardinality(new.allowed_source_hosts) not between 1 and 20
    or exists(select 1 from unnest(new.allowed_source_hosts) h where h is null or h!~'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or length(h)>253) then raise exception 'REAL_MODE_HOSTS_INVALID';end if;
  new.changed_at:=now();
  return new;
end$$;

-- The one kind every public read returns. Real articles are public only while real mode itself is on (local only).
create function private.public_read_kind() returns private.sample_kind language sql stable set search_path='' as $$
  select case when private.real_mode_on() and exists(select 1 from private.real_mode where id=1 and public_read_enabled)
    then 'PERMITTED_REAL'::private.sample_kind else 'SYNTHETIC'::private.sample_kind end
$$;

-- The public identity says which kind is public, so a reader for one kind refuses to serve the other.
create or replace function public.m1_public_identity() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('productId',product_id,'environment',environment,
    'sampleKind',case when private.public_read_kind()='PERMITTED_REAL' then 'REVIEW_REAL' else 'SYNTHETIC' end,'bootstrapId',bootstrap_id,
    'contract',case when private.public_read_kind()='PERMITTED_REAL' then 'M1R' else 'M1' end)
  from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null
$$;

-- B2. Public read paths (generated from the live definitions by scripts/tools/gen-migration-59.mjs).
CREATE OR REPLACE FUNCTION private.m1_current_evidence_v3(p_issue uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id
 where i.id=p_issue and i.publication_state='PUBLISHED' and i.sample_kind=private.public_read_kind() and v.public_body->>'_contract'='M1'
 and exists(select 1 from private.policies p where p.version=v.visibility_policy_version and p.active)
 and exists(select 1 from private.catalog_approvals a where a.version=v.catalog_version and a.state='APPROVED')
 and (exists(select 1 from private.impacts z where z.version_id=v.id) or i.sample_kind='PERMITTED_REAL' and v.public_body->>'article_kind'='COMPANY')
 and not exists(select 1 from private.claims c where c.issue_id=i.id and (not c.verified or not c.fact_current or not c.korea_path_verified or c.claim_type='SENSITIVE_UNCONFIRMED' or c.valid_until<=now()))
 and (i.primary_sector_id is null or private.catalog_version_sector_allowed(v.catalog_version,i.primary_sector_id))
 and not exists(select 1 from private.impacts z where z.version_id=v.id and not private.catalog_version_sector_allowed(v.catalog_version,z.sector_id))
 and not exists(select 1 from private.impacts z where z.version_id=v.id and cardinality(z.evidence_ids)=0)
 and not exists(select 1 from private.impacts z cross join lateral unnest(z.evidence_ids) e(id)
 left join private.claims c on c.id=e.id and c.issue_id=i.id
 where z.version_id=v.id and (c.id is null or not c.verified or not c.fact_current or not c.korea_path_verified or c.valid_until<=now()))
 and private.m1_core_evidence(i.id,v.public_body->>'article_kind'))
$function$;

CREATE OR REPLACE FUNCTION private.m1_current_evidence(p_issue uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists(select 1 from private.issues where id=p_issue and sample_kind=private.public_read_kind()) and private.m1_current_evidence_v3(p_issue)
$function$;

CREATE OR REPLACE FUNCTION public.is_news_visible(p_issue uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=p_issue and i.publication_state='PUBLISHED'
   and i.sample_kind=private.public_read_kind()
   and (v.public_body->>'_contract' is distinct from 'M1' or private.m1_current_evidence(i.id)))
$function$;

CREATE OR REPLACE FUNCTION private.m0_get_public_article_legacy(p_issue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  r:=private.m0_get_public_article_legacy_v1(p_issue);
  if r ? 'issue_id' and not exists(select 1 from private.issues where id=(r->>'issue_id')::uuid and sample_kind=private.public_read_kind()) then
    return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
  end if;
  return r;
end$function$;

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
  if not found or i.publication_state='DRAFT' or i.sample_kind<>private.public_read_kind() then return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');end if;
  return jsonb_build_object('canonical_issue_id',i.id,'state',i.publication_state,'message',case i.publication_state when 'PUBLISHED' then '공개된 글' when 'CORRECTION_PENDING' then '내용 확인 중 · 기존 내용 제공 중지' when 'WITHDRAWN' then '근거 확인 불가로 게시 중단' else '현재 제공하지 않는 글' end);
end$function$;

CREATE OR REPLACE FUNCTION public.catalog_public_search_news(p_expected bigint, p_query text, p_limit integer DEFAULT 20, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_last_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_last_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare head bigint;words text[];cutoff timestamptz;items jsonb;last_item jsonb;
begin
 head:=private.catalog_require_reference_head(p_expected);words:=private.search_tokens(p_query);cutoff:=coalesce(p_as_of,statement_timestamp());
 if p_limit is null or p_limit not between 1 and 20 or cutoff>statement_timestamp()+interval '5 seconds' or cutoff<'2000-01-01T00:00:00Z'::timestamptz
 or (p_last_time is null)<>(p_last_id is null) or p_last_time>cutoff then raise exception 'INVALID_CURSOR_CONTEXT';end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.first_published_at desc,page.issue_id),'[]') into items from(
  select n.issue_id,n.version_id,n.title,n.summary,n.first_published_at,n.material_change_at,n.sample_kind,v.public_body->>'article_kind' article_kind,s.id sector_id,s.name sector_name,
   coalesce(s.metadata_kind='SYNTHETIC_FIXTURE',false) legacy_sector
  from public.news_public n join private.issues i on i.id=n.issue_id and i.current_version_id=n.version_id
  join private.article_versions v on v.id=n.version_id left join private.sectors s on s.id=i.primary_sector_id and s.active
  where n.publication_state='PUBLISHED' and n.sample_kind=private.public_read_kind() and i.sample_kind=private.public_read_kind() and v.public_body->>'_contract'='M1' and v.public_body->>'article_kind' is distinct from 'COMPANY'
   and not exists(select 1 from private.issue_aliases a where a.alias_id=n.issue_id) and private.m1_current_evidence(n.issue_id)
   and n.first_published_at<=cutoff and v.created_at<=cutoff
   and (p_last_time is null or n.first_published_at<p_last_time or n.first_published_at=p_last_time and n.issue_id>p_last_id)
   and private.search_contains_all(concat_ws(' ',n.title,n.summary,v.public_body->>'issue_analysis',
    (select string_agg(value,' ') from jsonb_array_elements_text(v.public_body->'key_issues')),
    (select string_agg(coalesce(kw->>'raw',kw->>'value'),' ') from private.catalog_sector_data d cross join lateral jsonb_array_elements(d.keywords)kw
     where private.catalog_sector_selectable(d.sector_id,head,'SYNTHETIC') and (d.sector_id=i.primary_sector_id or exists(select 1 from private.impacts z where z.version_id=v.id and z.sector_id=d.sector_id)))),words)
  order by n.first_published_at desc,n.issue_id limit p_limit+1)page;
 if jsonb_array_length(items)>p_limit then items:=items-p_limit;last_item:=items->(p_limit-1);end if;
 return jsonb_build_object('catalog_version',head::text,'as_of',cutoff,'items',items,'next',case when last_item is null then null else jsonb_build_object('last_time',last_item->'first_published_at','last_id',last_item->'issue_id') end);
end$function$;

CREATE OR REPLACE FUNCTION public.catalog_public_saved(p_expected bigint, p_issues uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare head bigint;requested uuid;r jsonb;card jsonb;canonical uuid;items jsonb:='[]';
begin
 head:=private.catalog_require_reference_head(p_expected);
 if p_issues is null or cardinality(p_issues)>20 or array_position(p_issues,null) is not null or cardinality(p_issues)<>(select count(distinct id)from unnest(p_issues)id) then raise exception 'INVALID_SAVED_IDS';end if;
 foreach requested in array p_issues loop
  begin
   r:=public.resolve_issue(requested);canonical:=(r->>'canonical_issue_id')::uuid;card:=null;
   if r->>'state'='PUBLISHED' then
    if not exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=canonical and i.sample_kind=private.public_read_kind() and v.public_body->>'_contract'='M1') then
     r:=jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
    elsif not private.m1_current_evidence(canonical) then
     r:=jsonb_build_object('state','CORRECTION_PENDING','message','내용 확인 중 · 기존 내용 제공 중지','canonical_issue_id',canonical);
    else
     select jsonb_build_object('issue_id',n.issue_id,'version_id',n.version_id,'title',n.title,'summary',n.summary,'first_published_at',n.first_published_at,'material_change_at',n.material_change_at,'sample_kind',n.sample_kind,
      'article_kind',v.public_body->>'article_kind','sector_id',s.id,'sector_name',s.name,'legacy_sector',coalesce(s.metadata_kind='SYNTHETIC_FIXTURE',false)) into card
     from public.news_public n join private.issues i on i.id=n.issue_id and i.current_version_id=n.version_id join private.article_versions v on v.id=n.version_id
     left join private.sectors s on s.id=i.primary_sector_id and s.active where n.issue_id=canonical and n.publication_state='PUBLISHED' and n.sample_kind=private.public_read_kind();
     if card is null then r:=jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');else r:=jsonb_build_object('state','PUBLISHED','canonical_issue_id',canonical,'card',card);end if;
    end if;
   end if;
  exception when raise_exception then
   if sqlerrm not in ('ALIAS_CYCLE','ALIAS_CHAIN_LIMIT') then raise;end if;
   r:=jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
  end;
  items:=items||jsonb_build_array(r||jsonb_build_object('requested_issue_id',requested));
 end loop;
 return jsonb_build_object('catalog_version',head::text,'items',items);
end$function$;

CREATE OR REPLACE FUNCTION public.m1_public_articles(p_sector uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_PAGE_SIZE';end if;
  return coalesce((select jsonb_agg(row_to_json(t)) from(
    select n.issue_id,n.version_id,n.title,n.summary,n.first_published_at,n.material_change_at,n.sample_kind,v.public_body->>'article_kind' article_kind,s.name sector_name
    from public.news_public n join private.issues i on i.id=n.issue_id join private.article_versions v on v.id=n.version_id
    left join private.sectors s on s.id=i.primary_sector_id and s.active
    where n.publication_state='PUBLISHED' and private.m1_current_evidence(n.issue_id) and v.public_body->>'article_kind' is distinct from 'COMPANY'
      and (p_sector is null or exists(select 1 from private.impacts z where z.version_id=v.id and z.sector_id=p_sector))
      and (p_cursor is null or n.first_published_at<p_cursor)
    order by n.first_published_at desc,n.issue_id limit p_limit
  )t),'[]');
end$function$;

-- B3. Real publisher and kind-carrying events (generated).
CREATE OR REPLACE FUNCTION private.m0_publish_real(p_issue uuid, p_expected_revision bigint, p_title text, p_summary text, p_body jsonb, p_profile text, p_policy bigint, p_catalog bigint, p_effect_key text)
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
  if i.sample_kind<>'PERMITTED_REAL' or private.public_read_kind()<>'PERMITTED_REAL' then raise exception 'REAL_PUBLIC_READ_OFF';end if;
  if not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'REAL_PUBLICATION_LOCAL_ONLY';end if;
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
  values(v_id,i.id,p_title,p_summary,p_body,p_body->>'source_market',coalesce(p_body->>'selection_market_basis','KR'),'KR_EQUITY',p_profile,p_policy,p_catalog,now(),sections);
  insert into private.impacts(version_id,sector_id,direction,path_id,conditions)
    select v_id,x::uuid,'BENEFIT','LEGACY', '[]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'benefit_sector_ids','[]')) x
    union all select v_id,x::uuid,'DAMAGE','LEGACY','[]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'damage_sector_ids','[]')) x
    union all select v_id,x::uuid,'RELATED','LEGACY','["조건부"]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'related_sector_ids','[]')) x;
  update private.issues set current_version_id=v_id,publication_state='PUBLISHED',first_published_at=coalesce(first_published_at,now()),material_change_at=now(),revision=revision+1 where id=i.id;
  insert into private.outbox(issue_id,version_id,event_type,effect_key,payload) values(i.id,v_id,'ISSUE_PUBLISHED',p_effect_key,jsonb_build_object('issue_id',i.id,'version_id',v_id,'sample_kind',i.sample_kind,'request_hash',request_hash));
  return jsonb_build_object('status','APPLIED','issue_id',i.id,'revision',i.revision+1,'version_id',v_id,'visible_sections',sections);
end$function$;

CREATE OR REPLACE FUNCTION private.reservation_publish_core_real(p_issue uuid, p_expected_revision bigint, p_issue_revision bigint, p_policy bigint, p_catalog bigint, p_effect_key text, p_actor uuid, p_schedule uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d private.editor_drafts;i private.issues;s private.manual_publication_schedules;b jsonb;r jsonb;h text;prior private.outbox;
begin
 if p_actor is null then raise exception 'ACTOR_REQUIRED';end if;
 if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
 select * into strict i from private.issues where id=p_issue for update;
 select * into strict d from private.editor_drafts where issue_id=p_issue for update;
 h:=private.reservation_hash(jsonb_build_object('issue',p_issue,'draft_revision',p_expected_revision,'issue_revision',p_issue_revision,'policy',p_policy,'catalog',p_catalog));
 select * into prior from private.outbox where effect_key=p_effect_key;
 if found then
  if prior.issue_id is distinct from p_issue or prior.payload->>'editor_request_hash' is distinct from h then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
  return jsonb_build_object('status','ALREADY_APPLIED','issue_id',i.id,'revision',i.revision,'version_id',prior.version_id);
 end if;
 if d.revision is distinct from p_expected_revision or i.revision is distinct from p_issue_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
 if p_schedule is null then
  if i.scheduled_publish_at is not null or exists(select 1 from private.manual_publication_schedules where issue_id=p_issue and status='PENDING') then raise exception 'RESERVATION_PENDING';end if;
 else
  perform private.assert_server();
  select * into strict s from private.manual_publication_schedules where id=p_schedule for update;
  if s.status<>'PENDING' or s.issue_id<>i.id or s.actor_id<>p_actor or s.effect_key<>p_effect_key
   or not private.reservation_actor_active(p_actor) or s.due_at>clock_timestamp() or s.expires_at<=clock_timestamp()
   or i.publication_state<>'DRAFT' or i.first_published_at is not null or i.current_version_id is not null
   or i.scheduled_publish_at is distinct from s.due_at or s.draft_revision<>d.revision or s.issue_revision<>i.revision
   or s.policy_version<>p_policy or s.catalog_version<>p_catalog or s.content_hash<>private.reservation_hash(d.content)
   or s.evidence_digest<>private.reservation_evidence_hash(i.id) then raise exception 'RESERVATION_DELEGATION_REJECTED';end if;
 end if;
 if p_schedule is not null then perform private.reservation_assert_wallclock_evidence(p_issue);end if;
 b:=private.m1_prepare(p_issue,d.content,p_policy,p_catalog);
 if p_schedule is not null then perform private.reservation_assert_wallclock_evidence(p_issue);end if;
 update private.issues set primary_sector_id=nullif(b->>'primary_sector_id','')::uuid,manual_protected=true,
  scheduled_publish_at=case when p_schedule is not null then null else scheduled_publish_at end where id=p_issue;
 r:=private.m0_publish_real(p_issue,p_issue_revision,b->>'title',b->>'summary',b,b->>'_profile',p_policy,p_catalog,p_effect_key);
 delete from private.impacts where version_id=(r->>'version_id')::uuid;
 insert into private.impacts(version_id,sector_id,direction,path_id,conditions,evidence_ids)
 select (r->>'version_id')::uuid,(x->>'sector_id')::uuid,x->>'direction',x->>'path_id',x->'conditions',array(select value::uuid from jsonb_array_elements_text(x->'evidence_ids')) from jsonb_array_elements(b->'impacts') x;
 update private.outbox set payload=payload||jsonb_build_object('editor_request_hash',h,'editor_draft_revision',d.revision,'reservation_id',p_schedule) where effect_key=p_effect_key;
 if p_schedule is not null then
  update private.manual_publication_schedules set status='PUBLISHED',revision=revision+1,completed_at=clock_timestamp(),outcome_code='PUBLISHED' where id=p_schedule;
  update private.issues set scheduled_publish_at=null where id=p_issue;
 end if;
 insert into private.audits(actor_id,action,entity_id) values(p_actor::text,case when p_schedule is null then 'MANUAL_PUBLISH' else 'RESERVATION_PUBLISH' end,p_issue::text);
 if p_schedule is not null then perform private.reservation_assert_wallclock_evidence(p_issue);end if;
 return r;
end$function$;

CREATE OR REPLACE FUNCTION public.m1_set_state(p_issue uuid, p_expected_revision bigint, p_state text, p_effect_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;h text;prior private.outbox;
begin perform private.m1_assert_editor();
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  perform 1 from private.issues where id=p_issue for update;
  h:=encode(extensions.digest(convert_to(jsonb_build_object('issue',p_issue,'revision',p_expected_revision,'state',p_state)::text,'UTF8'),'sha256'),'hex');
  select * into prior from private.outbox where effect_key=p_effect_key;
  if found then if prior.issue_id is distinct from p_issue or prior.payload->>'editor_request_hash' is distinct from h then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;return jsonb_build_object('status','ALREADY_APPLIED');end if;
  r:=public.m0_set_publication_state(p_issue,p_expected_revision,p_state);
  insert into private.outbox(issue_id,event_type,effect_key,payload) values(p_issue,'ISSUE_'||p_state,p_effect_key,jsonb_build_object('issue_id',p_issue,'sample_kind',(select sample_kind from private.issues where id=p_issue),'editor_request_hash',h));
  insert into private.audits(actor_id,action,entity_id) values(auth.uid()::text,'MANUAL_'||p_state,p_issue::text);return r;
end$function$;

CREATE OR REPLACE FUNCTION private.correction_timeout_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare start_at timestamptz:=clock_timestamp();candidate record;i private.issues;n integer:=0;skipped integer:=0;k text;r jsonb;
begin
 perform private.assert_server();perform private.assert_initialized();
 if not pg_try_advisory_xact_lock(70606,2) then return jsonb_build_object('status','BUSY');end if;
 for candidate in select id from private.issues where publication_state='CORRECTION_PENDING' and correction_pending_since<=clock_timestamp()-interval '24 hours' order by correction_pending_since,id limit 20 loop
  exit when clock_timestamp()-start_at>=interval '4 seconds';
  begin
   perform 1 from private.catalog_head where singleton for share;
   select * into strict i from private.issues where id=candidate.id for update;
   if i.publication_state<>'CORRECTION_PENDING' or i.correction_pending_since is null or i.correction_pending_since>clock_timestamp()-interval '24 hours' then continue;end if;
   k:='correction-timeout:'||i.id::text||':'||i.revision::text;
   perform public.m0_set_publication_state(i.id,i.revision,'WITHDRAWN');
   insert into private.outbox(issue_id,event_type,effect_key,payload) values(i.id,'ISSUE_WITHDRAWN',k,jsonb_build_object('issue_id',i.id,'sample_kind',i.sample_kind,'reason','CORRECTION_TIMEOUT'));
   insert into private.audits(actor_id,action,entity_id) values('judoju-maintenance','CORRECTION_TIMEOUT',i.id::text);n:=n+1;
  exception when lock_not_available then skipped:=skipped+1;
  end;
 end loop;
 r:=jsonb_build_object('status','OK','withdrawn',n,'lock_skipped',skipped);
 insert into private.maintenance_runs(kind,started_at,finished_at,result) values('CORRECTIONS',start_at,clock_timestamp(),r);return r;
end$function$;

-- B7. Draft detail (generated).
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

-- B3. Publish dispatch by issue kind. Synthetic issues keep the unchanged chain. A real issue is published only while
-- real articles are the public kind, only from an ACTIVE AI link, and never by reservation. An exact replay of an
-- applied publish still gets its stored answer from the core (effect key first).
create or replace function private.reservation_publish_core(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text,p_actor uuid,p_schedule uuid)
returns jsonb language plpgsql set search_path='' as $$
declare k private.sample_kind;st text;
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
  return private.reservation_publish_core_real(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key,p_actor,p_schedule);
end$$;

-- B4. Internal state change (owner only, no editor session): the same transition as an editor's, with the event
-- carrying the issue's own kind and a reason. The same effect key always returns the same answer.
create function private.m1_transition_internal(p_issue uuid,p_state text,p_reason text,p_effect_key text) returns jsonb language plpgsql set search_path='' as $$
declare i private.issues;prior private.outbox;
begin
  if p_state not in ('CORRECTION_PENDING','WITHDRAWN','HIDDEN') then raise exception 'INVALID_TRANSITION';end if;
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  if p_reason is null or p_reason!~'^[A-Z][A-Z0-9_]{2,79}$' then raise exception 'TRANSITION_REASON_REQUIRED';end if;
  select * into strict i from private.issues where id=p_issue for update;
  select * into prior from private.outbox where effect_key=p_effect_key;
  if found then
    if prior.issue_id is distinct from p_issue or prior.event_type<>'ISSUE_'||p_state or prior.payload->>'reason' is distinct from p_reason then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
    return jsonb_build_object('status','ALREADY_APPLIED','issue_id',i.id,'state',i.publication_state,'revision',i.revision);
  end if;
  if i.publication_state='DRAFT' then raise exception 'INVALID_TRANSITION';end if;
  if i.publication_state::text=p_state then return jsonb_build_object('status','UNCHANGED','issue_id',i.id,'state',i.publication_state,'revision',i.revision);end if;
  update private.issues set publication_state=p_state::private.publication_state,revision=revision+1 where id=i.id;
  insert into private.outbox(issue_id,event_type,effect_key,payload) values(i.id,'ISSUE_'||p_state,p_effect_key,jsonb_build_object('issue_id',i.id,'sample_kind',i.sample_kind,'reason',p_reason));
  insert into private.audits(actor_id,action,entity_id,details) values('judoju-maintenance','INTERNAL_'||p_state,i.id::text,jsonb_build_object('reason',p_reason));
  return jsonb_build_object('status','APPLIED','issue_id',i.id,'state',p_state,'revision',i.revision+1);
end$$;

-- A published (or once published) real issue loses its evidence at once: hidden first (a published article moves to
-- the given state), then claims, their links and edges and every evidence record go. The analysis text stays in its
-- version for audit but is never public again: without claims it fails every evidence check. The editor draft and the
-- editor's ownership stay, so a later AI version only waits beside it (HOLD_EDITOR); adopting it is stage 1C.
create function private.ai_retract_published(p_issue uuid,p_state text,p_reason text,p_effect_key text) returns jsonb language plpgsql set search_path='' as $$
declare st private.publication_state;r jsonb:=null;
begin
  -- Same lock order as intake and the editor save path: issue row, then draft row.
  select publication_state into strict st from private.issues where id=p_issue for update;
  perform 1 from private.editor_drafts where issue_id=p_issue for update;
  if st='DRAFT' then raise exception 'AI_ISSUE_NOT_PUBLISHED';end if;
  if st='PUBLISHED' or p_state='WITHDRAWN' and st<>'WITHDRAWN' then r:=private.m1_transition_internal(p_issue,p_state,p_reason,p_effect_key);end if;
  delete from private.ai_claim_links where issue_id=p_issue;
  delete from private.evidence_edges where claim_id in (select id from private.claims where issue_id=p_issue);
  delete from private.claims where issue_id=p_issue;
  delete from private.ai_draft_origin where issue_id=p_issue;
  return jsonb_build_object('state',(select publication_state from private.issues where id=p_issue),'transition',r);
end$$;

-- Withdrawal now also covers published issues (drafts are cleared exactly as before).
create or replace function private.ai_withdraw_draft(p_ai_issue text,p_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare lnk private.ai_issue_links;result jsonb;retract jsonb:=null;
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
    if lnk.issue_id is not null then
      if exists(select 1 from private.issues where id=lnk.issue_id and publication_state<>'DRAFT') then
        retract:=private.ai_retract_published(lnk.issue_id,'CORRECTION_PENDING','AI_SOURCE_REVOKED','ai-withdraw:'||p_ai_issue||':'||p_version);
      else
        perform private.ai_clear_issue(lnk.issue_id);
      end if;
    end if;
    update private.ai_issue_links set current_version=p_version,state='WITHDRAWN',reason=p_reason,updated_at=now() where ai_issue_id=p_ai_issue;
    result:=jsonb_build_object('state','WITHDRAWN','ai_version',p_version,'issue_id',lnk.issue_id);
    if retract is not null then result:=result||jsonb_build_object('issue_state',retract->>'state');end if;
  end if;
  insert into private.audits(actor_id,action,entity_id,details) values('ai-inbox','AI_DRAFT_WITHDRAW_'||(result->>'state'),p_ai_issue,jsonb_build_object('ai_version',p_version,'reason',p_reason));
  return result;
end$$;

-- 30-day record rule for published real articles: once any fact record of the issue is past its 30 days, the article
-- (already hidden by the currency check) is withdrawn and its evidence deleted. Busy issues wait for the next run.
alter function private.ai_inbox_cleanup() rename to ai_inbox_cleanup_v1;
create function private.ai_inbox_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;skipped integer:=0;base jsonb;
begin
  base:=private.ai_inbox_cleanup_v1();
  for r in select i.id,i.revision,(select l.ai_issue_id from private.ai_issue_links l where l.issue_id=i.id) ai from private.issues i
    where i.sample_kind='PERMITTED_REAL' and i.publication_state<>'DRAFT' and exists(select 1 from private.claims c where c.issue_id=i.id and c.valid_until<=now())
    order by i.id limit 200 loop
    if r.ai is not null and not pg_try_advisory_xact_lock(hashtext('ai-issue:'||r.ai)) then skipped:=skipped+1;continue;end if;
    if not exists(select 1 from private.issues where id=r.id for update skip locked)
      or exists(select 1 from private.editor_drafts where issue_id=r.id) and not exists(select 1 from private.editor_drafts where issue_id=r.id for update skip locked) then
      skipped:=skipped+1;continue;
    end if;
    -- Re-read under the locks.
    if not exists(select 1 from private.issues i where i.id=r.id and i.publication_state<>'DRAFT'
      and exists(select 1 from private.claims c where c.issue_id=i.id and c.valid_until<=now())) then continue;end if;
    perform private.ai_retract_published(r.id,'WITHDRAWN','FACT_RECORD_EXPIRED','ai-expire:'||r.id||':'||(select revision from private.issues where id=r.id));
    update private.ai_issue_links set state='WITHDRAWN',reason='EXPIRED',updated_at=now() where issue_id=r.id;
    n:=n+1;
  end loop;
  return base||jsonb_build_object('published_expired',n,'published_skipped_busy',skipped);
end$$;

-- B7. Editor list: the reason of the latest internal or editor state change, for withdrawn or expired real articles.
create or replace function public.m1_editor_articles() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(row_to_json(t)) from(select i.id,i.publication_state,i.revision,d.revision draft_revision,d.content->>'title' title,d.updated_at,i.sample_kind,
  (select jsonb_build_object('state',l.state,'ai_version',l.current_version,'facts',(select jsonb_array_length(o.facts) from private.ai_draft_origin o where o.issue_id=i.id order by o.ai_version desc limit 1))
   from private.ai_issue_links l where l.issue_id=i.id) ai_origin,
  case when i.publication_state in ('CORRECTION_PENDING','WITHDRAWN','HIDDEN') then (select o.payload->>'reason' from private.outbox o
    where o.issue_id=i.id and o.event_type='ISSUE_'||i.publication_state::text order by o.created_at desc,o.id limit 1) end state_reason
  from private.issues i join private.editor_drafts d on d.issue_id=i.id order by d.updated_at desc limit 100)t),'[]');end$$;

-- New private functions: owner only. Renamed predecessors keep their old ACL on rename; they are internal now.
revoke all on function private.public_read_kind(), private.m0_publish_real(uuid,bigint,text,text,jsonb,text,bigint,bigint,text),
  private.reservation_publish_core_real(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid), private.m1_transition_internal(uuid,text,text,text),
  private.ai_retract_published(uuid,text,text,text), private.ai_inbox_cleanup(), private.ai_inbox_cleanup_v1()
  from public, anon, authenticated, service_role;
commit;
