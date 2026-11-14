begin;
-- Catalog metadata origin is independent from article execution/sample mode.
do $$begin
 if exists(select 1 from private.sectors where sample_kind<>'SYNTHETIC') then raise exception 'CATALOG_BACKFILL_REQUIRES_REVIEW';end if;
end$$;
alter table private.sectors add column metadata_kind text not null default 'SYNTHETIC_FIXTURE';
alter table private.sectors add column catalog_kind text not null default 'LEAF' check(catalog_kind in ('PARENT','LEAF'));
alter table private.sectors alter column sample_kind drop not null;
alter table private.sectors add constraint sector_metadata_grade check(
 (metadata_kind='SYNTHETIC_FIXTURE' and sample_kind is not null and sample_kind='SYNTHETIC') or
 (metadata_kind='USER_REFERENCE_UNVERIFIED' and sample_kind is null));
alter table private.subgroups add column metadata_kind text not null default 'SYNTHETIC_FIXTURE'
 check(metadata_kind in ('SYNTHETIC_FIXTURE','USER_REFERENCE_UNVERIFIED'));
alter table private.subgroups add constraint catalog_subgroup_parent_unique unique(id,sector_id);

create table private.catalog_head (
 singleton boolean primary key default true check(singleton),
 version bigint not null references private.catalog_versions(version)
);
insert into private.catalog_head(singleton,version) select true,version from private.catalog_versions where active;
create table private.catalog_snapshots (
 version bigint primary key references private.catalog_versions(version),
 usage_scope text not null check(usage_scope in ('LEGACY_FIXTURE','LOCAL_REFERENCE')),
 document jsonb not null, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now()
);
create table private.catalog_approvals (
 version bigint primary key references private.catalog_snapshots(version),
 state text not null check(state in ('APPROVED','REVOKED'))
);
create table private.catalog_version_sectors (
 version bigint not null references private.catalog_versions(version),
 sector_id uuid not null references private.sectors(id), active boolean not null,
 catalog_kind text not null, metadata_kind text not null,
 primary key(version,sector_id)
);
create table private.catalog_source_companies (
 id uuid primary key, name text not null check(length(trim(name)) between 1 and 200),
 search_description text not null default '' check(length(search_description)<=10000),
 direct_keywords jsonb not null default '[]' check(jsonb_typeof(direct_keywords)='array'),
 industry_keywords jsonb not null default '[]' check(jsonb_typeof(industry_keywords)='array'),
 metadata_kind text not null default 'USER_REFERENCE_UNVERIFIED' check(metadata_kind='USER_REFERENCE_UNVERIFIED'),
 stock_identity_state text not null default 'UNRESOLVED' check(stock_identity_state='UNRESOLVED'),
 stock_code text check(stock_code is null), market text check(market is null),
 active boolean not null default true, source_cell text, source_row jsonb
);
create table private.catalog_memberships (
 id uuid primary key default gen_random_uuid(), sector_id uuid not null references private.sectors(id),
 subgroup_id uuid references private.subgroups(id), source_company_ref uuid not null references private.catalog_source_companies(id),
 role text check(role is null or length(role)<=10000), display_order integer not null default 0,
 active boolean not null default true,
 foreign key(subgroup_id,sector_id) references private.subgroups(id,sector_id),
 unique nulls not distinct(sector_id,subgroup_id,source_company_ref)
);
create table private.catalog_sector_data (
 sector_id uuid primary key references private.sectors(id),
 search_mapping text, search_suffix_instruction text, keywords jsonb not null default '[]',
 foreign_companies jsonb not null default '{}', source_cell text, source_row jsonb
);
create table private.catalog_raw_imports (
 source_sha256 text primary key, registry_sha256 text not null, preview_sha256 text not null,
 source_text text not null, registry_text text not null, preview_text text not null,
 initial_version bigint not null references private.catalog_versions(version), created_at timestamptz not null default now()
);
create table private.catalog_holds (
 id uuid primary key default gen_random_uuid(), source_sha256 text not null references private.catalog_raw_imports(source_sha256),
 code text not null, source_cell text, details jsonb not null,
 state text not null default 'HOLD' check(state='HOLD')
);
create table private.catalog_operations (
 operation_key text primary key check(length(operation_key) between 1 and 200),
 actor_id uuid not null, payload_sha256 text not null, version bigint not null references private.catalog_versions(version),
 result jsonb not null, created_at timestamptz not null default now()
);
do $$declare name text;begin
 foreach name in array array['catalog_head','catalog_snapshots','catalog_approvals','catalog_version_sectors','catalog_source_companies','catalog_memberships','catalog_sector_data','catalog_raw_imports','catalog_holds','catalog_operations'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('revoke all on private.%I from public,anon,authenticated',name);
 end loop;
end$$;

create function private.catalog_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_CATALOG_RECORD';end$$;
create trigger catalog_snapshot_immutable before update or delete on private.catalog_snapshots for each row execute function private.catalog_immutable();
create trigger catalog_membership_snapshot_immutable before update or delete on private.catalog_version_sectors for each row execute function private.catalog_immutable();
create trigger catalog_raw_immutable before update or delete on private.catalog_raw_imports for each row execute function private.catalog_immutable();
create trigger catalog_operation_immutable before update or delete on private.catalog_operations for each row execute function private.catalog_immutable();
create function private.catalog_snapshot_insert_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.catalog_snapshots where version=new.version) then raise exception 'IMMUTABLE_CATALOG_RECORD';end if;
 return new;
end$$;
create trigger catalog_membership_snapshot_insert before insert on private.catalog_version_sectors for each row execute function private.catalog_snapshot_insert_guard();
create function private.catalog_membership_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from private.sectors where id=new.sector_id and catalog_kind='LEAF' and metadata_kind='USER_REFERENCE_UNVERIFIED')
 or (new.subgroup_id is not null and not exists(select 1 from private.subgroups where id=new.subgroup_id and sector_id=new.sector_id and metadata_kind='USER_REFERENCE_UNVERIFIED')) then raise exception 'INVALID_CATALOG_MEMBERSHIP';end if;
 if new.active and (not exists(select 1 from private.sectors where id=new.sector_id and active)
 or not exists(select 1 from private.catalog_source_companies where id=new.source_company_ref and active)
 or (new.subgroup_id is not null and not exists(select 1 from private.subgroups where id=new.subgroup_id and active))) then raise exception 'INACTIVE_CATALOG_MEMBERSHIP';end if;
 return new;
end$$;
create trigger catalog_membership_guard before insert or update on private.catalog_memberships for each row execute function private.catalog_membership_guard();

create function private.catalog_document() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'sectors',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'parent_id',parent_id,'display_order',display_order,'active',active,'catalog_kind',catalog_kind,'metadata_kind',metadata_kind) order by display_order,id),'[]') from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED'),
 'subgroups',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sector_id',sector_id,'name',name,'display_order',display_order,'active',active,'metadata_kind',metadata_kind) order by sector_id,display_order,id),'[]') from private.subgroups where metadata_kind='USER_REFERENCE_UNVERIFIED'),
 'companies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'search_description',search_description,'direct_keywords',direct_keywords,'industry_keywords',industry_keywords,'metadata_kind',metadata_kind,'stock_identity_state',stock_identity_state,'active',active) order by id),'[]') from private.catalog_source_companies),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sector_id',sector_id,'subgroup_id',subgroup_id,'source_company_ref',source_company_ref,'role',role,'display_order',display_order,'active',active) order by sector_id,display_order,id),'[]') from private.catalog_memberships),
 'sector_data',(select coalesce(jsonb_agg(jsonb_build_object('sector_id',sector_id,'search_mapping',search_mapping,'search_suffix_instruction',search_suffix_instruction,'keywords',keywords,'foreign_companies',foreign_companies) order by sector_id),'[]') from private.catalog_sector_data))
$$;
create function private.catalog_save_snapshot(p_version bigint) returns void language plpgsql set search_path='' as $$
declare doc jsonb;
begin
 if exists(select 1 from private.catalog_snapshots where version=p_version) then raise exception 'IMMUTABLE_CATALOG_RECORD';end if;
 insert into private.catalog_version_sectors(version,sector_id,active,catalog_kind,metadata_kind)
 select p_version,id,active,catalog_kind,metadata_kind from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED';
 doc:=private.catalog_document();
 insert into private.catalog_snapshots(version,usage_scope,document,sha256)
 values(p_version,'LOCAL_REFERENCE',doc,encode(extensions.digest(convert_to(doc::text,'UTF8'),'sha256'),'hex'));
 insert into private.catalog_approvals(version,state) values(p_version,'APPROVED');
end$$;
-- Preserve the exact pre-import fixture catalog for historical article checks.
insert into private.catalog_version_sectors(version,sector_id,active,catalog_kind,metadata_kind)
select h.version,s.id,s.active,s.catalog_kind,s.metadata_kind from private.catalog_head h cross join private.sectors s where s.catalog_version=h.version;
insert into private.catalog_snapshots(version,usage_scope,document,sha256)
select h.version,'LEGACY_FIXTURE',d.doc,encode(extensions.digest(convert_to(d.doc::text,'UTF8'),'sha256'),'hex')
from private.catalog_head h cross join lateral (select jsonb_build_object('sectors',coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'active',s.active) order by s.id),'[]')) doc from private.sectors s where s.catalog_version=h.version) d;
insert into private.catalog_approvals(version,state) select version,'APPROVED' from private.catalog_snapshots;

create function private.catalog_sector_selectable(p_sector uuid,p_catalog bigint,p_article_mode text) returns boolean language sql stable set search_path='' as $$
 select p_article_mode='SYNTHETIC'
 and exists(select 1 from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null)
 and exists(select 1 from private.catalog_head h join private.catalog_versions v on v.version=h.version and v.active
 join private.catalog_approvals a on a.version=h.version and a.state='APPROVED'
 join private.catalog_snapshots c on c.version=h.version
 join private.catalog_version_sectors m on m.version=h.version and m.sector_id=p_sector and m.active and m.catalog_kind='LEAF'
 join private.sectors s on s.id=m.sector_id and s.active and s.catalog_kind='LEAF' and s.catalog_version=h.version
 where h.version=p_catalog and
 ((c.usage_scope='LOCAL_REFERENCE' and m.metadata_kind='USER_REFERENCE_UNVERIFIED' and s.metadata_kind='USER_REFERENCE_UNVERIFIED' and s.sample_kind is null)
 or (c.usage_scope='LEGACY_FIXTURE' and m.metadata_kind='SYNTHETIC_FIXTURE' and s.metadata_kind='SYNTHETIC_FIXTURE' and s.sample_kind='SYNTHETIC')))
$$;
create function private.catalog_version_sector_allowed(p_catalog bigint,p_sector uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.catalog_approvals a
 join private.catalog_version_sectors m on m.version=a.version and m.sector_id=p_sector and m.active and m.catalog_kind='LEAF'
 join private.sectors s on s.id=m.sector_id and s.active
 where a.version=p_catalog and a.state='APPROVED')
$$;
-- v1 reads retain the original three IDs and envelope. New reference names never join this set.
create or replace function public.m1_public_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description) order by display_order,id),'[]')
 from private.sectors where active and metadata_kind='SYNTHETIC_FIXTURE' and sample_kind='SYNTHETIC'
 and id=any(array['51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000003']::uuid[])
$$;
create or replace function public.m1_editor_catalog() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();return public.m1_public_catalog();end$$;
notify pgrst,'reload schema';
commit;
