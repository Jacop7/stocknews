begin;
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v3;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare b jsonb;
begin
 b:=private.m1_prepare_v3(p_issue,p_input,p_policy,p_catalog);
 if b->>'article_kind'='SECTOR' and not exists(select 1 from jsonb_array_elements_text(b->'filter_sector_ids') x where x=b->>'primary_sector_id') then raise exception 'PRIMARY_SECTOR_PATH_REQUIRED';end if;
 return b;
end$$;
create function public.is_news_visible(p_issue uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=p_issue and i.publication_state='PUBLISHED'
   and (v.public_body->>'_contract' is distinct from 'M1' or private.m1_current_evidence(i.id)))
$$;
grant execute on function public.is_news_visible(uuid) to anon,authenticated,service_role;
drop policy published_news_read on public.news_public;
create policy published_news_read on public.news_public for select to anon,authenticated using(publication_state='PUBLISHED' and public.is_news_visible(issue_id));
alter function public.get_public_article(uuid) rename to m0_get_public_article_legacy;
alter function public.m0_get_public_article_legacy(uuid) set schema private;
create function public.get_public_article(p_issue uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;canonical uuid;
begin
 r:=public.resolve_issue(p_issue);if r->>'state'<>'PUBLISHED' then return r;end if;canonical:=(r->>'canonical_issue_id')::uuid;
 if exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=canonical and v.public_body->>'_contract'='M1') and not private.m1_current_evidence(canonical) then return jsonb_build_object('state','CORRECTION_PENDING','message','근거·분류 재확인 중 · 기존 내용 제공 중지');end if;
 return private.m0_get_public_article_legacy(p_issue);
end$$;
grant execute on function public.get_public_article(uuid) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
