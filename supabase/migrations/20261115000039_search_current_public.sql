begin;
create function private.search_normalize(p_text text) returns text language sql immutable set search_path='' as $$
 select lower(normalize(regexp_replace(btrim(coalesce(p_text,'')),'[[:space:]]+',' ','g'),NFC))
$$;
create function private.search_tokens(p_query text) returns text[] language plpgsql immutable set search_path='' as $$
declare words text[];q text;
begin
 if p_query is null or length(p_query) not between 1 and 80 then raise exception 'INVALID_SEARCH_QUERY';end if;
 q:=private.search_normalize(p_query);words:=string_to_array(q,' ');
 if q='' or cardinality(words)>6 or q~'[[:cntrl:]]' then raise exception 'INVALID_SEARCH_QUERY';end if;
 return words;
end$$;
create function private.search_contains_all(p_text text,p_tokens text[]) returns boolean language sql immutable set search_path='' as $$
 select not exists(select 1 from unnest(p_tokens) word where strpos(private.search_normalize(p_text),word)=0)
$$;
create function private.search_membership_visible(p_membership uuid,p_head bigint) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.catalog_memberships m join private.catalog_source_companies c on c.id=m.source_company_ref and c.active
 where m.id=p_membership and m.active and private.catalog_sector_selectable(m.sector_id,p_head,'SYNTHETIC')
 and (m.subgroup_id is null or exists(select 1 from private.subgroups g where g.id=m.subgroup_id and g.sector_id=m.sector_id and g.active and g.metadata_kind='USER_REFERENCE_UNVERIFIED')))
$$;
create function private.search_company_sectors(p_company uuid,p_head bigint,p_offset integer,p_limit integer) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(page) order by page.display_order,page.id),'[]') from(
 select distinct s.id,s.name,s.display_order from private.catalog_memberships m join private.sectors s on s.id=m.sector_id
 where m.source_company_ref=p_company and private.search_membership_visible(m.id,p_head)
 order by s.display_order,s.id offset p_offset limit p_limit)page
$$;
create function public.catalog_public_search_news(p_expected bigint,p_query text,p_limit integer default 20,p_as_of timestamptz default null,p_last_time timestamptz default null,p_last_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
  where n.publication_state='PUBLISHED' and n.sample_kind='SYNTHETIC' and i.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1'
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
end$$;
create function public.catalog_public_search_companies(p_expected bigint,p_query text,p_limit integer default 20,p_last_rank integer default null,p_last_name text default null,p_last_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;words text[];q text;items jsonb:='[]';item jsonb;last_item jsonb;more boolean:=false;used_bytes integer:=0;
begin
 head:=private.catalog_require_reference_head(p_expected);words:=private.search_tokens(p_query);q:=private.search_normalize(p_query);
 if p_limit is null or p_limit not between 1 and 20 or not (num_nonnulls(p_last_rank,p_last_name,p_last_id)=0 or
 (num_nonnulls(p_last_rank,p_last_name,p_last_id)=3 and p_last_rank between 0 and 3 and length(p_last_name) between 1 and 200)) then raise exception 'INVALID_CURSOR_CONTEXT';end if;
 for item in
  with matched as(
   select c.*,private.search_normalize(c.name) collate "C" sort_name,
    case when private.search_normalize(c.name)=q then 0
     when exists(select 1 from jsonb_array_elements(c.direct_keywords)kw where private.search_normalize(coalesce(kw->>'raw',kw->>'value'))=q) then 1
     when private.search_contains_all(c.name,words) then 2 else 3 end sort_rank
   from private.catalog_source_companies c where c.active and c.metadata_kind='USER_REFERENCE_UNVERIFIED'
    and exists(select 1 from private.catalog_memberships m where m.source_company_ref=c.id and private.search_membership_visible(m.id,head))
    and private.search_contains_all(concat_ws(' ',c.name,(select string_agg(coalesce(kw->>'raw',kw->>'value'),' ') from jsonb_array_elements(c.direct_keywords)kw)),words)
  ),page as(
   select m.* from matched m where p_last_rank is null or (m.sort_rank,m.sort_name collate "C",m.id)>(p_last_rank,p_last_name collate "C",p_last_id)
   order by m.sort_rank,m.sort_name collate "C",m.id limit p_limit+1
  ) select jsonb_build_object('source_company_ref',id,'name',name,'search_description',search_description,'metadata_kind',metadata_kind,'stock_identity_state',stock_identity_state,
    'stock_code',null,'price',null,'change_percent',null,'stock_url',null,'related_sectors',private.search_company_sectors(id,head,0,3),
    'has_more_sectors',jsonb_array_length(private.search_company_sectors(id,head,3,1))>0,'sort_rank',sort_rank,'sort_name',sort_name)
   from page order by sort_rank,sort_name collate "C",id
 loop
  -- Keep the complete E description, including multiline source values. A byte
  -- budget can shorten a page; it never truncates the stored/displayed text.
  if jsonb_array_length(items)>=p_limit or used_bytes+octet_length(item::text)>220000 then more:=true;exit;end if;
  used_bytes:=used_bytes+octet_length(item::text);items:=items||jsonb_build_array(item);last_item:=item;
 end loop;
 if more and last_item is null then raise exception 'PUBLIC_RESPONSE_LIMIT';end if;
 return jsonb_build_object('catalog_version',head::text,'items',(select coalesce(jsonb_agg(value-'sort_rank'-'sort_name' order by n),'[]') from jsonb_array_elements(items)with ordinality x(value,n)),
  'next',case when not more then null else jsonb_build_object('last_rank',last_item->'sort_rank','last_name',last_item->'sort_name','last_id',last_item->'source_company_ref') end);
end$$;
create function public.catalog_public_company_sectors(p_expected bigint,p_company uuid,p_offset integer default 0,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;items jsonb;more boolean;
begin
 head:=private.catalog_require_reference_head(p_expected);
 if p_offset is null or p_offset not between 0 and 3000 or p_limit is null or p_limit not between 1 and 20 then raise exception 'INVALID_CURSOR_CONTEXT';end if;
 if not exists(select 1 from private.catalog_source_companies c where c.id=p_company and c.active and exists(select 1 from private.catalog_memberships m where m.source_company_ref=c.id and private.search_membership_visible(m.id,head))) then
  return jsonb_build_object('catalog_version',head::text,'state','NOT_FOUND','items','[]'::jsonb,'next_offset',null);end if;
 items:=private.search_company_sectors(p_company,head,p_offset,p_limit+1);more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;
 return jsonb_build_object('catalog_version',head::text,'state','AVAILABLE','items',items,'next_offset',case when more then p_offset+p_limit else null end);
end$$;
revoke all on function public.catalog_public_search_news(bigint,text,integer,timestamptz,timestamptz,uuid),public.catalog_public_search_companies(bigint,text,integer,integer,text,uuid),public.catalog_public_company_sectors(bigint,uuid,integer,integer) from public;
grant execute on function public.catalog_public_search_news(bigint,text,integer,timestamptz,timestamptz,uuid),public.catalog_public_search_companies(bigint,text,integer,integer,text,uuid),public.catalog_public_company_sectors(bigint,uuid,integer,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
