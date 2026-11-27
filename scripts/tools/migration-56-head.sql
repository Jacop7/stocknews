begin;
-- Publish stage 1A (docs/publish-stage1-plan.md, Codex plan APPROVE 2026-11-27): real-data review without any public
-- exposure. A1 switch and source-URL rule, A2 a separate real-data validator chain, the public fence, the 1A publish
-- block and the admin DTO fields. The synthetic path is unchanged.

-- A1. Real-data mode: one row, off by default, changeable only by postgres, and only on a local environment.
create table private.real_mode (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  allowed_source_hosts text[] not null,
  changed_at timestamptz not null default now(),
  note text not null default ''
);
alter table private.real_mode enable row level security;
revoke all on private.real_mode from public, anon, authenticated, service_role;
insert into private.real_mode(id, enabled, allowed_source_hosts, note)
  values (1, false, array['dart.fss.or.kr', 'kind.krx.co.kr'], 'stage 1A: official filings only');

create function private.real_mode_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>1 then raise exception 'REAL_MODE_SINGLETON';end if;
  if new.enabled and not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'REAL_MODE_LOCAL_ONLY_1A';end if;
  if cardinality(new.allowed_source_hosts) not between 1 and 20
    or exists(select 1 from unnest(new.allowed_source_hosts) h where h is null or h!~'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or length(h)>253) then raise exception 'REAL_MODE_HOSTS_INVALID';end if;
  new.changed_at:=now();
  return new;
end$$;
create trigger real_mode_guard before insert or update on private.real_mode for each row execute function private.real_mode_guard();

create function private.real_mode_on() returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.real_mode where id=1 and enabled)
     and exists(select 1 from private.runtime_identity where environment='local')
$$;

-- Source URLs of real articles: https, no userinfo or port, an exactly listed lowercase host (no subdomain matching,
-- no trailing dot, no percent-encoding in the authority), no whitespace, control characters or backslashes.
create function private.real_source_url_ok(p_url text) returns boolean language plpgsql stable set search_path='' as $$
declare m text[];
begin
  if p_url is null or length(p_url) not between 9 and 2000 or p_url ~ '[[:space:][:cntrl:]\\]' then return false;end if;
  m:=regexp_match(p_url,'^https://([^/?#]*)([/?#].*)?$');
  if m is null or m[1]!~'^[a-z0-9.-]+$' or m[1] like '%.' then return false;end if;
  return coalesce((select m[1]=any(r.allowed_source_hosts) from private.real_mode r where r.id=1),false);
end$$;

revoke all on function private.real_mode_guard(), private.real_mode_on(), private.real_source_url_ok(text) from public, anon, authenticated, service_role;
