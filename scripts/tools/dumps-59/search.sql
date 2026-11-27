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
end$function$

