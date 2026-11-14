begin;
-- Additive only: SQL30's catalog lock order and automatic sector cleanup remain intact.
alter table private.installation_settings add column settings_revision bigint not null default 1 check(settings_revision>0);
create table private.installation_setting_changes (
 id uuid primary key default gen_random_uuid(),
 installation_id uuid not null references private.installations(id),
 settings_revision bigint not null,
 reason text not null check(reason in ('SETTINGS_CHANGED','INACTIVE_SECTOR_REMOVED')),
 removed_sectors jsonb not null default '[]',
 occurred_at timestamptz not null default clock_timestamp()
);
alter table private.installation_setting_changes enable row level security;
create index installation_changes_owner_time on private.installation_setting_changes(installation_id,occurred_at desc);
create function private.installation_settings_revision() returns trigger language plpgsql set search_path='' as $$
declare removed jsonb;
begin
 if row(new.morning_issue,new.closing_issue,new.favorite_sector_issue,new.sector_ids)
  is not distinct from row(old.morning_issue,old.closing_issue,old.favorite_sector_issue,old.sector_ids) then
  new.settings_revision:=old.settings_revision;return new;
 end if;
 new.settings_revision:=old.settings_revision+1;new.updated_at:=clock_timestamp();
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by u.n),'[]') into removed
 from unnest(old.sector_ids) with ordinality u(id,n) join private.sectors s on s.id=u.id
 where not u.id=any(new.sector_ids) and not s.active;
 insert into private.installation_setting_changes(installation_id,settings_revision,reason,removed_sectors)
 values(new.installation_id,new.settings_revision,case when jsonb_array_length(removed)>0 then 'INACTIVE_SECTOR_REMOVED' else 'SETTINGS_CHANGED' end,removed);
 return new;
end$$;
create trigger installation_settings_revision before update on private.installation_settings
 for each row execute function private.installation_settings_revision();
create function private.installation_settings_json(p_install uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('morning_issue',s.morning_issue,'closing_issue',s.closing_issue,
 'favorite_sector_issue',s.favorite_sector_issue,'sector_ids',s.sector_ids,'settings_revision',s.settings_revision,
 'catalog_version',(select version from private.catalog_head where singleton))
 from private.installation_settings s where installation_id=p_install
$$;
create function public.installation_settings_save(p_install uuid,p_secret text,p_version integer,p_catalog bigint,p_revision bigint,
 p_morning boolean,p_closing boolean,p_favorite boolean,p_sectors uuid[]) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare h bigint;v_settings private.installation_settings;
begin
 perform private.assert_server();perform private.assert_initialized();
 select version into h from private.catalog_head where singleton for share;
 perform private.assert_installation(p_install,p_secret,p_version);
 select * into strict v_settings from private.installation_settings where installation_id=p_install for update;
 if p_catalog is distinct from h or p_revision is distinct from v_settings.settings_revision then raise exception 'SETTINGS_CONFLICT';end if;
 if p_morning is null or p_closing is null or p_favorite is null or p_sectors is null or cardinality(p_sectors)>56
 or cardinality(p_sectors)<>(select count(distinct x) from unnest(p_sectors) x) then raise exception 'INVALID_SETTINGS';end if;
 if exists(select 1 from unnest(p_sectors) x where not exists(select 1 from private.sectors s
  join private.sectors parent on parent.id=s.parent_id and parent.active
  where s.id=x and s.active and s.catalog_kind='LEAF' and s.metadata_kind='USER_REFERENCE_UNVERIFIED')) then raise exception 'INACTIVE_SECTOR';end if;
 update private.installation_settings set morning_issue=p_morning,closing_issue=p_closing,
 favorite_sector_issue=p_favorite,sector_ids=p_sectors where installation_id=p_install;
 return private.installation_settings_json(p_install);
end$$;
create function public.installation_settings_read(p_install uuid,p_secret text,p_version integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
 return jsonb_build_object('settings',private.installation_settings_json(p_install),'history',coalesce((select jsonb_agg(x order by x.occurred_at desc) from
  (select settings_revision,reason,removed_sectors,occurred_at from private.installation_setting_changes
   where installation_id=p_install and occurred_at>clock_timestamp()-interval '30 days' order by occurred_at desc limit 100) x),'[]'),
 'notifications',coalesce((select jsonb_agg(x order by x.cutoff desc) from
  (select d.id,d.issue_id,d.notification_type,d.cutoff from private.notification_deliveries d
   where d.installation_id=p_install and d.status='DELIVERED' order by d.cutoff desc limit 100) x),'[]'),
 'mode','LOCAL_QA','push_enabled',false);
end$$;
revoke all on private.installation_setting_changes from public,anon,authenticated;
revoke execute on function public.installation_settings_save(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]),
 public.installation_settings_read(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.installation_settings_save(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]),
 public.installation_settings_read(uuid,text,integer) to service_role;
commit;
