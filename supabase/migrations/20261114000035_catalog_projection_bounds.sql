begin;
-- Bounded editor replacements do not rewrite any preserved source entries.
create or replace function private.catalog_terms(p_terms jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare term jsonb;result jsonb:='[]';label text;
begin
 if jsonb_typeof(p_terms) is distinct from 'array' or jsonb_array_length(p_terms)>200 or octet_length(p_terms::text)>16384 then raise exception 'INVALID_CATALOG_KEYWORDS';end if;
 for term in select value from jsonb_array_elements(p_terms) loop
  if jsonb_typeof(term)<>'string' then raise exception 'INVALID_CATALOG_KEYWORDS';end if;
  label:=private.catalog_label(term#>>'{}',100);
  if label~E'[\n\r]' then raise exception 'INVALID_CATALOG_KEYWORDS';end if;
  result:=result||jsonb_build_array(jsonb_build_object('raw',term#>>'{}','value',btrim(term#>>'{}'),'comparisonKey',label,'origin','ADMIN'));
 end loop;
 return result;
end$$;
create or replace function public.catalog_public_sector_page(p_sector uuid,p_expected bigint default null,p_offset integer default 0,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 from private.subgroups g where g.sector_id=p_sector and g.active and g.metadata_kind='USER_REFERENCE_UNVERIFIED' and exists(select 1 from private.catalog_memberships m where m.subgroup_id=g.id and m.id=any(page_ids));
 select coalesce(jsonb_agg(item.value order by item.n),'[]') into ungrouped from jsonb_array_elements(private.catalog_public_members(p_sector,null)) with ordinality item(value,n) where (item.value->>'membership_id')::uuid=any(page_ids);
 return jsonb_build_object('state','AVAILABLE','catalog_version',head::text,'id',sector.id,'name',sector.name,'description',sector.description,'parent_id',sector.parent_id,'metadata_kind',sector.metadata_kind,
 'groups',groups,'ungrouped_members',ungrouped,'offset',p_offset,'total_memberships',total,'next_offset',case when p_offset+cardinality(page_ids)<total then p_offset+cardinality(page_ids) else null end);
end$$;

create function private.catalog_projected_bounds() returns void language plpgsql set search_path='' as $$
begin
 if (select count(*) from private.sectors where active and metadata_kind='USER_REFERENCE_UNVERIFIED' and catalog_kind='PARENT')>50
 or (select count(*) from private.sectors where active and metadata_kind='USER_REFERENCE_UNVERIFIED' and catalog_kind='LEAF')>200
 or exists(select 1 from private.subgroups where metadata_kind='USER_REFERENCE_UNVERIFIED' group by sector_id having count(*)>100)
 or exists(select 1 from private.catalog_memberships group by sector_id having count(*)>2000) then raise exception 'CATALOG_ENTITY_LIMIT';end if;
end$$;
alter function private.catalog_finish_version(bigint) rename to catalog_finish_version_v1;
create function private.catalog_finish_version(p_previous bigint) returns bigint language plpgsql set search_path='' as $$
begin perform private.catalog_projected_bounds();return private.catalog_finish_version_v1(p_previous);end$$;
notify pgrst,'reload schema';
commit;
