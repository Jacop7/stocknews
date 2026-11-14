begin;
-- Preserve every validated path, but pass unique sector sets to the legacy atomic publisher.
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v1;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare b jsonb;k text;items jsonb;
begin
  b:=private.m1_prepare_v1(p_issue,p_input,p_policy,p_catalog);
  foreach k in array array['benefit_sector_ids','damage_sector_ids','related_sector_ids','filter_sector_ids'] loop
    select coalesce(jsonb_agg(value order by value),'[]') into items from(select distinct value from jsonb_array_elements(b->k)) s;
    b:=jsonb_set(b,array[k],items);
  end loop;return b;
end$$;
create function private.m1_current_evidence(p_issue uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id
    where i.id=p_issue and i.publication_state='PUBLISHED' and i.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1'
    and exists(select 1 from private.policies p where p.version=v.visibility_policy_version and p.active)
    and exists(select 1 from private.catalog_versions c where c.version=v.catalog_version and c.active)
    and exists(select 1 from private.impacts z where z.version_id=v.id)
    and not exists(select 1 from private.claims c where c.issue_id=i.id and (not c.verified or not c.fact_current or not c.korea_path_verified or c.claim_type='SENSITIVE_UNCONFIRMED' or c.valid_until<=now()))
    and not exists(select 1 from private.impacts z left join private.sectors s on s.id=z.sector_id where z.version_id=v.id and (not s.active or s.catalog_version<>v.catalog_version))
  )
$$;
create function public.m1_public_article(p_issue uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;canonical uuid;
begin
  r:=public.resolve_issue(p_issue);if r->>'state'<>'PUBLISHED' then return r;end if;
  canonical:=(r->>'canonical_issue_id')::uuid;
  if not exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=canonical and v.public_body->>'_contract'='M1') then return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');end if;
  if not private.m1_current_evidence(canonical) then return jsonb_build_object('state','CORRECTION_PENDING','message','근거·분류 재확인 중 · 기존 내용 제공 중지');end if;
  return public.get_public_article(canonical);
end$$;
create or replace function public.m1_public_articles(p_sector uuid default null,p_limit integer default 20,p_cursor timestamptz default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_PAGE_SIZE';end if;
  return coalesce((select jsonb_agg(row_to_json(t)) from(
    select n.issue_id,n.version_id,n.title,n.summary,n.first_published_at,n.material_change_at,n.sample_kind,v.public_body->>'article_kind' article_kind,s.name sector_name
    from public.news_public n join private.issues i on i.id=n.issue_id join private.article_versions v on v.id=n.version_id
    left join private.sectors s on s.id=i.primary_sector_id and s.active
    where n.publication_state='PUBLISHED' and private.m1_current_evidence(n.issue_id)
      and (p_sector is null or exists(select 1 from private.impacts z where z.version_id=v.id and z.sector_id=p_sector))
      and (p_cursor is null or n.first_published_at<p_cursor)
    order by n.first_published_at desc,n.issue_id limit p_limit
  )t),'[]');
end$$;
grant execute on function public.m1_public_article(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
