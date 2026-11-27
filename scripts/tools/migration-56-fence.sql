-- A2. Dispatcher: real issues go to the real chain, everything else to the unchanged synthetic chain. A draft may never
-- mix sample kinds (claims of another kind on the issue).
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v8;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare k private.sample_kind;
begin
  select sample_kind into k from private.issues where id=p_issue;
  if k is null then raise exception 'ISSUE_NOT_FOUND';end if;
  if exists(select 1 from private.claims c where c.issue_id=p_issue and c.sample_kind<>k) then raise exception 'MIXED_SAMPLE_KIND';end if;
  if k='PERMITTED_REAL' then return private.m1_prepare_real(p_issue,p_input,p_policy,p_catalog);end if;
  return private.m1_prepare_v8(p_issue,p_input,p_policy,p_catalog);
end$$;

-- 1A publish block: no real article is published or scheduled (both go through the publish core).
alter function private.reservation_publish_core(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid) rename to reservation_publish_core_v1;
create function private.reservation_publish_core(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text,p_actor uuid,p_schedule uuid)
returns jsonb language plpgsql set search_path='' as $$
begin
  if exists(select 1 from private.issues where id=p_issue and sample_kind<>'SYNTHETIC') then raise exception 'REAL_PUBLICATION_NOT_ENABLED_1A';end if;
  return private.reservation_publish_core_v1(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key,p_actor,p_schedule);
end$$;

-- Public fence (1A): every public read boundary requires a synthetic issue directly, so even a mistakenly published
-- real article never leaves the database.
alter function private.m1_current_evidence(uuid) rename to m1_current_evidence_v3;
create function private.m1_current_evidence(p_issue uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.issues where id=p_issue and sample_kind='SYNTHETIC') and private.m1_current_evidence_v3(p_issue)
$$;
create or replace function public.is_news_visible(p_issue uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=p_issue and i.publication_state='PUBLISHED'
   and i.sample_kind='SYNTHETIC'
   and (v.public_body->>'_contract' is distinct from 'M1' or private.m1_current_evidence(i.id)))
$$;
alter function private.m0_get_public_article_legacy(uuid) rename to m0_get_public_article_legacy_v1;
create function private.m0_get_public_article_legacy(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  r:=private.m0_get_public_article_legacy_v1(p_issue);
  if r ? 'issue_id' and not exists(select 1 from private.issues where id=(r->>'issue_id')::uuid and sample_kind='SYNTHETIC') then
    return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
  end if;
  return r;
end$$;

-- A5 (DB part). The preview carries the issue's own sample kind; draft detail and list carry it too.
create or replace function public.m1_preview_draft(p_issue uuid,p_expected_revision bigint,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.editor_drafts;b jsonb;sections text[];k private.sample_kind;
begin perform private.m1_assert_editor();select * into strict d from private.editor_drafts where issue_id=p_issue;
  if d.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  select sample_kind into strict k from private.issues where id=p_issue;
  b:=private.m1_prepare(p_issue,d.content,p_policy,p_catalog);sections:=private.visible_sections(b->>'_profile',b,now(),now());
  return jsonb_build_object('title',b->>'title','summary',b->>'summary','body',private.public_body(b,sections,now()),'sample_kind',k);
end$$;
create or replace function public.m1_get_draft(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;labels jsonb;head bigint;k private.sample_kind;
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
 return result||jsonb_build_object('sector_labels',labels,'sample_kind',k);
end$$;
create or replace function public.m1_editor_articles() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return coalesce((select jsonb_agg(row_to_json(t)) from(select i.id,i.publication_state,i.revision,d.revision draft_revision,d.content->>'title' title,d.updated_at,i.sample_kind from private.issues i join private.editor_drafts d on d.issue_id=i.id order by d.updated_at desc limit 100)t),'[]');end$$;

-- New private functions: owner only.
revoke all on function private.m1_prepare(uuid,jsonb,bigint,bigint), private.m1_prepare_real(uuid,jsonb,bigint,bigint),
  private.m1_prepare_real_v1(uuid,jsonb,bigint,bigint), private.m1_prepare_real_v2(uuid,jsonb,bigint,bigint), private.m1_prepare_real_v3(uuid,jsonb,bigint,bigint),
  private.m1_prepare_real_v4(uuid,jsonb,bigint,bigint), private.m1_prepare_real_v5(uuid,jsonb,bigint,bigint), private.m1_prepare_real_v7(uuid,jsonb,bigint,bigint),
  private.reservation_publish_core(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid), private.m1_current_evidence(uuid), private.m0_get_public_article_legacy(uuid)
  from public, anon, authenticated, service_role;
commit;
