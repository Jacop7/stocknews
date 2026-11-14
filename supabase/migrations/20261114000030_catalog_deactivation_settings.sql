begin;
-- Fixture ownership checks are unchanged; serialize interest-setting writes with
-- catalog removal before examining the installation capability.
create or replace function public.m0_update_settings(p_install uuid,p_secret text,p_version integer,p_morning boolean,p_closing boolean,p_favorite boolean,p_sector_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_server();perform private.assert_initialized();
 perform 1 from private.catalog_head where singleton for share;
 perform private.assert_installation(p_install,p_secret,p_version);
 if p_morning is null or p_closing is null or p_favorite is null or p_sector_ids is null then raise exception 'SETTINGS_REQUIRED';end if;
 if cardinality(p_sector_ids)<>(select count(distinct u.sector_id) from unnest(p_sector_ids) as u(sector_id)) then raise exception 'DUPLICATE_OR_NULL_SECTOR';end if;
 if exists(select 1 from unnest(p_sector_ids) as u(sector_id) where not exists(select 1 from private.sectors as s where s.id=u.sector_id and s.active)) then raise exception 'INACTIVE_SECTOR';end if;
 update private.installation_settings set morning_issue=p_morning,closing_issue=p_closing,favorite_sector_issue=p_favorite,sector_ids=p_sector_ids,updated_at=clock_timestamp() where installation_id=p_install;
 return public.m0_get_settings(p_install,p_secret,p_version);
end$$;
alter function private.catalog_impact(uuid) rename to catalog_impact_v1;
create function private.catalog_impact(p_sector uuid) returns jsonb language plpgsql set search_path='' as $$
declare base jsonb;affected uuid[];settings jsonb;settings_count bigint;
begin
 base:=private.catalog_impact_v1(p_sector);
 select array_agg(id order by id) into affected from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED' and (id=p_sector or parent_id=p_sector);
 select count(*),coalesce(jsonb_agg(jsonb_build_object('id',installation_id,'sector_ids',sector_ids,'updated_at',updated_at) order by installation_id),'[]') into settings_count,settings
 from private.installation_settings where sector_ids&&affected;
 -- Installation IDs participate only in the digest and never leave this function.
 return base||jsonb_build_object('interest_settings_count',settings_count,'filter_effect','Inactive choices are removed when the current catalog is loaded',
 'impact_sha256',encode(extensions.digest(convert_to(jsonb_build_array(base->>'impact_sha256',settings)::text,'UTF8'),'sha256'),'hex'));
end$$;
alter function private.catalog_edit_sector(text,uuid,jsonb,bigint) rename to catalog_edit_sector_v1;
create function private.catalog_edit_sector(p_kind text,p_entity uuid,p_payload jsonb,p_head bigint) returns uuid language plpgsql set search_path='' as $$
declare affected uuid[];result uuid;
begin
 perform 1 from private.catalog_head where singleton for update;
 if p_kind='SECTOR_DEACTIVATE' then
  select array_agg(id order by id) into affected from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED' and (id=p_entity or parent_id=p_entity);
  perform 1 from private.installation_settings where sector_ids&&affected order by installation_id for update;
 end if;
 result:=private.catalog_edit_sector_v1(p_kind,p_entity,p_payload,p_head);
 if p_kind='SECTOR_DEACTIVATE' then
  update private.installation_settings set sector_ids=array(select item from unnest(sector_ids) with ordinality ids(item,n) where not item=any(affected) order by n),updated_at=clock_timestamp() where sector_ids&&affected;
 end if;
 return result;
end$$;
commit;
