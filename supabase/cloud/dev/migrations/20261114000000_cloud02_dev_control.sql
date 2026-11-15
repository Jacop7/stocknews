-- CLOUD02: DEV ONLY. Verify dashboard org and project before one execution.
-- Expected org qfzgicohgpuogehdyzfx / project nxfpfvsdwbziowkxsxnh.
-- No credentials, public objects, extensions, cron, or app data.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';
select pg_advisory_xact_lock(71002, 1);
do $guard$
begin
  if current_user <> 'postgres' or current_database() <> 'postgres'
     or not exists(select 1 from pg_roles where rolname=current_user and rolbypassrls) then
    raise exception 'CLOUD02_ADMIN_TARGET_REQUIRED';
  end if;
  if exists(select 1 from pg_namespace where nspname in ('private','judoju_control'))
     or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind in ('r','p','v','m','f'))
     or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and not exists(select 1 from pg_depend d
         where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
       and not (p.proname='rls_auto_enable' and p.pronargs=0
         and p.prorettype='event_trigger'::regtype and p.proowner='postgres'::regrole)) then
    raise exception 'CLOUD02_EMPTY_TARGET_REQUIRED';
  end if;
end
$guard$;
create schema judoju_control authorization postgres;
revoke all on schema judoju_control from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema judoju_control revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema judoju_control revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema judoju_control revoke execute on functions from public, anon, authenticated, service_role;
create table judoju_control.environment_identity (
  singleton boolean primary key default true check(singleton),
  product_id text not null check(product_id='judoju-news'),
  environment text not null check(environment='dev'),
  organization_ref text not null check(organization_ref='qfzgicohgpuogehdyzfx'),
  project_ref text not null check(project_ref='nxfpfvsdwbziowkxsxnh'),
  baseline_commit text not null check(baseline_commit='94ac7e0c63d51cb646c9406992c26aafccaca0ef'),
  stage text not null check(stage='CLOUD02_CONTROL_ONLY'),
  created_at timestamptz not null default now()
);
alter table judoju_control.environment_identity enable row level security;
alter table judoju_control.environment_identity force row level security;
revoke all on table judoju_control.environment_identity from public, anon, authenticated, service_role;
insert into judoju_control.environment_identity
  (product_id,environment,organization_ref,project_ref,baseline_commit,stage)
values ('judoju-news','dev','qfzgicohgpuogehdyzfx','nxfpfvsdwbziowkxsxnh',
  '94ac7e0c63d51cb646c9406992c26aafccaca0ef','CLOUD02_CONTROL_ONLY');
commit;
