begin;
-- Article scope (2026-11-27). A COMPANY issue concerns one company's own event and is shown on that
-- company's page only. SECTOR and MACRO issues keep feeding the home and sector lists and are also shown
-- on the page of every company they link. Links come from company_refs, checked against the catalog.
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v5;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
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
  -- A company issue passes every SECTOR rule (primary sector, impact paths, evidence), then keeps its scope.
  b:=private.m1_prepare_v5(p_issue,jsonb_set(p_input,'{article_kind}','"SECTOR"'),p_policy,p_catalog)||jsonb_build_object('article_kind','COMPANY');
 else
  if primary_ref is not null then raise exception 'PRIMARY_COMPANY_ONLY_FOR_COMPANY_SCOPE';end if;
  b:=private.m1_prepare_v5(p_issue,p_input,p_policy,p_catalog);
 end if;
 return b||jsonb_build_object('company_refs',refs,'primary_company_ref',primary_ref);
end$$;

-- Feed lists (home period list and sector filter) leave COMPANY issues to the company page.
create or replace function public.catalog_public_articles(p_expected bigint,p_sectors uuid[] default '{}',p_period text default 'TODAY',p_limit integer default 20,p_as_of timestamptz default null,p_last_time timestamptz default null,p_last_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;cutoff timestamptz;local_day timestamp;start_at timestamptz;end_at timestamptz;items jsonb;next_item jsonb;
begin
 head:=private.catalog_require_reference_head(p_expected);cutoff:=coalesce(p_as_of,statement_timestamp());local_day:=date_trunc('day',cutoff at time zone 'Asia/Seoul');
 if cutoff>statement_timestamp()+interval '5 seconds' or cutoff<timestamp with time zone '2000-01-01 00:00:00+00' or p_limit is null or p_limit not between 1 and 50 or p_sectors is null or cardinality(p_sectors)>200 or cardinality(p_sectors)<>(select count(distinct id) from unnest(p_sectors)id)
 or (p_last_time is null)<>(p_last_id is null) or p_last_time>cutoff then raise exception 'INVALID_CURSOR_CONTEXT';end if;
 if exists(select 1 from unnest(p_sectors)id where not private.catalog_sector_selectable(id,head,'SYNTHETIC')) then raise exception 'STALE_CATALOG';end if;
 if p_period='TODAY' then start_at:=local_day at time zone 'Asia/Seoul';end_at:=(local_day+interval '1 day') at time zone 'Asia/Seoul';
 elsif p_period='YESTERDAY' then start_at:=(local_day-interval '1 day') at time zone 'Asia/Seoul';end_at:=local_day at time zone 'Asia/Seoul';
 elsif p_period='THIS_WEEK' then start_at:=date_trunc('week',local_day) at time zone 'Asia/Seoul';end_at:=(date_trunc('week',local_day)+interval '1 week') at time zone 'Asia/Seoul';
 elsif p_period='LAST_WEEK' then start_at:=(date_trunc('week',local_day)-interval '1 week') at time zone 'Asia/Seoul';end_at:=date_trunc('week',local_day) at time zone 'Asia/Seoul';
 elsif p_period='THIS_MONTH' then start_at:=date_trunc('month',local_day) at time zone 'Asia/Seoul';end_at:=(date_trunc('month',local_day)+interval '1 month') at time zone 'Asia/Seoul';
 elsif p_period='LAST_MONTH' then start_at:=(date_trunc('month',local_day)-interval '1 month') at time zone 'Asia/Seoul';end_at:=date_trunc('month',local_day) at time zone 'Asia/Seoul';
 else raise exception 'INVALID_CURSOR_CONTEXT';end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.first_published_at desc,page.issue_id),'[]') into items from(
  select n.issue_id,n.version_id,n.title,n.summary,n.first_published_at,n.material_change_at,n.sample_kind,v.public_body->>'article_kind' article_kind,s.id sector_id,s.name sector_name,s.metadata_kind,
   case when s.metadata_kind='SYNTHETIC_FIXTURE' then true else false end legacy_sector
  from public.news_public n join private.issues i on i.id=n.issue_id join private.article_versions v on v.id=n.version_id left join private.sectors s on s.id=i.primary_sector_id and s.active
  where n.publication_state='PUBLISHED' and not exists(select 1 from private.issue_aliases alias where alias.alias_id=n.issue_id) and private.m1_current_evidence(n.issue_id) and n.first_published_at>=start_at and n.first_published_at<end_at and n.first_published_at<=cutoff
   and v.public_body->>'article_kind' is distinct from 'COMPANY'
   and (cardinality(p_sectors)=0 or exists(select 1 from private.impacts z where z.version_id=v.id and z.sector_id=any(p_sectors)))
   and (p_last_time is null or n.first_published_at<p_last_time or n.first_published_at=p_last_time and n.issue_id>p_last_id)
  order by n.first_published_at desc,n.issue_id asc limit p_limit+1
 )page;
 if jsonb_array_length(items)>p_limit then
  items:=items- p_limit;next_item:=items->(p_limit-1);
 end if;
 return jsonb_build_object('catalog_version',head::text,'as_of',cutoff,'period',p_period,'range_start',start_at,'range_end',end_at,'items',items,
 'next',case when next_item is not null then jsonb_build_object('last_time',next_item->'first_published_at','last_id',next_item->'issue_id') else null end);
end$$;

-- Company page: reference identity, related sectors, and every current published issue that links the company.
-- Stock code, price and links stay null until the stock identity is verified.
create function public.catalog_public_company(p_expected bigint,p_company uuid,p_limit integer default 20,p_as_of timestamptz default null,p_last_time timestamptz default null,p_last_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;cutoff timestamptz;company record;items jsonb;last_item jsonb;
begin
 head:=private.catalog_require_reference_head(p_expected);cutoff:=coalesce(p_as_of,statement_timestamp());
 if p_company is null or p_limit is null or p_limit not between 1 and 20 or cutoff>statement_timestamp()+interval '5 seconds' or cutoff<'2000-01-01T00:00:00Z'::timestamptz
 or (p_last_time is null)<>(p_last_id is null) or p_last_time>cutoff then raise exception 'INVALID_CURSOR_CONTEXT';end if;
 select c.id,c.name,c.search_description,c.metadata_kind,c.stock_identity_state into company from private.catalog_source_companies c
 where c.id=p_company and c.active and c.metadata_kind='USER_REFERENCE_UNVERIFIED'
  and exists(select 1 from private.catalog_memberships m where m.source_company_ref=c.id and private.search_membership_visible(m.id,head));
 if company.id is null then return jsonb_build_object('catalog_version',head::text,'state','NOT_FOUND');end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.first_published_at desc,page.issue_id),'[]') into items from(
  select n.issue_id,n.version_id,n.title,n.summary,n.first_published_at,n.material_change_at,n.sample_kind,v.public_body->>'article_kind' article_kind,s.id sector_id,s.name sector_name,
   coalesce(s.metadata_kind='SYNTHETIC_FIXTURE',false) legacy_sector,
   case when v.public_body->>'primary_company_ref'=p_company::text then 'PRIMARY' else 'MENTIONED' end company_role
  from public.news_public n join private.issues i on i.id=n.issue_id and i.current_version_id=n.version_id
  join private.article_versions v on v.id=n.version_id left join private.sectors s on s.id=i.primary_sector_id and s.active
  where n.publication_state='PUBLISHED' and v.public_body->>'_contract'='M1' and jsonb_typeof(v.public_body->'company_refs')='array'
   and v.public_body->'company_refs' ? p_company::text
   and not exists(select 1 from private.issue_aliases a where a.alias_id=n.issue_id) and private.m1_current_evidence(n.issue_id)
   and n.first_published_at<=cutoff and v.created_at<=cutoff
   and (p_last_time is null or n.first_published_at<p_last_time or n.first_published_at=p_last_time and n.issue_id>p_last_id)
  order by n.first_published_at desc,n.issue_id limit p_limit+1)page;
 if jsonb_array_length(items)>p_limit then items:=items-p_limit;last_item:=items->(p_limit-1);end if;
 return jsonb_build_object('catalog_version',head::text,'state','AVAILABLE','as_of',cutoff,
  'company',jsonb_build_object('source_company_ref',company.id,'name',company.name,'search_description',company.search_description,'metadata_kind',company.metadata_kind,
   'stock_identity_state',company.stock_identity_state,'stock_code',null,'price',null,'change_percent',null,'stock_url',null,
   'related_sectors',private.search_company_sectors(company.id,head,0,20),'has_more_sectors',jsonb_array_length(private.search_company_sectors(company.id,head,20,1))>0),
  'items',items,'next',case when last_item is null then null else jsonb_build_object('last_time',last_item->'first_published_at','last_id',last_item->'issue_id') end);
end$$;
revoke all on function public.catalog_public_company(bigint,uuid,integer,timestamptz,timestamptz,uuid) from public;
grant execute on function public.catalog_public_company(bigint,uuid,integer,timestamptz,timestamptz,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
