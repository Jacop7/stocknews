begin;
-- Sector-level impact summary for public list cards (이슈체크 카드의 수혜/피해/연관 섹터).
-- Only active sectors of the published version. companies stays empty: applying a news item to an
-- individual company needs its own path evidence (뉴스운영 상세로직), which the schema does not hold yet.
create function private.public_card_impacts(p_version uuid) returns jsonb language sql stable set search_path='' as $$
 -- One entry per (sector, direction): several evidence paths for the same sector collapse.
 select coalesce(jsonb_agg(jsonb_build_object('sector_id',x.sector_id,'sector_name',x.name,'direction',x.direction,'companies','[]'::jsonb)
  order by case x.direction when 'BENEFIT' then 0 when 'DAMAGE' then 1 else 2 end,x.display_order,x.name,x.sector_id),'[]'::jsonb)
 from (select distinct z.sector_id,z.direction,s.name,s.display_order
  from private.impacts z join private.sectors s on s.id=z.sector_id and s.active where z.version_id=p_version) x
$$;
revoke all on function private.public_card_impacts(uuid) from public,anon,authenticated;

-- The three public card producers gain an additive "impacts" field; everything else is unchanged.
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
   case when s.metadata_kind='SYNTHETIC_FIXTURE' then true else false end legacy_sector,private.public_card_impacts(v.id) impacts
  from public.news_public n join private.issues i on i.id=n.issue_id join private.article_versions v on v.id=n.version_id left join private.sectors s on s.id=i.primary_sector_id and s.active
  where n.publication_state='PUBLISHED' and not exists(select 1 from private.issue_aliases alias where alias.alias_id=n.issue_id) and private.m1_current_evidence(n.issue_id) and n.first_published_at>=start_at and n.first_published_at<end_at and n.first_published_at<=cutoff
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
create or replace function public.catalog_public_search_news(p_expected bigint,p_query text,p_limit integer default 20,p_as_of timestamptz default null,p_last_time timestamptz default null,p_last_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;words text[];cutoff timestamptz;items jsonb;last_item jsonb;
begin
 head:=private.catalog_require_reference_head(p_expected);words:=private.search_tokens(p_query);cutoff:=coalesce(p_as_of,statement_timestamp());
 if p_limit is null or p_limit not between 1 and 20 or cutoff>statement_timestamp()+interval '5 seconds' or cutoff<'2000-01-01T00:00:00Z'::timestamptz
 or (p_last_time is null)<>(p_last_id is null) or p_last_time>cutoff then raise exception 'INVALID_CURSOR_CONTEXT';end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.first_published_at desc,page.issue_id),'[]') into items from(
  select n.issue_id,n.version_id,n.title,n.summary,n.first_published_at,n.material_change_at,n.sample_kind,v.public_body->>'article_kind' article_kind,s.id sector_id,s.name sector_name,
   coalesce(s.metadata_kind='SYNTHETIC_FIXTURE',false) legacy_sector,private.public_card_impacts(v.id) impacts
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
create or replace function public.catalog_public_saved(p_expected bigint,p_issues uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;requested uuid;r jsonb;card jsonb;canonical uuid;items jsonb:='[]';
begin
 head:=private.catalog_require_reference_head(p_expected);
 if p_issues is null or cardinality(p_issues)>20 or array_position(p_issues,null) is not null or cardinality(p_issues)<>(select count(distinct id)from unnest(p_issues)id) then raise exception 'INVALID_SAVED_IDS';end if;
 foreach requested in array p_issues loop
  begin
   r:=public.resolve_issue(requested);canonical:=(r->>'canonical_issue_id')::uuid;card:=null;
   if r->>'state'='PUBLISHED' then
    if not exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=canonical and i.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1') then
     r:=jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
    elsif not private.m1_current_evidence(canonical) then
     r:=jsonb_build_object('state','CORRECTION_PENDING','message','내용 확인 중 · 기존 내용 제공 중지','canonical_issue_id',canonical);
    else
     select jsonb_build_object('issue_id',n.issue_id,'version_id',n.version_id,'title',n.title,'summary',n.summary,'first_published_at',n.first_published_at,'material_change_at',n.material_change_at,'sample_kind',n.sample_kind,
      'article_kind',v.public_body->>'article_kind','sector_id',s.id,'sector_name',s.name,'legacy_sector',coalesce(s.metadata_kind='SYNTHETIC_FIXTURE',false),'impacts',private.public_card_impacts(v.id)) into card
     from public.news_public n join private.issues i on i.id=n.issue_id and i.current_version_id=n.version_id join private.article_versions v on v.id=n.version_id
     left join private.sectors s on s.id=i.primary_sector_id and s.active where n.issue_id=canonical and n.publication_state='PUBLISHED' and n.sample_kind='SYNTHETIC';
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
end$$;
notify pgrst,'reload schema';
commit;
