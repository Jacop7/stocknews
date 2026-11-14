begin;
create table private.installation_operations (
 generation uuid primary key,
 kind text not null check(kind in ('BOOTSTRAP','ROTATE','REVOKE')),
 state text not null check(state in ('STARTED','COMMITTED','ACKNOWLEDGED','SEALED_START','SEALED_FORGOTTEN')),
 transport text not null check(transport in ('WEB','NATIVE')),
 pending_hash bytea,
 payload_hash bytea,
 prior_generation uuid,
 installation_id uuid references private.installations(id),
 prior_secret_hash bytea,
 prior_version integer,
 result_version integer,
 receipt_ciphertext text,
 created_at timestamptz not null default clock_timestamp(),
 deadline timestamptz not null default clock_timestamp()+interval '10 minutes',
 completed_at timestamptz,
 check(state<>'STARTED' or pending_hash is not null and payload_hash is not null)
);
alter table private.installation_operations enable row level security;
create index installation_pending_owner on private.installation_operations(installation_id) where state='STARTED';
create table private.installation_lifecycle_ledger (
 id uuid primary key default gen_random_uuid(),installation_id uuid not null references private.installations(id),
 generation uuid not null references private.installation_operations(generation),
 action text not null check(action in ('CAPABILITY_CREATE','CAPABILITY_ROTATE','CAPABILITY_REVOKE')),
 occurred_at timestamptz not null default clock_timestamp(),unique(generation,action)
);
alter table private.installation_lifecycle_ledger enable row level security;
create function private.installation_hash(p text) returns bytea language sql immutable set search_path='' as $$
 select extensions.digest(convert_to(p,'UTF8'),'sha256')
$$;
create function private.installation_active(p_install uuid,p_secret text,p_version integer) returns boolean language sql volatile set search_path='' as $$
 select length(p_secret)=64 and p_secret ~ '^[0-9a-f]{64}$' and exists(select 1 from private.installations
 where id=p_install and secret_hash=private.installation_hash(p_secret) and secret_version=p_version
 and revoked_at is null and expires_at>clock_timestamp())
$$;
-- This RPC is service-only. The consumer handler uses a fixed action/field allowlist.
-- Raw secrets only cross the loopback server->DB connection, never an anonymous RPC.
create function public.installation_operation(p_action text,p_generation uuid,p_request jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare o private.installation_operations;i private.installations;inserted integer;now_at timestamptz:=clock_timestamp();
 kind text:=p_request->>'kind';transport text:=p_request->>'transport';pending text:=p_request->>'pending';
 old_id uuid:=nullif(p_request->>'installation_id','')::uuid;old_secret text:=p_request->>'secret';
 old_version integer:=nullif(p_request->>'version','')::integer;result_id uuid;v_result_version integer;
begin
 perform private.assert_server();perform private.assert_initialized();
 if p_generation is null or jsonb_typeof(p_request)<>'object' then raise exception 'INVALID_INSTALLATION_OPERATION';end if;
 if p_action in ('START','COMMIT') then perform 1 from private.catalog_head where singleton for share;end if;
 if p_action='START_SEAL' then
  insert into private.installation_operations(generation,kind,state,transport)
  values(p_generation,'BOOTSTRAP','SEALED_START','WEB') on conflict do nothing;
  select * into strict o from private.installation_operations where generation=p_generation for update;
  if o.state='STARTED' then
   update private.installation_operations set state='SEALED_START',pending_hash=null,receipt_ciphertext=null where generation=p_generation;
   o.state:='SEALED_START';
  end if;
  return jsonb_build_object('state',o.state,'generation',p_generation,'server_time',clock_timestamp(),'deadline',o.deadline);
 end if;
 if p_action='START' then
  if kind is null or kind not in ('BOOTSTRAP','ROTATE','REVOKE') or transport is null or transport not in ('WEB','NATIVE')
   or pending is null or pending !~ '^[0-9a-f]{64}$' or p_request->>'payload_hash' is null
   or p_request->>'payload_hash' !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INSTALLATION_OPERATION';end if;
  if kind='BOOTSTRAP' then
   if old_id is not null or old_secret is not null or old_version is not null then raise exception 'BOOTSTRAP_SESSION_CONFLICT';end if;
  else
   if not coalesce(private.installation_active(old_id,old_secret,old_version),false) then raise exception 'INSTALLATION_UNAUTHORIZED' using errcode='42501';end if;
   perform 1 from private.installations where id=old_id for update;
   if exists(select 1 from private.installation_operations where installation_id=old_id and state='STARTED' and deadline>now_at) then raise exception 'OPERATION_PENDING';end if;
  end if;
  insert into private.installation_operations(generation,kind,state,transport,pending_hash,payload_hash,prior_generation,installation_id,prior_secret_hash,prior_version)
  values(p_generation,kind,'STARTED',transport,private.installation_hash(pending),decode(p_request->>'payload_hash','hex'),
   nullif(p_request->>'prior_generation','')::uuid,old_id,case when old_secret is not null then private.installation_hash(old_secret) end,old_version)
  on conflict do nothing;
  get diagnostics inserted=row_count;
  select * into strict o from private.installation_operations where generation=p_generation for update;
  if inserted=0 then raise exception 'GENERATION_ALREADY_EXISTS';end if;
  return jsonb_build_object('state','STARTED','generation',p_generation,'deadline',o.deadline);
 end if;
 select * into o from private.installation_operations where generation=p_generation for update;
 if not found then return jsonb_build_object('state','NONE','generation',p_generation,'server_time',now_at);end if;
 if p_action='GENERATION_STATE' then
  return jsonb_build_object('state',o.state,'generation',p_generation,'deadline',o.deadline,'server_time',now_at);
 end if;
 if p_action='GENERATION_FORGET' then
  if o.state='SEALED_FORGOTTEN' then return jsonb_build_object('state',o.state,'generation',p_generation);end if;
  if o.state not in ('COMMITTED','ACKNOWLEDGED') or o.deadline>now_at or p_request->'confirmed' is distinct from 'true'::jsonb then raise exception 'FORGET_NOT_READY';end if;
  update private.installation_operations set state='SEALED_FORGOTTEN',pending_hash=null,receipt_ciphertext=null where generation=p_generation;
  return jsonb_build_object('state','SEALED_FORGOTTEN','generation',p_generation,'server_time',now_at);
 end if;
 if p_action not in ('STATE','COMMIT','ACK') then raise exception 'INVALID_INSTALLATION_ACTION';end if;
 if o.state in ('SEALED_START','SEALED_FORGOTTEN') then raise exception 'GENERATION_SEALED';end if;
 if pending is null or private.installation_hash(pending) is distinct from o.pending_hash then raise exception 'PENDING_COOKIE_REQUIRED' using errcode='42501';end if;
 if transport is distinct from o.transport or decode(p_request->>'payload_hash','hex') is distinct from o.payload_hash then raise exception 'OPERATION_PAYLOAD_CONFLICT';end if;
 if p_action='STATE' then
  return jsonb_build_object('state',o.state,'generation',p_generation,'kind',o.kind,'deadline',o.deadline,'server_time',now_at);
 end if;
 if p_action='ACK' then
  if o.state not in ('COMMITTED','ACKNOWLEDGED') then raise exception 'OPERATION_NOT_COMMITTED';end if;
  if o.kind<>'REVOKE' and not coalesce(private.installation_active(old_id,old_secret,old_version),false) then raise exception 'INSTALLATION_UNAUTHORIZED' using errcode='42501';end if;
  if o.kind<>'REVOKE' and (old_id is distinct from o.installation_id or old_version is distinct from o.result_version) then raise exception 'OPERATION_OWNER_CONFLICT';end if;
  update private.installation_operations set state='ACKNOWLEDGED',receipt_ciphertext=null where generation=p_generation;
  return jsonb_build_object('state','ACKNOWLEDGED','generation',p_generation,'kind',o.kind);
 end if;
 if now_at>=o.deadline then raise exception 'OPERATION_EXPIRED';end if;
 if o.kind<>'BOOTSTRAP' and (old_id is distinct from o.installation_id or old_version is distinct from o.prior_version
  or private.installation_hash(old_secret) is distinct from o.prior_secret_hash) then raise exception 'OPERATION_OWNER_CONFLICT';end if;
 if o.state='COMMITTED' then
  -- Only the original nonce, payload, prior capability and live receipt recover a result.
  return jsonb_build_object('state','COMMITTED','generation',p_generation,'kind',o.kind,'receipt_ciphertext',o.receipt_ciphertext,'deadline',o.deadline);
 end if;
 if o.state<>'STARTED' then raise exception 'OPERATION_TERMINAL';end if;
 if o.kind='BOOTSTRAP' then
  result_id:=(p_request->>'new_id')::uuid;v_result_version:=1;
  if p_request->>'new_secret' is null or p_request->>'new_secret' !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_SERVER_SECRET';end if;
  insert into private.installations(id,secret_hash,expires_at) values(result_id,private.installation_hash(p_request->>'new_secret'),now_at+interval '24 hours');
  insert into private.installation_settings(installation_id) values(result_id);
 else
  if not coalesce(private.installation_active(old_id,old_secret,old_version),false) then raise exception 'INSTALLATION_UNAUTHORIZED' using errcode='42501';end if;
  select * into strict i from private.installations where id=old_id for update;
  -- Recheck after acquiring the lock, including expiry and competing revocation/rotation.
  if not coalesce(private.installation_active(old_id,old_secret,old_version),false) then raise exception 'INSTALLATION_UNAUTHORIZED' using errcode='42501';end if;
  result_id:=old_id;v_result_version:=old_version+1;
  if o.kind='ROTATE' then
   if p_request->>'new_secret' is null or p_request->>'new_secret' !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_SERVER_SECRET';end if;
   update private.installations set secret_hash=private.installation_hash(p_request->>'new_secret'),secret_version=v_result_version,expires_at=now_at+interval '24 hours' where id=old_id;
  else
   update private.installations set revoked_at=now_at,secret_version=v_result_version where id=old_id;
   update private.installation_settings set morning_issue=false,closing_issue=false,favorite_sector_issue=false,sector_ids='{}' where installation_id=old_id;
   update private.notification_deliveries set status='CANCELLED' where installation_id=old_id and status='NOT_SENT';
  end if;
 end if;
 if o.kind<>'REVOKE' and (p_request->>'receipt_ciphertext' is null or length(p_request->>'receipt_ciphertext')>4096) then raise exception 'INVALID_RECEIPT';end if;
 update private.installation_operations set state='COMMITTED',installation_id=result_id,result_version=v_result_version,
  receipt_ciphertext=case when o.kind='REVOKE' then null else p_request->>'receipt_ciphertext' end,completed_at=now_at where generation=p_generation;
 insert into private.installation_lifecycle_ledger(installation_id,generation,action) values(result_id,p_generation,
  case o.kind when 'BOOTSTRAP' then 'CAPABILITY_CREATE' when 'ROTATE' then 'CAPABILITY_ROTATE' else 'CAPABILITY_REVOKE' end);
 return jsonb_build_object('state','COMMITTED','generation',p_generation,'kind',o.kind,'receipt_ciphertext',
  case when o.kind='REVOKE' then null else p_request->>'receipt_ciphertext' end,'deadline',o.deadline);
end$$;
revoke all on private.installation_operations,private.installation_lifecycle_ledger from public,anon,authenticated;
revoke execute on function public.installation_operation(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.installation_operation(text,uuid,jsonb) to service_role;
commit;
