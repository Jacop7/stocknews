-- CLOUD03_SEAL_START: structure staged only; no application/API activation.
update private.runtime_identity set environment='preview',bootstrap_id=null where singleton;
revoke all on schema private from public,anon,authenticated,service_role;
revoke all on all tables in schema private from public,anon,authenticated,service_role;
revoke all on all sequences in schema private from public,anon,authenticated,service_role;
revoke all on public.news_public,public.news_list from public,anon,authenticated,service_role;
-- Table revocation alone does not remove explicit column grants from the source.
do $acl$
declare r record;cols text;
begin
 for r in select c.oid,n.nspname,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='private' and c.relkind in ('r','p','v','m','f')
     or n.nspname='public' and c.relname in ('news_public','news_list') loop
   select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute
     where attrelid=r.oid and attnum>0 and not attisdropped;
   if cols is not null then
     execute format('revoke all privileges (%s) on table %I.%I from public,anon,authenticated,service_role',cols,r.nspname,r.relname);
   end if;
   if r.relkind in ('r','p') then
     execute format('alter table %I.%I enable row level security',r.nspname,r.relname);
     execute format('alter table %I.%I force row level security',r.nspname,r.relname);
   end if;
 end loop;
end
$acl$;
create table judoju_control.schema_artifacts (
 version text primary key check(version='20261114000001'),
 source_path text not null check(source_path='supabase/migrations/20261114000001_m0_foundation.sql'),
 source_sha256 text not null check(source_sha256='5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa'),
 source_bytes integer not null check(source_bytes=19011),
 project_ref text not null check(project_ref='nxfpfvsdwbziowkxsxnh'),
 state text not null check(state='STAGED_DISABLED'),
 runtime_environment text not null check(runtime_environment='preview'),
 recorded_at timestamptz not null default now()
);
alter table judoju_control.schema_artifacts enable row level security;
alter table judoju_control.schema_artifacts force row level security;
revoke all on judoju_control.schema_artifacts from public,anon,authenticated,service_role;
insert into judoju_control.schema_artifacts(version,source_path,source_sha256,source_bytes,project_ref,state,runtime_environment)
values('20261114000001','supabase/migrations/20261114000001_m0_foundation.sql',
 '5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa',19011,
 'nxfpfvsdwbziowkxsxnh','STAGED_DISABLED','preview');
do $verify$
begin
 if not exists(select 1 from private.runtime_identity where singleton and product_id='judoju-news'
   and environment='preview' and bootstrap_id is null)
   or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where (n.nspname='private' or n.nspname='public' and c.relname='news_public')
       and c.relkind in ('r','p') and (not c.relrowsecurity or not c.relforcerowsecurity)) then
   raise exception 'CLOUD03_SEAL_INCOMPLETE';
 end if;
end
$verify$;
-- CLOUD03_SEAL_END
