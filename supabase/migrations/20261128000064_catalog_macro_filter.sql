begin;
-- Macro filter (docs/sector-news-plan.md §1, user 2026-11-28 "필터에 매크로가 추가되어야"). The feed gets an
-- eight-argument form with p_macro (no default, so it never competes with the seven-argument form in PostgREST).
--   no sectors, no macro : every SECTOR and MACRO article (as before)
--   sectors only         : articles with an impact path in those sectors, MACRO included (as before)
--   macro only           : every MACRO article, with or without impacts
--   macro + sectors      : every MACRO article plus articles with an impact path in those sectors
-- COMPANY articles stay on company pages. The seven-argument form keeps its exact behaviour by calling p_macro=false.
create function public.catalog_public_articles(p_expected bigint,p_sectors uuid[],p_period text,p_limit integer,p_as_of timestamptz,p_last_time timestamptz,p_last_id uuid,p_macro boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;cutoff timestamptz;local_day timestamp;start_at timestamptz;end_at timestamptz;items jsonb;next_item jsonb;
begin
 head:=private.catalog_require_reference_head(p_expected);cutoff:=coalesce(p_as_of,statement_timestamp());local_day:=date_trunc('day',cutoff at time zone 'Asia/Seoul');
 if p_macro is null or cutoff>statement_timestamp()+interval '5 seconds' or cutoff<timestamp with time zone '2000-01-01 00:00:00+00' or p_limit is null or p_limit not between 1 and 50 or p_sectors is null or cardinality(p_sectors)>200 or cardinality(p_sectors)<>(select count(distinct id) from unnest(p_sectors)id)
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
   and (
     (not p_macro and (cardinality(p_sectors)=0 or exists(select 1 from private.impacts z where z.version_id=v.id and z.sector_id=any(p_sectors))))
     or (p_macro and (v.public_body->>'article_kind'='MACRO' or exists(select 1 from private.impacts z where z.version_id=v.id and z.sector_id=any(p_sectors))))
   )
   and (p_last_time is null or n.first_published_at<p_last_time or n.first_published_at=p_last_time and n.issue_id>p_last_id)
  order by n.first_published_at desc,n.issue_id asc limit p_limit+1
 )page;
 if jsonb_array_length(items)>p_limit then
  items:=items- p_limit;next_item:=items->(p_limit-1);
 end if;
 return jsonb_build_object('catalog_version',head::text,'as_of',cutoff,'period',p_period,'range_start',start_at,'range_end',end_at,'items',items,
 'next',case when next_item is not null then jsonb_build_object('last_time',next_item->'first_published_at','last_id',next_item->'issue_id') else null end);
end$$;
revoke all on function public.catalog_public_articles(bigint,uuid[],text,integer,timestamptz,timestamptz,uuid,boolean) from public;
grant execute on function public.catalog_public_articles(bigint,uuid[],text,integer,timestamptz,timestamptz,uuid,boolean) to anon,authenticated;

-- The seven-argument form: same signature, defaults and grants as before; its body now delegates with p_macro=false.
create or replace function public.catalog_public_articles(p_expected bigint,p_sectors uuid[] default '{}',p_period text default 'TODAY',p_limit integer default 20,p_as_of timestamptz default null,p_last_time timestamptz default null,p_last_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select public.catalog_public_articles(p_expected,p_sectors,p_period,p_limit,p_as_of,p_last_time,p_last_id,false);
$$;
revoke all on function public.catalog_public_articles(bigint,uuid[],text,integer,timestamptz,timestamptz,uuid) from public;
grant execute on function public.catalog_public_articles(bigint,uuid[],text,integer,timestamptz,timestamptz,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
