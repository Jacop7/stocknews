-- CLOUD11-online core hardening (H1 capability binding, H2 AAL2, H3 broker-side AAL2 in the DB, H6 revoke).
-- Included by activation.sql inside one guarded transaction; also exercised by the local DB test.

-- H1+H2: an editor call needs an aal2 JWT, an aal2 Auth session, an active admin membership and the raw session
-- capability in the x-judoju-capability request header whose SHA-256 matches an open admin session for the same
-- user and Auth session. A stolen JWT alone no longer passes. VOLATILE: re-evaluated on every call.
create or replace function private.is_admin() returns boolean language plpgsql volatile set search_path='' as $$
declare c jsonb;h jsonb;u uuid;s uuid;cap text;
begin
  if private.caller_role()<>'authenticated' then return false;end if;
  c:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  if coalesce(c->>'aal','')<>'aal2' then return false;end if;
  if coalesce(c->>'sub','')!~'^[0-9a-f-]{36}$' or coalesce(c->>'session_id','')!~'^[0-9a-f-]{36}$' then return false;end if;
  begin u:=(c->>'sub')::uuid;s:=(c->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
  begin h:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;exception when others then return false;end;
  if jsonb_typeof(h)<>'object' then return false;end if;
  cap:=h->>'x-judoju-capability';
  if cap is null or cap!~'^[A-Za-z0-9_-]{43}$' then return false;end if;
  return private.active_admin_user(u,s)
    and exists(select 1 from auth.sessions a where a.id=s and a.user_id=u and a.aal='aal2')
    and exists(select 1 from private.admin_sessions x where x.capability_hash=encode(sha256(convert_to(cap,'UTF8')),'hex')
      and x.user_id=u and x.auth_session_id=s and x.revoked_at is null and x.expires_at>now());
end$$;

-- H3: an admin session can only be opened for an Auth session that already reached aal2 (TOTP verified).
create or replace function public.m1_open_admin_session(p_user uuid,p_auth_session uuid,p_hash text,p_ciphertext text,p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_server();perform private.assert_initialized();
  if not private.active_admin_user(p_user,p_auth_session) then raise exception 'ADMIN_SESSION_FORBIDDEN' using errcode='42501';end if;
  if not exists(select 1 from auth.sessions a where a.id=p_auth_session and a.user_id=p_user and a.aal='aal2') then raise exception 'ADMIN_SESSION_AAL2_REQUIRED' using errcode='42501';end if;
  if p_hash is null or p_hash!~'^[0-9a-f]{64}$' or p_ciphertext is null or length(p_ciphertext) not between 20 and 32768
    or p_expires is null or p_expires<=now() or p_expires>now()+interval '8 hours' then raise exception 'INVALID_ADMIN_SESSION';end if;
  insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at)
    values(p_hash,p_user,p_auth_session,p_ciphertext,p_expires);
  insert into private.audits(actor_id,action,entity_id) values(p_user::text,'ADMIN_SESSION_OPEN',p_auth_session::text);
  return jsonb_build_object('created',true,'expires_at',p_expires);
end$$;

-- H6 evidence: the DB itself reports the admin authority state (service_role only). Used to confirm the revoke and
-- for the final check, without SQL access.
create or replace function public.admin_online_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare editors text[]:=array['public.m1_check_editor()','public.m1_editor_articles()','public.m1_get_draft(uuid)','public.m1_operation_status(uuid,text)',
  'public.m1_create_draft(uuid)','public.m1_save_draft(uuid,bigint,jsonb)','public.catalog_save_draft(uuid,bigint,jsonb,bigint)','public.m1_preview_draft(uuid,bigint,bigint,bigint)',
  'public.m1_publish_draft(uuid,bigint,bigint,bigint,bigint,text)','public.m1_set_state(uuid,bigint,text,text)','public.catalog_editor_sectors()','public.catalog_editor_index(integer,integer)',
  'public.catalog_editor_tree(bigint)','public.catalog_editor_sector(uuid,bigint,integer,integer)','public.catalog_editor_companies(integer,integer,text)','public.catalog_editor_company(uuid,bigint)',
  'public.catalog_editor_group(uuid,bigint)','public.catalog_editor_membership(uuid,bigint)','public.catalog_editor_impact(uuid,bigint)','public.catalog_apply(bigint,text,text,uuid,jsonb)',
  'public.catalog_operation_status(bigint,text,text,uuid,jsonb)','public.m1_adopt_ai_version(uuid,integer,bigint,text)'];
  sessions text[]:=array['public.m1_open_admin_session(uuid,uuid,text,text,timestamptz)','public.m1_read_admin_session(text)','public.m1_close_admin_session(text)'];
begin
  perform private.assert_server();
  return jsonb_build_object(
    'editorGrants',(select count(*) from unnest(editors) f where has_function_privilege('authenticated',f,'EXECUTE')),
    'sessionGrants',(select count(*) from unnest(sessions) f where has_function_privilege('service_role',f,'EXECUTE')),
    'activeMemberships',(select count(*) from private.admin_memberships where active),
    'openSessions',(select count(*) from private.admin_sessions where revoked_at is null and expires_at>now()),
    'adminAuthSessions',(select count(*) from auth.sessions s join private.admin_memberships m on m.user_id=s.user_id));
end$$;
revoke all on function public.admin_online_status() from public,anon,authenticated;
grant execute on function public.admin_online_status() to service_role;

-- H6 step 2: end every Auth session of admin users (refresh tokens cascade). Separate from step 1 by design.
create or replace function public.admin_online_signout() returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform private.assert_server();
  delete from auth.sessions s using private.admin_memberships m where s.user_id=m.user_id;
  get diagnostics n=row_count;
  insert into private.audits(actor_id,action,entity_id) values('system','ADMIN_ONLINE_SIGNOUT',n::text);
  return jsonb_build_object('authSessionsEnded',n);
end$$;
revoke all on function public.admin_online_signout() from public,anon,authenticated;
grant execute on function public.admin_online_signout() to service_role;

-- H6: emergency revoke, callable only by service_role (the broker's secret key) or the owner in the SQL Editor.
-- One transaction: remove the API EXECUTE grants, deactivate memberships, revoke every admin session.
create or replace function public.admin_online_revoke() returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform private.assert_server();
  revoke execute on function public.m1_check_editor(),public.m1_editor_articles(),public.m1_get_draft(uuid),public.m1_operation_status(uuid,text),
    public.m1_create_draft(uuid),public.m1_save_draft(uuid,bigint,jsonb),public.catalog_save_draft(uuid,bigint,jsonb,bigint),
    public.m1_preview_draft(uuid,bigint,bigint,bigint),public.m1_publish_draft(uuid,bigint,bigint,bigint,bigint,text),public.m1_set_state(uuid,bigint,text,text),
    public.catalog_editor_sectors(),public.catalog_editor_index(integer,integer),public.catalog_editor_tree(bigint),public.catalog_editor_sector(uuid,bigint,integer,integer),
    public.catalog_editor_companies(integer,integer,text),public.catalog_editor_company(uuid,bigint),public.catalog_editor_group(uuid,bigint),
    public.catalog_editor_membership(uuid,bigint),public.catalog_editor_impact(uuid,bigint),public.catalog_apply(bigint,text,text,uuid,jsonb),
    public.catalog_operation_status(bigint,text,text,uuid,jsonb),public.m1_adopt_ai_version(uuid,integer,bigint,text) from authenticated;
  revoke execute on function public.m1_open_admin_session(uuid,uuid,text,text,timestamptz),public.m1_read_admin_session(text),public.m1_close_admin_session(text) from service_role;
  update private.admin_memberships set active=false,updated_at=now() where active;
  update private.admin_sessions set revoked_at=now() where revoked_at is null;
  get diagnostics n=row_count;
  insert into private.audits(actor_id,action,entity_id) values('system','ADMIN_ONLINE_REVOKE',n::text);
  return jsonb_build_object('revoked',true,'sessionsRevoked',n)||public.admin_online_status();
end$$;
revoke all on function public.admin_online_revoke() from public,anon,authenticated;
grant execute on function public.admin_online_revoke() to service_role;
