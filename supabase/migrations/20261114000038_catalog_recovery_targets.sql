begin;
create function public.catalog_editor_group(p_group uuid,p_expected bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;item jsonb;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(p_expected);
 select jsonb_build_object('id',id,'sector_id',sector_id,'name',name,'display_order',display_order,'active',active) into item from private.subgroups where id=p_group and metadata_kind='USER_REFERENCE_UNVERIFIED';
 if item is null then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 return jsonb_build_object('catalog_version',head::text,'group',item);
end$$;
create function public.catalog_editor_membership(p_membership uuid,p_expected bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;item jsonb;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(p_expected);
 select jsonb_build_object('id',m.id,'sector_id',m.sector_id,'subgroup_id',m.subgroup_id,'source_company_ref',m.source_company_ref,'role',m.role,'display_order',m.display_order,'active',m.active,'name',c.name)
 into item from private.catalog_memberships m join private.catalog_source_companies c on c.id=m.source_company_ref where m.id=p_membership;
 if item is null then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 return jsonb_build_object('catalog_version',head::text,'membership',item);
end$$;
-- Dropdown metadata is bounded separately from selected-sector descriptions.
create or replace function public.catalog_editor_sectors() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(null);
 return jsonb_build_object('catalog_version',head::text,'sectors',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description','') order by s.display_order,s.id),'[]') from private.sectors s where private.catalog_sector_selectable(s.id,head,'SYNTHETIC')));
end$$;
create function public.catalog_save_draft(p_issue uuid,p_expected_revision bigint,p_content jsonb,p_catalog bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.m1_assert_editor();perform private.m1_draft_shape(p_content);
 perform 1 from private.catalog_head where singleton for share;
 if p_catalog is null then raise exception 'STALE_CATALOG';end if;
 perform private.catalog_require_reference_head(p_catalog);
 return public.m1_save_draft(p_issue,p_expected_revision,p_content);
end$$;
alter function public.m1_get_draft(uuid) rename to m1_get_draft_legacy;
alter function public.m1_get_draft_legacy(uuid) set schema private;
revoke execute on function private.m1_get_draft_legacy(uuid) from public,anon,authenticated;
create function public.m1_get_draft(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;labels jsonb;head bigint;
begin
 perform private.m1_assert_editor();result:=private.m1_get_draft_legacy(p_issue);
 if result is null then return null;end if;
 head:=(result->>'catalog_version')::bigint;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.id),'[]') into labels from(
  select s.id,s.name,s.metadata_kind,s.active,private.catalog_sector_selectable(s.id,head,'SYNTHETIC') selectable
  from private.sectors s where s.id::text=result->'content'->>'primary_sector_id'
  or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(result->'content'->'impacts')='array' then result->'content'->'impacts' else '[]' end) item where item->>'sector_id'=s.id::text)
  order by s.id limit 64
 )page;
 return result||jsonb_build_object('sector_labels',labels);
end$$;
grant execute on function public.catalog_editor_group(uuid,bigint),public.catalog_editor_membership(uuid,bigint),public.catalog_save_draft(uuid,bigint,jsonb,bigint),public.m1_get_draft(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
