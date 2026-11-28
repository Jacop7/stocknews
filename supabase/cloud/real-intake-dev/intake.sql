-- CLOUD13 S3: the AI intake role and its two functions (docs/publish-stage2-plan.md S3). Run in the Supabase SQL Editor
-- (postgres) after CLOUD13 apply.sql, in one transaction. The role is created without login; the password step (S4,
-- scripts/ops/ai-intake-online.ps1 set-password) turns login on. Tested locally by scripts/test-ai-intake-sql.mjs.
begin;
set local statement_timeout='60s';
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtext('judoju-cloud-schema-change'));
-- guard:begin
do $guard$
begin
  if current_user<>'postgres' then raise exception 'INTAKE_POSTGRES_REQUIRED';end if;
  if (select count(*) from judoju_control.environment_identity)<>1
    or (select to_jsonb(x)->>'environment' from judoju_control.environment_identity x) is distinct from 'dev'
    or (select to_jsonb(x)->>'project_ref' from judoju_control.environment_identity x) is distinct from 'nxfpfvsdwbziowkxsxnh' then raise exception 'INTAKE_ENVIRONMENT';end if;
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261128000108') then raise exception 'INTAKE_CLOUD13_REQUIRED';end if;
end$guard$;
-- guard:end
do $pre$
begin
  if exists(select 1 from pg_roles where rolname='judoju_ai_intake') then raise exception 'INTAKE_ROLE_EXISTS';end if;
  if exists(select 1 from pg_namespace where nspname='ai_intake') then raise exception 'INTAKE_SCHEMA_EXISTS';end if;
  if to_regprocedure('private.ai_ingest_draft(text,jsonb)') is null or to_regprocedure('private.ai_withdraw_draft(text,integer,text)') is null then raise exception 'INTAKE_INBOX_MISSING';end if;
end$pre$;

create role judoju_ai_intake nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2;
alter role judoju_ai_intake set statement_timeout='10s';
alter role judoju_ai_intake set idle_in_transaction_session_timeout='10s';
alter role judoju_ai_intake set search_path='';

create schema ai_intake authorization postgres;
revoke all on schema ai_intake from public;
grant usage on schema ai_intake to judoju_ai_intake;

-- Withdrawal receipts: the same effect key always returns the first committed answer; a different request under the
-- same key is refused. Identifiers only (AI issue id, version, reason); removed after 90 days by the daily cleanup.
create table private.ai_withdraw_receipts(
  effect_key text primary key check (effect_key ~ '^ai-withdraw:[0-9a-f-]{36}:[1-9][0-9]{0,8}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.ai_withdraw_receipts enable row level security;
revoke all on table private.ai_withdraw_receipts from public, anon, authenticated, service_role;

create function ai_intake.submit(p_effect_key text, p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  -- Inside a definer function current_user is the owner; the caller's login is session_user.
  if session_user<>'judoju_ai_intake' then raise exception 'AI_INTAKE_CALLER';end if;
  if p_effect_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'AI_INTAKE_INVALID';end if;
  if octet_length(p_payload::text)>262144 then raise exception 'AI_INTAKE_TOO_LARGE';end if;
  return private.ai_ingest_draft(p_effect_key,p_payload);
end$$;

create function ai_intake.withdraw(p_effect_key text, p_ai_issue text, p_version integer, p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare h text;r private.ai_withdraw_receipts;result jsonb;
begin
  if session_user<>'judoju_ai_intake' then raise exception 'AI_INTAKE_CALLER';end if;
  if p_ai_issue is null or p_version is null or p_effect_key is distinct from 'ai-withdraw:'||p_ai_issue||':'||p_version then raise exception 'AI_INTAKE_KEY_MISMATCH';end if;
  h:=encode(sha256(convert_to(jsonb_build_array(p_ai_issue,p_version,p_reason)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtext('ai-withdraw-key:'||p_effect_key));
  select * into r from private.ai_withdraw_receipts where effect_key=p_effect_key;
  if found then
    if r.request_sha256<>h then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
    return r.result||'{"replayed":true}'::jsonb;
  end if;
  result:=private.ai_withdraw_draft(p_ai_issue,p_version,p_reason);
  insert into private.ai_withdraw_receipts(effect_key,request_sha256,result) values(p_effect_key,h,result);
  return result;
end$$;

-- Daily cleanup (S6 schedules it): the inbox's 30-day cleanup and 90-day-old withdrawal receipts.
create function private.ai_intake_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
declare inbox jsonb;n integer;
begin
  if current_user<>'postgres' then raise exception 'AI_INBOX_POSTGRES_ONLY';end if;
  inbox:=to_jsonb(private.ai_inbox_cleanup());
  delete from private.ai_withdraw_receipts where created_at<now()-interval '90 days';
  get diagnostics n=row_count;
  return jsonb_build_object('inbox',inbox,'withdraw_receipts_deleted',n);
end$$;

revoke all on function ai_intake.submit(text,jsonb) from public, anon, authenticated, service_role;
revoke all on function ai_intake.withdraw(text,text,integer,text) from public, anon, authenticated, service_role;
revoke all on function private.ai_intake_cleanup() from public, anon, authenticated, service_role;
grant execute on function ai_intake.submit(text,jsonb) to judoju_ai_intake;
grant execute on function ai_intake.withdraw(text,text,integer,text) to judoju_ai_intake;

do $post$
declare got jsonb;
begin
  -- Role: no login yet, no inheritance, no memberships, limits and settings exact.
  if (select jsonb_build_object('login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createdb',rolcreatedb,'createrole',rolcreaterole,
        'replication',rolreplication,'bypassrls',rolbypassrls,'connlimit',rolconnlimit)
      from pg_roles where rolname='judoju_ai_intake')
    is distinct from '{"login":false,"inherit":false,"super":false,"createdb":false,"createrole":false,"replication":false,"bypassrls":false,"connlimit":2}'::jsonb
    then raise exception 'INTAKE_POST_ROLE';end if;
  if exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='judoju_ai_intake')
    -- PostgreSQL 16+ makes the creating role an admin member of the new role; nobody else may be.
    or exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid where r.rolname='judoju_ai_intake' and pg_get_userbyid(m.member) not in ('postgres','supabase_admin'))
    then raise exception 'INTAKE_POST_MEMBERSHIP';end if;
  if (select array_agg(c order by c) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole, unnest(s.setconfig) c where r.rolname='judoju_ai_intake' and s.setdatabase=0)
    is distinct from array['idle_in_transaction_session_timeout=10s','search_path=""','statement_timeout=10s'] then raise exception 'INTAKE_POST_SETTINGS';end if;
  -- Functions: owner postgres, security definer, empty search path.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ai_intake') <> 2
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ai_intake'
      and (pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then raise exception 'INTAKE_POST_FUNCTIONS';end if;
  -- Exactly two product functions are executable by the role; no product table or sequence is reachable.
  select coalesce(jsonb_agg(n.nspname||'.'||p.proname order by n.nspname||'.'||p.proname),'[]') into got from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','judoju_control','ai_intake') and p.proname<>'rls_auto_enable' and has_function_privilege('judoju_ai_intake',p.oid,'EXECUTE');
  if got is distinct from '["ai_intake.submit","ai_intake.withdraw"]'::jsonb then raise exception 'INTAKE_POST_EXECUTE %',got;end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','judoju_control','ai_intake','supabase_migrations') and c.relkind in ('r','p','v','m','S','f')
      and (has_table_privilege('judoju_ai_intake',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or (c.relkind='S' and has_sequence_privilege('judoju_ai_intake',c.oid,'USAGE,SELECT,UPDATE'))))
    then raise exception 'INTAKE_POST_TABLES';end if;
  if exists(select 1 from pg_namespace where nspname in ('private','judoju_control','supabase_migrations') and has_schema_privilege('judoju_ai_intake',oid,'USAGE')) then raise exception 'INTAKE_POST_SCHEMAS';end if;
  -- API roles cannot reach the intake functions.
  if exists(select 1 from unnest(array['anon','authenticated','service_role']) r, unnest(array['ai_intake.submit(text,jsonb)','ai_intake.withdraw(text,text,integer,text)','private.ai_intake_cleanup()']) f
      where has_function_privilege(r,f::regprocedure,'EXECUTE')) then raise exception 'INTAKE_POST_API_ROLES';end if;
end$post$;
commit;
