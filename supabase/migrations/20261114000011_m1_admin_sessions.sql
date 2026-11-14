begin;
create table private.admin_memberships (
  user_id uuid primary key references auth.users(id), active boolean not null default false,
  updated_at timestamptz not null default now()
);
create table private.admin_sessions (
  capability_hash text primary key check(capability_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id), auth_session_id uuid not null references auth.sessions(id),
  ciphertext text not null check(length(ciphertext) between 20 and 32768),
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
alter table private.admin_memberships enable row level security;
alter table private.admin_sessions enable row level security;
revoke all on private.admin_memberships,private.admin_sessions from public,anon,authenticated;

create function private.active_admin_user(p_user uuid,p_session uuid) returns boolean language sql stable set search_path='' as $$
  select p_user is not null and p_session is not null and exists(
    select 1 from auth.users u join auth.sessions a on a.user_id=u.id
    join private.admin_memberships m on m.user_id=u.id and m.active
    where u.id=p_user and a.id=p_session and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now())
    and u.raw_app_meta_data->>'app_role'='admin'
    and (a.not_after is null or a.not_after>now())
  )
$$;
create or replace function private.is_admin() returns boolean language plpgsql stable set search_path='' as $$
declare c jsonb;u uuid;s uuid;
begin
  if private.caller_role()<>'authenticated' then return false;end if;
  c:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  if coalesce(c->>'sub','')!~'^[0-9a-f-]{36}$' or coalesce(c->>'session_id','')!~'^[0-9a-f-]{36}$' then return false;end if;
  begin u:=(c->>'sub')::uuid;s:=(c->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
  return private.active_admin_user(u,s) and exists(select 1 from private.admin_sessions x
    where x.user_id=u and x.auth_session_id=s and x.revoked_at is null and x.expires_at>now());
end$$;

create function public.m1_open_admin_session(p_user uuid,p_auth_session uuid,p_hash text,p_ciphertext text,p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_server();perform private.assert_initialized();
  if not private.active_admin_user(p_user,p_auth_session) then raise exception 'ADMIN_SESSION_FORBIDDEN' using errcode='42501';end if;
  if p_hash is null or p_hash!~'^[0-9a-f]{64}$' or p_ciphertext is null or length(p_ciphertext) not between 20 and 32768
    or p_expires is null or p_expires<=now() or p_expires>now()+interval '8 hours' then raise exception 'INVALID_ADMIN_SESSION';end if;
  insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at)
    values(p_hash,p_user,p_auth_session,p_ciphertext,p_expires);
  insert into private.audits(actor_id,action,entity_id) values(p_user::text,'ADMIN_SESSION_OPEN',p_auth_session::text);
  return jsonb_build_object('created',true,'expires_at',p_expires);
end$$;
create function public.m1_read_admin_session(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.admin_sessions;
begin
  perform private.assert_server();perform private.assert_initialized();
  select * into s from private.admin_sessions where capability_hash=p_hash and revoked_at is null and expires_at>now();
  if not found or not private.active_admin_user(s.user_id,s.auth_session_id) then return null;end if;
  return jsonb_build_object('ciphertext',s.ciphertext,'user_id',s.user_id,'auth_session_id',s.auth_session_id,'expires_at',s.expires_at);
end$$;
create function public.m1_close_admin_session(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.admin_sessions;
begin
  perform private.assert_server();perform private.assert_initialized();
  update private.admin_sessions set revoked_at=coalesce(revoked_at,now()) where capability_hash=p_hash returning * into s;
  if found then insert into private.audits(actor_id,action,entity_id) values(s.user_id::text,'ADMIN_SESSION_CLOSE',s.auth_session_id::text);end if;
  return jsonb_build_object('closed',true);
end$$;
create function public.m1_check_editor() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.assert_initialized();if not private.is_admin() then raise exception 'EDITOR_ONLY' using errcode='42501';end if;
return jsonb_build_object('admin',true,'sample_kind','SYNTHETIC');end$$;
grant execute on function public.m1_open_admin_session(uuid,uuid,text,text,timestamptz),public.m1_read_admin_session(text),public.m1_close_admin_session(text) to service_role;
grant execute on function public.m1_check_editor() to authenticated;
notify pgrst,'reload schema';
commit;
