-- Minimal Supabase surface for applying supabase/migrations to a plain local
-- PostgreSQL 16 (no Docker). Development/test only: roles, extensions schema and
-- the auth objects the migrations reference. Never apply to a hosted project.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
 if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator nologin; end if;
end$$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create schema if not exists auth;
create table if not exists auth.users(
  id uuid primary key, email text, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean default false, email_confirmed_at timestamptz,
  created_at timestamptz default now()
);
create table if not exists auth.sessions(
  id uuid primary key, user_id uuid references auth.users(id) on delete cascade, created_at timestamptz default now(), not_after timestamptz, aal text
);
create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create or replace function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
