-- CLOUD03_GUARD_START: dev only, prior verified control identity required.
set local lock_timeout='2s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(71003,1);
do $guard$
begin
 if current_user<>'postgres' or current_database()<>'postgres'
   or not exists(select 1 from pg_roles where rolname=current_user and rolbypassrls) then
   raise exception 'CLOUD03_ADMIN_REQUIRED';
 end if;
 if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
   where e.extname='pgcrypto' and n.nspname='extensions') then
   raise exception 'CLOUD03_PGCRYPTO_BASELINE_REQUIRED';
 end if;
 if to_regclass('judoju_control.environment_identity') is null then
   raise exception 'CLOUD03_VERIFIED_DEV_CONTROL_REQUIRED';
 end if;
 if (select count(*) from judoju_control.environment_identity)<>1
   or not exists(select 1 from judoju_control.environment_identity where singleton
     and product_id='judoju-news' and environment='dev'
     and project_ref='nxfpfvsdwbziowkxsxnh' and organization_ref='qfzgicohgpuogehdyzfx'
     and baseline_commit='94ac7e0c63d51cb646c9406992c26aafccaca0ef' and stage='CLOUD02_CONTROL_ONLY') then
   raise exception 'CLOUD03_DEV_IDENTITY_MISMATCH';
 end if;
 if to_regnamespace('private') is not null or to_regclass('judoju_control.schema_artifacts') is not null
   or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','p','v','m','f'))
   or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
     and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
     and not(p.proname='rls_auto_enable' and p.pronargs=0 and p.prorettype='event_trigger'::regtype and p.proowner='postgres'::regrole)) then
   raise exception 'CLOUD03_EMPTY_FOUNDATION_REQUIRED';
 end if;
end
$guard$;
-- CLOUD03_GUARD_END
