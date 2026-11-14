begin;
-- Navigation carries names/IDs; the selected detail carries the C-column text.
create or replace function private.catalog_tree(p_head bigint) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('catalog_version',p_head::text,'metadata_kind','USER_REFERENCE_UNVERIFIED','parents',coalesce(jsonb_agg(
 jsonb_build_object('id',parent.id,'name',parent.name,'order',parent.display_order,'sectors',
 (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'parent_id',s.parent_id,'order',s.display_order) order by s.display_order,s.id),'[]')
 from private.sectors s where s.parent_id=parent.id and private.catalog_sector_selectable(s.id,p_head,'SYNTHETIC')))
 order by parent.display_order,parent.id),'[]'))
 from private.sectors parent where parent.metadata_kind='USER_REFERENCE_UNVERIFIED' and parent.catalog_kind='PARENT' and parent.active and parent.catalog_version=p_head
$$;
create function public.catalog_public_sector_page(p_sector uuid,p_expected bigint default null,p_offset integer default 0,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;sector private.sectors;groups jsonb;page_ids uuid[];total bigint;ungrouped jsonb;
begin
 head:=private.catalog_require_reference_head(p_expected);
 if p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_PAGE_SIZE';end if;
 if not private.catalog_sector_selectable(p_sector,head,'SYNTHETIC') then return jsonb_build_object('state','NOT_FOUND','catalog_version',head::text);end if;
 select * into sector from private.sectors where id=p_sector;
 select count(*) into total from private.catalog_memberships m join private.catalog_source_companies c on c.id=m.source_company_ref and c.active where m.sector_id=p_sector and m.active;
 select coalesce(array_agg(id),'{}') into page_ids from(select m.id from private.catalog_memberships m join private.catalog_source_companies c on c.id=m.source_company_ref and c.active
 left join private.subgroups g on g.id=m.subgroup_id where m.sector_id=p_sector and m.active and (m.subgroup_id is null or g.active)
 order by coalesce(g.display_order,-1),g.id nulls first,m.display_order,m.id limit p_limit offset p_offset)page;
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'order',g.display_order,'members',
 (select coalesce(jsonb_agg(item.value order by item.n),'[]') from jsonb_array_elements(private.catalog_public_members(p_sector,g.id)) with ordinality item(value,n) where (item.value->>'membership_id')::uuid=any(page_ids))) order by g.display_order,g.id),'[]') into groups
 from private.subgroups g where g.sector_id=p_sector and g.active and g.metadata_kind='USER_REFERENCE_UNVERIFIED';
 select coalesce(jsonb_agg(item.value order by item.n),'[]') into ungrouped from jsonb_array_elements(private.catalog_public_members(p_sector,null)) with ordinality item(value,n) where (item.value->>'membership_id')::uuid=any(page_ids);
 return jsonb_build_object('state','AVAILABLE','catalog_version',head::text,'id',sector.id,'name',sector.name,'description',sector.description,'parent_id',sector.parent_id,'metadata_kind',sector.metadata_kind,
 'groups',groups,'ungrouped_members',ungrouped,'offset',p_offset,'total_memberships',total,'next_offset',case when p_offset+cardinality(page_ids)<total then p_offset+cardinality(page_ids) else null end);
end$$;
create or replace function public.catalog_public_sector(p_sector uuid,p_expected bigint default null) returns jsonb language sql stable security definer set search_path='' as $$
 select public.catalog_public_sector_page(p_sector,p_expected,0,50)
$$;
create function private.catalog_compact_terms(p_terms jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(coalesce(item.value->'raw',item.value->'value') order by item.n),'[]') from jsonb_array_elements(p_terms) with ordinality item(value,n)
$$;
create or replace function public.catalog_editor_company(p_company uuid,p_expected bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;item jsonb;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(p_expected);
 select jsonb_build_object('id',id,'name',name,'search_description',search_description,'direct_terms',private.catalog_compact_terms(direct_keywords),'industry_terms',private.catalog_compact_terms(industry_keywords),'active',active,'stock_identity_state',stock_identity_state,'metadata_kind',metadata_kind) into item from private.catalog_source_companies where id=p_company;
 if item is null then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 return jsonb_build_object('catalog_version',head::text,'company',item);
end$$;
-- Keep the paginated editor sector contract while compacting keyword entries.
alter function public.catalog_editor_sector(uuid,bigint,integer,integer) rename to catalog_editor_sector_v1;
revoke execute on function public.catalog_editor_sector_v1(uuid,bigint,integer,integer) from authenticated;
create function public.catalog_editor_sector(p_sector uuid,p_expected bigint default null,p_offset integer default 0,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;settings jsonb;terms jsonb;kind text;
begin
 perform private.m1_assert_editor();
 result:=public.catalog_editor_sector_v1(p_sector,p_expected,p_offset,p_limit);settings:='{}';
 foreach kind in array array['INDUSTRY','CORE','ADDITIONAL'] loop
  select private.catalog_compact_terms(coalesce(jsonb_agg(item.value order by item.n),'[]')) into terms from private.catalog_sector_data d cross join lateral jsonb_array_elements(d.keywords) with ordinality item(value,n) where d.sector_id=p_sector and private.catalog_keyword_kind(item.value)=kind;
  settings:=jsonb_set(settings,array[kind],terms,true);
 end loop;
 return result||jsonb_build_object('keyword_settings',settings);
end$$;
grant execute on function public.catalog_public_sector_page(uuid,bigint,integer,integer) to anon,authenticated;
grant execute on function public.catalog_editor_sector(uuid,bigint,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
