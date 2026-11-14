begin;
create function private.assert_installation(p_install uuid,p_secret text,p_version integer) returns void language plpgsql set search_path='' as $$
begin
  if p_secret is null or length(p_secret)<>64 or not exists(select 1 from private.installations where id=p_install and secret_version=p_version and revoked_at is null and expires_at>clock_timestamp() and secret_hash=extensions.digest(convert_to(p_secret,'UTF8'),'sha256')) then raise exception 'INSTALLATION_UNAUTHORIZED' using errcode='42501';end if;
end$$;
create function public.m0_create_installation() returns jsonb language plpgsql security definer set search_path='' as $$
declare i uuid:=gen_random_uuid();secret text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  perform private.assert_server();perform private.assert_initialized();
  insert into private.installations(id,secret_hash,expires_at) values(i,extensions.digest(convert_to(secret,'UTF8'),'sha256'),clock_timestamp()+interval '1 day');
  insert into private.installation_settings(installation_id) values(i);
  return jsonb_build_object('installation_id',i,'secret',secret,'secret_version',1,'sample_kind','SYNTHETIC','notice','Server-only local capability fixture; never log this response');
end$$;
create function public.m0_get_settings(p_install uuid,p_secret text,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.installation_settings;
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  select * into strict s from private.installation_settings where installation_id=p_install;
  return jsonb_build_object('morning_issue',s.morning_issue,'closing_issue',s.closing_issue,'favorite_sector_issue',s.favorite_sector_issue,'sector_ids',s.sector_ids);
end$$;
create function public.m0_update_settings(p_install uuid,p_secret text,p_version integer,p_morning boolean,p_closing boolean,p_favorite boolean,p_sector_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  if p_morning is null or p_closing is null or p_favorite is null or p_sector_ids is null then raise exception 'SETTINGS_REQUIRED';end if;
  if exists(select 1 from unnest(p_sector_ids) id where not exists(select 1 from private.sectors where sectors.id=id and active)) then raise exception 'INACTIVE_SECTOR';end if;
  update private.installation_settings set morning_issue=p_morning,closing_issue=p_closing,favorite_sector_issue=p_favorite,sector_ids=p_sector_ids,updated_at=clock_timestamp() where installation_id=p_install;
  return public.m0_get_settings(p_install,p_secret,p_version);
end$$;
create function public.m0_rotate_installation(p_install uuid,p_secret text,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare secret text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  update private.installations set secret_hash=extensions.digest(convert_to(secret,'UTF8'),'sha256'),secret_version=secret_version+1,expires_at=clock_timestamp()+interval '1 day' where id=p_install and secret_version=p_version;
  if not found then raise exception 'INSTALLATION_UNAUTHORIZED' using errcode='42501';end if;
  return jsonb_build_object('installation_id',p_install,'secret',secret,'secret_version',p_version+1);
end$$;
create function public.m0_record_view(p_install uuid,p_secret text,p_version integer,p_issue uuid,p_event_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;event_id uuid;
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  if p_event_key is null or length(p_event_key) not between 1 and 100 then raise exception 'EVENT_KEY_REQUIRED';end if;
  r:=public.resolve_issue(p_issue);if r->>'state'<>'PUBLISHED' then raise exception 'ARTICLE_NOT_PUBLIC';end if;
  insert into private.view_events(installation_id,issue_id,event_key) values(p_install,(r->>'canonical_issue_id')::uuid,p_event_key) on conflict(installation_id,event_key) do nothing returning id into event_id;
  return jsonb_build_object('recorded',event_id is not null);
end$$;
create function public.m0_admin_view_count(p_issue uuid) returns bigint language plpgsql security definer set search_path='' as $$
begin perform private.assert_editor();perform private.assert_initialized();return(select count(*) from private.view_events where issue_id=p_issue);end$$;

-- This completes the explicit TECH_TEST -> SHADOW state action for synthetic M0 fixtures.
-- Real permission profiles remain held; no actual source collector or promotion is enabled.
create function public.m0_source_technical_result(p_endpoint text,p_permission_version text,p_adapter_version text,p_checks jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.endpoints;source private.sources;permission private.permission_profiles;k text;
begin
  perform private.assert_server();perform private.assert_initialized();
  select * into strict e from private.endpoints where id=p_endpoint for update;
  select * into strict source from private.sources where id=e.source_id;
  if source.sample_kind<>'SYNTHETIC' then raise exception 'REAL_SOURCE_TRANSITIONS_NOT_ENABLED_STAGE_4';end if;
  if e.status<>'TECH_TEST' or e.permission_version<>p_permission_version or p_adapter_version is null or e.adapter_id is null or e.adapter_version is distinct from p_adapter_version or not exists(select 1 from private.adapters where id=e.adapter_id and version=e.adapter_version and verification_state='PASSED') then raise exception 'TECH_TEST_VERSION_CONFLICT';end if;
  select * into strict permission from private.permission_profiles where id=e.permission_profile_id and version=e.permission_version;
  if permission.status<>'VERIFIED' or permission.verified_at is null or permission.verified_at>clock_timestamp() or jsonb_array_length(permission.evidence)=0 or permission.expires_at is null or permission.expires_at<=clock_timestamp() or permission.revoked_at is not null or permission.purposes->>'MACHINE_ACCESS' is distinct from 'ALLOW' or permission.purposes->>'DISCOVERY' is distinct from 'ALLOW' then raise exception 'PERMISSION_NOT_VERIFIED';end if;
  foreach k in array array['listing','detail','id','time','pagination','failure_handling'] loop
    if p_checks->k is distinct from 'true'::jsonb then raise exception 'TECH_CHECK_INCOMPLETE';end if;
  end loop;
  update private.endpoints set status='SHADOW',health_state='SHADOW_TESTING',episode_id=gen_random_uuid(),fast_retry_count=0,reprobe_count=0,low_frequency_since=null where id=e.id;
  return jsonb_build_object('state','SHADOW','action','TECH_TEST_VERIFIED_ENTER_SHADOW','live_enabled',false);
end$$;
revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on function public.m0_create_installation(),public.m0_get_settings(uuid,text,integer),public.m0_update_settings(uuid,text,integer,boolean,boolean,boolean,uuid[]),public.m0_rotate_installation(uuid,text,integer),public.m0_record_view(uuid,text,integer,uuid,text),public.m0_source_technical_result(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.m0_create_installation(),public.m0_get_settings(uuid,text,integer),public.m0_update_settings(uuid,text,integer,boolean,boolean,boolean,uuid[]),public.m0_rotate_installation(uuid,text,integer),public.m0_record_view(uuid,text,integer,uuid,text),public.m0_source_technical_result(text,text,text,jsonb) to service_role;
revoke execute on function public.m0_admin_view_count(uuid) from public,anon;
grant execute on function public.m0_admin_view_count(uuid) to authenticated,service_role;
commit;
