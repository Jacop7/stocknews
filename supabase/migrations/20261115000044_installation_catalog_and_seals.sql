begin;
-- Keep applied SQL41/42 immutable. Require the published reference snapshot,
-- not merely an active private row which has never been published in the catalog.
alter function public.installation_settings_save(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]) rename to installation_settings_save_v1;
alter function public.installation_settings_save_v1(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]) set schema private;
create function public.installation_settings_save(p_install uuid,p_secret text,p_version integer,p_catalog bigint,p_revision bigint,
 p_morning boolean,p_closing boolean,p_favorite boolean,p_sectors uuid[]) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bigint;
begin
 perform private.assert_server();perform private.assert_initialized();
 select version into h from private.catalog_head where singleton for share;
 if p_catalog is distinct from h then raise exception 'SETTINGS_CONFLICT';end if;
 if exists(select 1 from unnest(p_sectors) x where not private.catalog_sector_selectable(x,h,'SYNTHETIC')) then raise exception 'INACTIVE_SECTOR';end if;
 return private.installation_settings_save_v1(p_install,p_secret,p_version,p_catalog,p_revision,p_morning,p_closing,p_favorite,p_sectors);
end$$;
create function private.installation_seal_minimal() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state in ('SEALED_START','SEALED_FORGOTTEN') then
  new.pending_hash:=null;new.payload_hash:=null;new.prior_generation:=null;new.installation_id:=null;
  new.prior_secret_hash:=null;new.prior_version:=null;new.result_version:=null;new.receipt_ciphertext:=null;
 end if;
 return new;
end$$;
create trigger installation_seal_minimal before insert or update on private.installation_operations
 for each row execute function private.installation_seal_minimal();
update private.installation_operations set pending_hash=null where state in ('SEALED_START','SEALED_FORGOTTEN');
revoke execute on function public.installation_settings_save(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]) from public,anon,authenticated;
grant execute on function public.installation_settings_save(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
