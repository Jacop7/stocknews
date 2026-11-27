begin;
-- Publish stage 1B (docs/publish-stage1b-plan.md rev 3.1, Codex plan APPROVE 2026-11-27): local real-data publishing
-- and the review read mode. B1 the public-kind switch, B2 the public read paths (generated), B3 the real publisher
-- (generated), B4 withdrawal and expiry of published real articles, B7 admin fields. Exactly one kind is public at a time.

-- B1. Public-kind switch: off by default; like `enabled`, only postgres can change it and only on a local environment.
alter table private.real_mode add column public_read_enabled boolean not null default false;

create or replace function private.real_mode_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>1 then raise exception 'REAL_MODE_SINGLETON';end if;
  if new.enabled and not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'REAL_MODE_LOCAL_ONLY_1A';end if;
  if new.public_read_enabled and not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'REAL_PUBLIC_READ_LOCAL_ONLY_1B';end if;
  if cardinality(new.allowed_source_hosts) not between 1 and 20
    or exists(select 1 from unnest(new.allowed_source_hosts) h where h is null or h!~'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or length(h)>253) then raise exception 'REAL_MODE_HOSTS_INVALID';end if;
  new.changed_at:=now();
  return new;
end$$;

-- The one kind every public read returns. Real articles are public only while real mode itself is on (local only).
create function private.public_read_kind() returns private.sample_kind language sql stable set search_path='' as $$
  select case when private.real_mode_on() and exists(select 1 from private.real_mode where id=1 and public_read_enabled)
    then 'PERMITTED_REAL'::private.sample_kind else 'SYNTHETIC'::private.sample_kind end
$$;

-- The public identity says which kind is public, so a reader for one kind refuses to serve the other.
create or replace function public.m1_public_identity() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('productId',product_id,'environment',environment,
    'sampleKind',case when private.public_read_kind()='PERMITTED_REAL' then 'REVIEW_REAL' else 'SYNTHETIC' end,'bootstrapId',bootstrap_id,
    'contract',case when private.public_read_kind()='PERMITTED_REAL' then 'M1R' else 'M1' end)
  from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null
$$;
