begin;
create function private.catalog_description(p_text text,p_max_chars integer default 2000,p_max_bytes integer default 6000) returns text language plpgsql immutable set search_path='' as $$
begin
 if p_text is null or length(p_text)>p_max_chars or octet_length(p_text)>p_max_bytes then raise exception 'INVALID_CATALOG_TEXT';end if;
 return p_text;
end$$;
create function private.catalog_diff(p_before jsonb,p_after jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare collection text;delta jsonb;result jsonb:='{}';
begin
 foreach collection in array array['sectors','subgroups','companies','memberships','sector_data'] loop
  select jsonb_agg(jsonb_build_object('id',coalesce(previous.id,current.id),'before',previous.data,'after',current.data) order by coalesce(previous.id,current.id)) into delta
  from (select coalesce(entry.value->>'id',entry.value->>'sector_id') id,entry.value data from jsonb_array_elements(coalesce(p_before->collection,'[]')) entry) previous
  full join (select coalesce(entry.value->>'id',entry.value->>'sector_id') id,entry.value data from jsonb_array_elements(coalesce(p_after->collection,'[]')) entry) current using(id)
  where previous.data is distinct from current.data;
  if delta is not null then result:=jsonb_set(result,array[collection],delta,true);end if;
 end loop;
 return result;
end$$;
create function private.catalog_finish_version(p_previous bigint) returns bigint language plpgsql set search_path='' as $$
declare current_head bigint;next_version bigint;
begin
 select version into current_head from private.catalog_head where singleton for update;
 if current_head is distinct from p_previous then raise exception 'STALE_CATALOG';end if;
 select coalesce(max(version),0)+1 into next_version from private.catalog_versions;
 update private.catalog_versions set active=false where active;
 insert into private.catalog_versions(version,active) values(next_version,true);
 update private.sectors set catalog_version=next_version where metadata_kind='USER_REFERENCE_UNVERIFIED';
 update private.catalog_head set version=next_version where singleton;
 perform private.catalog_save_snapshot(next_version);
 return next_version;
end$$;
create function private.catalog_active_parent(p_parent uuid) returns void language plpgsql stable set search_path='' as $$
begin
 if p_parent is null or not exists(select 1 from private.sectors where id=p_parent and active and metadata_kind='USER_REFERENCE_UNVERIFIED' and catalog_kind='PARENT') then raise exception 'INACTIVE_CATALOG_PARENT';end if;
end$$;
create function private.catalog_active_leaf(p_sector uuid) returns void language plpgsql stable set search_path='' as $$
declare head bigint;
begin
 head:=private.catalog_require_reference_head(null);
 if not private.catalog_sector_selectable(p_sector,head,'SYNTHETIC') then raise exception 'INACTIVE_CATALOG_SECTOR';end if;
end$$;
create function public.catalog_editor_index(p_offset integer default 0,p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;items jsonb;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(null);
 if p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_PAGE_SIZE';end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.catalog_kind,page.display_order,page.id),'[]') into items from
 (select id,name,parent_id,display_order,active,catalog_kind from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED'
 order by catalog_kind,display_order,id limit p_limit offset p_offset)page;
 return jsonb_build_object('catalog_version',head::text,'actor_id',auth.uid(),'items',items,'total',(select count(*) from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED'),'offset',p_offset,'limit',p_limit);
end$$;
grant execute on function public.catalog_editor_index(integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
