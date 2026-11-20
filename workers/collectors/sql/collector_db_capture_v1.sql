-- P4 SYNTHETIC isolated collector fixture only. Not a root migration.
-- MAIN must prepare fresh roles/logins and set collector.bootstrap_v1 on this installer session.
begin;
do $bootstrap$
declare
  b jsonb;
  p jsonb;
  k text;
  field text;
  value_text text;
  component_role record;
  login_role record;
  seen_oids text[] := array[]::text[];
  identity_keys constant text[] := array[
    'productId','component','runId','bootstrapId','clusterIdentity',
    'containerId','containerName','imageId','databaseName','pgDataPath',
    'socketDirectory','tmpfsMounts','readOnlyRoot','networkMode',
    'publishedPorts','testLoginPrincipals','resourceIdentityDigest'
  ];
  principal_kinds constant text[] := array['executor','reader','authority','maintenance'];
  principal_keys constant text[] := array[
    'name','oid','roleName','roleOid','login','superuser',
    'createRole','createDb','replication','bypassRls'
  ];
begin
  b := nullif(pg_catalog.current_setting('collector.bootstrap_v1',true),'')::jsonb;

  -- The runtime validators are installed later. Validate here with built-ins,
  -- before creating schemas, tables, helpers, or changing default privileges.
  if pg_catalog.jsonb_typeof(b) is distinct from 'object' then
    raise exception 'STORE_MISMATCH';
  end if;
  if not (b ?& identity_keys)
     or (select count(*) from pg_catalog.jsonb_object_keys(b)) <> cardinality(identity_keys) then
    raise exception 'STORE_MISMATCH';
  end if;
  foreach field in array array[
    'productId','component','runId','bootstrapId','clusterIdentity',
    'containerId','containerName','imageId','databaseName','pgDataPath',
    'socketDirectory','networkMode','resourceIdentityDigest'
  ] loop
    if pg_catalog.jsonb_typeof(b->field) is distinct from 'string' then
      raise exception 'STORE_MISMATCH';
    end if;
  end loop;
  if b->>'productId' is distinct from 'judoju-news'
     or b->>'component' is distinct from 'COLLECTOR_DB_CAPTURE_V1'
     or b->>'imageId' is distinct from 'sha256:7c31363a3f7434ff14945f1b8a4880e6eca8b362e197e88b87c476c77aa3cf8c'
     or b->>'databaseName' is distinct from pg_catalog.current_database()
     or b->>'networkMode' is distinct from 'none'
     or b->>'pgDataPath' is distinct from '/tmp/p4-pg'
     or b->>'socketDirectory' is distinct from '/tmp'
     or b->'readOnlyRoot' is distinct from 'true'::jsonb
     or b->'publishedPorts' is distinct from '0'::jsonb then
    raise exception 'STORE_MISMATCH';
  end if;
  foreach field in array array['runId','bootstrapId'] loop
    if (b->>field) !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
      raise exception 'STORE_MISMATCH';
    end if;
  end loop;
  value_text := b->>'clusterIdentity';
  if length(value_text) > 19 or value_text !~ '^[1-9][0-9]*$' then
    raise exception 'STORE_MISMATCH';
  end if;
  if value_text::numeric > 9223372036854775807
     or value_text is distinct from (select system_identifier::text from pg_catalog.pg_control_system()) then
    raise exception 'STORE_MISMATCH';
  end if;
  if b->>'containerId' !~ '^[a-f0-9]{64}$'
     or length(b->>'containerName') > 128
     or b->>'containerName' !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]*$'
     or b->>'databaseName' !~ '^[a-z][a-z0-9_]{0,62}$'
     or b->>'resourceIdentityDigest' !~ '^[a-f0-9]{64}$' then
    raise exception 'STORE_MISMATCH';
  end if;
  if b->'tmpfsMounts' is distinct from '{
    "/tmp":"rw,nosuid,size=268435456",
    "/var/lib/postgresql/data":"rw,nosuid,size=16777216",
    "/var/run/postgresql":"rw,nosuid,size=16777216"
  }'::jsonb then
    raise exception 'STORE_MISMATCH';
  end if;
  -- The MAIN resource verifier retains responsibility for inspecting the
  -- container and the existing sorted-JSON identity digest; do not substitute
  -- the runtime typed canonical digest for that separate identity ABI.
  if pg_catalog.jsonb_typeof(b->'testLoginPrincipals') is distinct from 'object' then
    raise exception 'STORE_MISMATCH';
  end if;
  if not ((b->'testLoginPrincipals') ?& principal_kinds)
     or (select count(*) from pg_catalog.jsonb_object_keys(b->'testLoginPrincipals')) <> cardinality(principal_kinds) then
    raise exception 'UNAUTHORIZED';
  end if;
  foreach k in array principal_kinds loop
    p := b->'testLoginPrincipals'->k;
    if pg_catalog.jsonb_typeof(p) is distinct from 'object' then
      raise exception 'UNAUTHORIZED';
    end if;
    if not (p ?& principal_keys)
       or (select count(*) from pg_catalog.jsonb_object_keys(p)) <> cardinality(principal_keys) then
      raise exception 'UNAUTHORIZED';
    end if;
    foreach field in array array['name','oid','roleName','roleOid'] loop
      if pg_catalog.jsonb_typeof(p->field) is distinct from 'string' then
        raise exception 'UNAUTHORIZED';
      end if;
    end loop;
    if p->>'name' is distinct from 'judoju_p4_c_'||k||'_'||left(replace(b->>'runId','-',''),12)
       or p->>'roleName' is distinct from 'collector_'||k||'_v1'
       or p->'login' is distinct from 'true'::jsonb then
      raise exception 'UNAUTHORIZED';
    end if;
    foreach field in array array['superuser','createRole','createDb','replication','bypassRls'] loop
      if p->field is distinct from 'false'::jsonb then
        raise exception 'UNAUTHORIZED';
      end if;
    end loop;
    foreach field in array array['oid','roleOid'] loop
      value_text := p->>field;
      if length(value_text) > 19 or value_text !~ '^[1-9][0-9]*$' then
        raise exception 'UNAUTHORIZED';
      end if;
      if value_text::numeric > 9223372036854775807 or value_text = any(seen_oids) then
        raise exception 'UNAUTHORIZED';
      end if;
      seen_oids := array_append(seen_oids,value_text);
    end loop;
  end loop;

  if exists(select 1 from pg_catalog.pg_namespace where nspname in ('collector_private','collector_api')) then
    raise exception 'EFFECT_CONFLICT';
  end if;
  foreach k in array array['owner','executor','reader','authority','maintenance'] loop
    select * into component_role from pg_catalog.pg_roles where rolname='collector_'||k||'_v1';
    if not found then
      raise exception 'UNAUTHORIZED';
    end if;
    if component_role.rolcanlogin or component_role.rolsuper or component_role.rolcreaterole
       or component_role.rolcreatedb or component_role.rolreplication or component_role.rolbypassrls
       or exists(select 1 from pg_catalog.pg_auth_members where member=component_role.oid) then
      raise exception 'UNAUTHORIZED';
    end if;
    if k <> 'owner' then
      p := b->'testLoginPrincipals'->k;
      if p->>'roleName' is distinct from component_role.rolname
         or p->>'roleOid' is distinct from component_role.oid::text then
        raise exception 'UNAUTHORIZED';
      end if;
      select * into login_role from pg_catalog.pg_roles where rolname=p->>'name';
      if not found then
        raise exception 'UNAUTHORIZED';
      end if;
      if login_role.oid::text is distinct from p->>'oid'
         or not login_role.rolcanlogin or login_role.rolsuper or login_role.rolcreaterole
         or login_role.rolcreatedb or login_role.rolreplication or login_role.rolbypassrls then
        raise exception 'UNAUTHORIZED';
      end if;
      if (select count(*) from pg_catalog.pg_auth_members where member=login_role.oid) <> 1
         or not exists(select 1 from pg_catalog.pg_auth_members where member=login_role.oid and roleid=component_role.oid) then
        raise exception 'UNAUTHORIZED';
      end if;
    end if;
  end loop;
end
$bootstrap$;
create schema collector_private authorization collector_owner_v1;
create schema collector_api authorization collector_owner_v1;
revoke all on schema collector_private,collector_api from public;
set local role collector_owner_v1;
alter default privileges for role collector_owner_v1 in schema collector_private revoke all on tables from public;
alter default privileges for role collector_owner_v1 in schema collector_private revoke all on sequences from public;
alter default privileges for role collector_owner_v1 revoke execute on functions from public;

create table collector_private.collector_store_v1(
  singleton boolean primary key default true check(singleton),product_id text not null check(product_id='judoju-news'),mode text not null check(mode='SYNTHETIC_ISOLATED_DB'),
  stable_store_id uuid not null unique,store_epoch bigint not null check(store_epoch>0),schema_version text not null check(schema_version='COLLECTOR_DB_CAPTURE_V1'),
  state text not null check(state in ('ACTIVE','FROZEN')),bootstrap_id uuid not null,run_id uuid not null,resource_identity_digest text not null check(resource_identity_digest~'^[a-f0-9]{64}$'),resource_metadata jsonb not null,created_at timestamptz not null
);
create table collector_private.collector_grant_v1(
  grant_id uuid not null,generation bigint not null check(generation>0),source_id text not null,endpoint_id text not null,store_epoch bigint not null,
  event text not null check(event in ('ISSUE','REVOKE')),grant_version text not null,source_policy_version text not null,known_at timestamptz not null,expires_at timestamptz not null,revoked_at timestamptz,
  retention_ms bigint not null check(retention_ms between 1 and 2592000000),payload jsonb not null,grant_digest text not null,
  primary key(grant_id,generation),unique(source_id,endpoint_id,generation)
);
create table collector_private.collector_grant_head_v1(
  source_id text not null,endpoint_id text not null,grant_id uuid not null,current_generation bigint not null,
  primary key(source_id,endpoint_id),foreign key(grant_id,current_generation) references collector_private.collector_grant_v1(grant_id,generation)
);
create table collector_private.collector_document_v1(
  document_id uuid primary key,source_id text not null,native_id text not null,delivery_sequence bigint not null check(delivery_sequence>=0),created_at timestamptz not null,unique(source_id,native_id)
);
create table collector_private.collector_delivery_v1(
  delivery_id uuid primary key,document_id uuid not null references collector_private.collector_document_v1(document_id),source_id text not null,endpoint_id text not null,native_id text not null,
  raw_observation_id uuid not null,item_ordinal bigint not null check(item_ordinal between 0 and 99),document_delivery_sequence bigint not null check(document_delivery_sequence>0),
  grant_id uuid not null,grant_generation bigint not null,original_effect_key text not null,kind text not null,purpose text not null,observed_at timestamptz not null,accepted_at timestamptz not null,data jsonb not null,audit jsonb not null,
  unique(raw_observation_id,item_ordinal),unique(document_id,document_delivery_sequence),foreign key(grant_id,grant_generation) references collector_private.collector_grant_v1(grant_id,generation)
);
create table collector_private.collector_body_v1(
  body_id uuid primary key,delivery_id uuid not null unique references collector_private.collector_delivery_v1(delivery_id),grant_id uuid not null,grant_generation bigint not null,original_effect_key text not null,
  purpose text not null check(purpose='ORIGINAL_ACCESS'),encoding text not null check(encoding='identity'),raw_hash_alg text not null check(raw_hash_alg='RAW_BYTES_SHA256_V1'),raw_hash text not null check(raw_hash~'^[a-f0-9]{64}$'),
  body_hash_alg text not null check(body_hash_alg='UTF8_BODY_BYTES_SHA256_V1'),body_hash text not null check(body_hash~'^[a-f0-9]{64}$'),raw_byte_length bigint not null check(raw_byte_length between 1 and 65536),decoded_byte_length bigint not null check(decoded_byte_length=raw_byte_length),
  accepted_at timestamptz not null,rights_expires_at timestamptz not null,retention_until timestamptz not null,audit jsonb not null,
  foreign key(grant_id,grant_generation) references collector_private.collector_grant_v1(grant_id,generation)
);
create table collector_private.collector_body_payload_v1(body_id uuid primary key references collector_private.collector_body_v1(body_id),raw_bytes bytea not null,body_text text not null);
create table collector_private.collector_effect_v1(
  effect_key text primary key,store_epoch bigint not null,operation text not null,request_digest_alg text not null check(request_digest_alg='COLLECTOR_CANONICAL_UTF8_SHA256_V1'),request_digest text not null,
  actor_principal text not null,actor_binding jsonb not null,audit jsonb not null,audit_bindings jsonb not null,receipt_id uuid not null unique,receipt_digest text not null,receipt jsonb not null,applied_at timestamptz not null
);
create table collector_private.collector_tombstone_v1(
  source_id text not null,native_id text not null,document_id uuid references collector_private.collector_document_v1(document_id),reason text not null,evidence_ref text not null,actor_binding jsonb not null,store_epoch bigint not null,blocked_at timestamptz not null,original_effect_key text not null,primary key(source_id,native_id)
);
insert into collector_private.collector_store_v1
select true,'judoju-news','SYNTHETIC_ISOLATED_DB',pg_catalog.gen_random_uuid(),1,'COLLECTOR_DB_CAPTURE_V1','ACTIVE',
 (b->>'bootstrapId')::uuid,(b->>'runId')::uuid,b->>'resourceIdentityDigest',b,pg_catalog.clock_timestamp()
from (select pg_catalog.current_setting('collector.bootstrap_v1')::jsonb b) init;

create function collector_private.fail_v1(p_code text,p_reason text default null) returns void language plpgsql volatile set search_path='' as $$
begin raise exception using errcode='P0001',message=p_code,detail=pg_catalog.jsonb_build_object('code',p_code,'certainty','THIS_ATTEMPT_REJECTED','effectState','NOT_ASSERTED','retry','NEVER','reason',p_reason)::text;end$$;
create function collector_private.assert_rc_v1() returns void language plpgsql volatile set search_path='' as $$
begin if pg_catalog.current_setting('transaction_isolation')<>'read committed' then perform collector_private.fail_v1('ISOLATION_NOT_SUPPORTED');end if;end$$;
create function collector_private.stamp_v1(p timestamptz) returns text language sql volatile set search_path='' as $$select pg_catalog.to_char(p at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')$$;
create function collector_private.flags_v1(p_schema text default 'COLLECTOR_DB_CAPTURE_V1') returns jsonb language sql volatile set search_path='' as $$
select pg_catalog.jsonb_build_object('schema',p_schema,'mode','SYNTHETIC_ISOLATED_DB','fixtureAssertionOnly',true,'scope','DELIVERY_BODY_STORE_ONLY','externalCollectionEnabled',false,'providerExecutionEnabled',false,'aiExecutionEnabled',false,'actualAcquisitionProven',false,'checkpointAdvanced',false,'inputGateState','NOT_INTEGRATED','crossWorkerAtomicityProven',false,'physicalCommitTimeRightsProven',false)$$;
create function collector_private.known_v1(p jsonb) returns jsonb language sql volatile set search_path='' as $$select pg_catalog.jsonb_build_object('state','KNOWN','value',p)$$;
create function collector_private.unknown_v1(p text default 'NOT_RECORDED') returns jsonb language sql volatile set search_path='' as $$select pg_catalog.jsonb_build_object('state','UNKNOWN','reason',p)$$;
create function collector_private.exact_v1(p jsonb,p_keys text[]) returns void language plpgsql volatile set search_path='' as $$
begin if pg_catalog.jsonb_typeof(p) is distinct from 'object' then perform collector_private.fail_v1('INVALID_INPUT');end if;
 if exists(select 1 from pg_catalog.jsonb_object_keys(p) k where not(k=any(p_keys))) then perform collector_private.fail_v1('UNKNOWN_FIELD');end if;
 if (select count(*) from pg_catalog.jsonb_object_keys(p))<>cardinality(p_keys) or not(p ?& p_keys) then perform collector_private.fail_v1('INVALID_INPUT');end if;end$$;
create function collector_private.json_guard_v1(p json,p_depth integer default 0) returns integer language plpgsql volatile set search_path='' as $$
declare n integer:=1;r record;
begin
 if p is null or p_depth is null or p_depth>8 then perform collector_private.fail_v1('INVALID_INPUT');end if;
 if pg_catalog.json_typeof(p)='object' then
   if exists(select 1 from pg_catalog.json_each(p) group by key collate "C" having count(*)>1) then perform collector_private.fail_v1('DUPLICATE_FIELD');end if;
   for r in select key,value from pg_catalog.json_each(p) loop n:=n+collector_private.json_guard_v1(r.value,p_depth+1);end loop;
 elsif pg_catalog.json_typeof(p)='array' then for r in select value from pg_catalog.json_array_elements(p) loop n:=n+collector_private.json_guard_v1(r.value,p_depth+1);end loop;
 end if;
 if n>2048 then perform collector_private.fail_v1('INVALID_INPUT');end if;return n;
end$$;
create function collector_private.id_v1(p jsonb,p_max integer default 128) returns text language plpgsql volatile set search_path='' as $$
declare t text:=p#>>'{}';begin if pg_catalog.jsonb_typeof(p) is distinct from 'string' or length(t)>p_max or t!~'^[A-Za-z0-9][A-Za-z0-9_.:/-]*$' then perform collector_private.fail_v1('INVALID_INPUT');end if;return t;end$$;
create function collector_private.uuid_v1(p jsonb) returns uuid language plpgsql volatile set search_path='' as $$
declare t text:=p#>>'{}';begin if pg_catalog.jsonb_typeof(p) is distinct from 'string' or t!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then perform collector_private.fail_v1('INVALID_INPUT');end if;return t::uuid;end$$;
create function collector_private.decimal_v1(p jsonb,p_min bigint default 0,p_max bigint default 9223372036854775807) returns bigint language plpgsql volatile set search_path='' as $$
declare t text:=p#>>'{}';v numeric;begin if pg_catalog.jsonb_typeof(p) is distinct from 'string' or length(t)>19 or t!~'^(0|[1-9][0-9]*)$' then perform collector_private.fail_v1('INVALID_INPUT');end if;v:=t::numeric;if v<p_min or v>p_max then perform collector_private.fail_v1('INVALID_INPUT');end if;return v::bigint;end$$;
create function collector_private.instant_v1(p jsonb) returns timestamptz language plpgsql volatile set search_path='' as $$
declare t text:=p#>>'{}';v timestamptz;begin if pg_catalog.jsonb_typeof(p) is distinct from 'string' or t!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then perform collector_private.fail_v1('INVALID_INPUT');end if;begin v:=t::timestamptz;exception when others then perform collector_private.fail_v1('INVALID_INPUT');end;if collector_private.stamp_v1(v) is distinct from t then perform collector_private.fail_v1('INVALID_INPUT');end if;return v;end$$;
create function collector_private.hash_v1(p jsonb) returns text language plpgsql volatile set search_path='' as $$
declare t text:=p#>>'{}';begin if pg_catalog.jsonb_typeof(p) is distinct from 'string' or t!~'^[a-f0-9]{64}$' then perform collector_private.fail_v1('INVALID_INPUT');end if;return t;end$$;
create function collector_private.native_v1(p jsonb) returns text language plpgsql volatile set search_path='' as $$
declare t text:=p#>>'{}';begin if pg_catalog.jsonb_typeof(p) is distinct from 'string' or octet_length(pg_catalog.convert_to(t,'UTF8')) not between 1 and 512 then perform collector_private.fail_v1('INVALID_INPUT');end if;return t;end$$;
create function collector_private.enum_v1(p jsonb,p_values text[]) returns text language plpgsql volatile set search_path='' as $$
declare t text:=p#>>'{}';begin if pg_catalog.jsonb_typeof(p) is distinct from 'string' or (t=any(p_values)) is not true then perform collector_private.fail_v1('INVALID_INPUT');end if;return t;end$$;
create function collector_private.strings_v1(p jsonb,p_max integer,p_allowed text[] default null) returns void language plpgsql volatile set search_path='' as $$
declare r record;last text:=null;t text;begin if pg_catalog.jsonb_typeof(p) is distinct from 'array' then perform collector_private.fail_v1('INVALID_INPUT');end if;if pg_catalog.jsonb_array_length(p)>p_max then perform collector_private.fail_v1('INVALID_INPUT');end if;for r in select value from pg_catalog.jsonb_array_elements(p) loop t:=r.value#>>'{}';if pg_catalog.jsonb_typeof(r.value) is distinct from 'string' or (last is not null and last collate "C">=t collate "C") or (p_allowed is not null and (t=any(p_allowed)) is not true) then perform collector_private.fail_v1('INVALID_INPUT');end if;last:=t;end loop;end$$;
create function collector_private.audit_mask_v1() returns text[] language sql volatile set search_path='' as $$select array[
'effectReceipt.appliedAt','effectReceipt.binding','effectReceipt.operation','effectReceipt.receiptDigest','effectReceipt.receiptId','effectReceipt.requestDigest',
'identity.documentId','identity.deliveryId','identity.rawObservationId','identity.bodyId','identity.documentDeliverySequence','identity.sourceId','identity.endpointId','identity.nativeId',
'observation.kind','observation.purpose','observation.observedAt','observation.deliveryAcceptedAt','observation.bodyAcceptedAt','grants.deliverySnapshot','grants.bodySnapshot','grants.current',
'integrity.rawHashAlg','integrity.rawHash','integrity.bodyHashAlg','integrity.bodyHash','integrity.rawByteLength','integrity.decodedByteLength','integrity.encoding','integrity.attachmentIntegrityAtCommit','integrity.integrityAtRead',
'validity.grantKnownAt','validity.rightsExpiresAt','validity.retentionUntil','validity.effectiveUsableUntil','validity.tombstone','validity.auditRetentionUntil','provenance','sourceTime']::text[]$$;
create function collector_private.receipt_mask_v1() returns text[] language sql volatile set search_path='' as $$select array['effectReceipt.appliedAt','effectReceipt.binding','effectReceipt.operation','effectReceipt.receiptDigest','effectReceipt.receiptId','effectReceipt.requestDigest']::text[]$$;
create function collector_private.audit_v1(p jsonb) returns void language plpgsql volatile set search_path='' as $$
begin perform collector_private.exact_v1(p,array['auditPolicyVersion','auditPrincipals','auditFieldMask','auditRetentionUntil']);if p->>'auditPolicyVersion' is distinct from 'SYNTHETIC_METADATA_V1' then perform collector_private.fail_v1('INVALID_INPUT');end if;
perform collector_private.strings_v1(p->'auditPrincipals',8);if pg_catalog.jsonb_array_length(p->'auditPrincipals')=0 then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;
perform collector_private.strings_v1(p->'auditFieldMask',64,collector_private.audit_mask_v1());if not((p->'auditFieldMask') ?& collector_private.receipt_mask_v1()) then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;perform collector_private.instant_v1(p->'auditRetentionUntil');end$$;
create function collector_private.known_guard_v1(p jsonb,p_type text) returns void language plpgsql volatile set search_path='' as $$
begin
 -- Reject SQL NULL, missing, JSON null and non-string state before choosing either variant.
 perform collector_private.enum_v1(p->'state',array['KNOWN','UNKNOWN']);
 if p->>'state'='KNOWN' then perform collector_private.exact_v1(p,array['state','value']);if p_type='instant' then perform collector_private.instant_v1(p->'value');else perform collector_private.id_v1(p->'value');end if;
 else perform collector_private.exact_v1(p,array['state','reason']);if p->>'state' is distinct from 'UNKNOWN' then perform collector_private.fail_v1('INVALID_INPUT');end if;perform collector_private.enum_v1(p->'reason',array['NOT_ATTACHED','NOT_RECORDED','NOT_RESOLVED','AUTHORITY_UNAVAILABLE','WITHHELD_BY_POLICY','AUDIT_RETENTION_EXPIRED','NOT_CHECKED_THIS_READ']);end if;end$$;
create function collector_private.provenance_guard_v1(p jsonb) returns void language plpgsql volatile set search_path='' as $$
declare k text;begin perform collector_private.exact_v1(p,array['publisherId','originId','independenceGroupId','ownerGroupId','newsroomId']);for k in select unnest(array['publisherId','originId','independenceGroupId','ownerGroupId','newsroomId']) loop perform collector_private.known_guard_v1(p->k,'id');end loop;end$$;
create function collector_private.binding_guard_v1(p jsonb) returns void language plpgsql volatile set search_path='' as $$begin perform collector_private.exact_v1(p,array['grantId','grantGeneration','grantVersion','sourcePolicyVersion']);perform collector_private.uuid_v1(p->'grantId');perform collector_private.decimal_v1(p->'grantGeneration',1);perform collector_private.id_v1(p->'grantVersion');perform collector_private.id_v1(p->'sourcePolicyVersion');end$$;

create function collector_private.canonical_v1(p jsonb,p_hint text default '') returns text language plpgsql volatile set search_path='' as $$
declare typ text:=pg_catalog.jsonb_typeof(p);t text;r record;out text;cnt integer;
begin
 if typ='null' then return 'n;';elsif typ='boolean' then return case when p='true'::jsonb then 'b1;' else 'b0;' end;
 elsif typ='string' then t:=p#>>'{}';if p_hint=any(array['storeEpoch','expectedGeneration','grantGeneration','expectedEpoch','retentionMs','itemOrdinal','rawByteLength','decodedByteLength','documentDeliverySequence','principalOid','roleOid']) then perform collector_private.decimal_v1(p);return 'd'||t||';';
 elsif p_hint=any(array['expiresAt','auditRetentionUntil','observedAt','publishedAt','updatedAt','appliedAt','knownAt','checkedAt','acceptedAt','rightsExpiresAt','retentionUntil','effectiveUsableUntil','deliveryAcceptedAt','bodyAcceptedAt','grantKnownAt']) then perform collector_private.instant_v1(p);return 't'||t||';';end if;return 's'||octet_length(pg_catalog.convert_to(t,'UTF8'))::text||':'||t||';';
 elsif typ='array' then out:='a'||pg_catalog.jsonb_array_length(p)::text||':[';for r in select value from pg_catalog.jsonb_array_elements(p) loop out:=out||collector_private.canonical_v1(r.value,p_hint);end loop;return out||']';
 elsif typ='object' then select count(*)::integer into cnt from pg_catalog.jsonb_object_keys(p);out:='o'||cnt::text||':{';for r in select key,value from pg_catalog.jsonb_each(p) order by key collate "C" loop if r.key!~'^[A-Za-z][A-Za-z0-9_]*$' then perform collector_private.fail_v1('INVALID_INPUT');end if;out:=out||collector_private.canonical_v1(pg_catalog.to_jsonb(r.key),'')||collector_private.canonical_v1(r.value,case when r.key='value' then p_hint else r.key end);end loop;return out||'}';end if;
 perform collector_private.fail_v1('INVALID_INPUT');return null;
end$$;
create function collector_private.digest_v1(p jsonb) returns text language sql volatile set search_path='' as $$select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('COLLECTOR_DB_CAPTURE_V1'||chr(10)||collector_private.canonical_v1(p),'UTF8')),'hex')$$;
create function collector_private.wire_v1(p_wire text,p_operations text[]) returns jsonb language plpgsql volatile set search_path='' as $$
declare j json;c jsonb;a jsonb;op text;ks text[];k text;write boolean;receipt_audit jsonb;
begin
 perform collector_private.assert_rc_v1();if p_wire is null or octet_length(pg_catalog.convert_to(p_wire,'UTF8'))>131072 then perform collector_private.fail_v1('BODY_TOO_LARGE');end if;
 begin j:=p_wire::json;exception when others then perform collector_private.fail_v1('INVALID_INPUT');end;
 perform collector_private.json_guard_v1(j);c:=j::jsonb;op:=collector_private.enum_v1(c->'operation',p_operations);write:=op=any(array['ISSUE_GRANT','REVOKE_GRANT','PUT_DELIVERY','ATTACH_BODY','BLOCK_DOCUMENT','ROTATE_EPOCH_AND_FREEZE']);
 ks:=array['schema','mode','fixtureAssertionOnly','physicalCommitTimeRightsProven','stableStoreId','storeEpoch','operation','args'];if write then ks:=ks||array['effectKey','canonicalAlg','requestDigest'];end if;perform collector_private.exact_v1(c,ks);
 if c->>'schema' is distinct from 'COLLECTOR_DB_CAPTURE_V1' or c->>'mode' is distinct from 'SYNTHETIC_ISOLATED_DB' or c->'fixtureAssertionOnly' is distinct from 'true'::jsonb or c->'physicalCommitTimeRightsProven' is distinct from 'false'::jsonb then perform collector_private.fail_v1('LIVE_NOT_ENABLED');end if;
 perform collector_private.uuid_v1(c->'stableStoreId');perform collector_private.decimal_v1(c->'storeEpoch',1);a:=c->'args';
 ks:=case op
 when 'ISSUE_GRANT' then array['sourceId','endpointId','expectedGeneration','grantId','grantVersion','sourcePolicyVersion','purposes','writePrincipal','readPrincipals','auditPrincipals','scope','expiresAt','retentionMs','auditPolicyVersion','auditRetentionUntil','auditFieldMask','issuerRef','evidenceRef','approvedProvenance']
 when 'REVOKE_GRANT' then array['sourceId','endpointId','expectedGeneration','newGrantVersion','reasonCode','evidenceRef','receiptAudit']
 when 'PUT_DELIVERY' then array['grant','deliveryId','sourceId','endpointId','nativeId','rawObservationId','itemOrdinal','providerDeliveryRef','providerRevisionRef','kind','purpose','syntheticLocator','observedAt','sourceTimes','assertedProvenance']
 when 'ATTACH_BODY' then array['grant','deliveryId','bodyId','purpose','contentEncoding','rawHashAlg','rawHash','bodyHashAlg','bodyHash','rawByteLength','decodedByteLength','rawBytesBase64']
 when 'BLOCK_DOCUMENT' then array['sourceId','nativeId','reasonCode','evidenceRef','receiptAudit']
 when 'ROTATE_EPOCH_AND_FREEZE' then array['expectedEpoch','reasonCode','evidenceRef','receiptAudit']
 when 'LOOKUP_EFFECT' then array['originalOperation','effectKey','canonicalAlg','requestDigest']
 when 'READ_METADATA' then array['deliveryId']
 when 'READ_FOR_BRIDGE' then array['deliveryId','expectedBodyId','expectedBodyHashAlg','expectedBodyHash','expectedSourcePolicyVersion'] end;
 perform collector_private.exact_v1(a,ks);
 for k in select unnest(array['sourceId','endpointId','grantVersion','newGrantVersion','sourcePolicyVersion','expectedSourcePolicyVersion','writePrincipal','issuerRef','evidenceRef']) loop if a ? k then perform collector_private.id_v1(a->k);end if;end loop;
 for k in select unnest(array['grantId','deliveryId','bodyId','expectedBodyId','rawObservationId']) loop if a ? k then perform collector_private.uuid_v1(a->k);end if;end loop;
 if a ? 'expectedGeneration' then perform collector_private.decimal_v1(a->'expectedGeneration');end if;if a ? 'expectedEpoch' then perform collector_private.decimal_v1(a->'expectedEpoch',1);end if;if a ? 'nativeId' then perform collector_private.native_v1(a->'nativeId');end if;if a ? 'grant' then perform collector_private.binding_guard_v1(a->'grant');end if;if a ? 'receiptAudit' then perform collector_private.audit_v1(a->'receiptAudit');end if;
 if op='ISSUE_GRANT' then
   perform collector_private.audit_v1(pg_catalog.jsonb_build_object('auditPolicyVersion',a->'auditPolicyVersion','auditPrincipals',a->'auditPrincipals','auditFieldMask',a->'auditFieldMask','auditRetentionUntil',a->'auditRetentionUntil'));
   perform collector_private.strings_v1(a->'readPrincipals',8);perform collector_private.instant_v1(a->'expiresAt');perform collector_private.decimal_v1(a->'retentionMs',1,2592000000);perform collector_private.provenance_guard_v1(a->'approvedProvenance');
   perform collector_private.exact_v1(a->'purposes',array['MACHINE_ACCESS','DISCOVERY','LINK_EXTRACTION','QUERY_TERMS','ORIGINAL_ACCESS','STORAGE','ANALYSIS']);for k in select pg_catalog.jsonb_object_keys(a->'purposes') loop perform collector_private.enum_v1(a->'purposes'->k,array['ALLOW','DENY','UNKNOWN']);end loop;
   perform collector_private.exact_v1(a->'scope',array['hosts','paths','methods']);perform collector_private.strings_v1(a->'scope'->'hosts',16);perform collector_private.strings_v1(a->'scope'->'paths',16);
   if pg_catalog.jsonb_array_length(a->'scope'->'hosts')=0 or pg_catalog.jsonb_array_length(a->'scope'->'paths')=0 or a->'scope'->'methods' is distinct from '["GET"]'::jsonb then perform collector_private.fail_v1('INVALID_INPUT');end if;
   if exists(select 1 from pg_catalog.jsonb_array_elements_text(a->'scope'->'hosts') x where x!~'^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+invalid$') or exists(select 1 from pg_catalog.jsonb_array_elements_text(a->'scope'->'paths') x where x!~'^/[A-Za-z0-9/_-]*$') then perform collector_private.fail_v1('LIVE_NOT_ENABLED');end if;
 elsif op='PUT_DELIVERY' then
   perform collector_private.decimal_v1(a->'itemOrdinal',0,99);for k in select unnest(array['providerDeliveryRef','providerRevisionRef']) loop if a->k is distinct from 'null'::jsonb then perform collector_private.id_v1(a->k);end if;end loop;
   perform collector_private.enum_v1(a->'kind',array['ORIGINAL_ARTICLE','DISCOVERY_METADATA','TELEGRAM_LINK_METADATA']);perform collector_private.enum_v1(a->'purpose',array['ORIGINAL_ACCESS','DISCOVERY','LINK_EXTRACTION']);
   if (a->>'kind'='ORIGINAL_ARTICLE' and a->>'purpose' is distinct from 'ORIGINAL_ACCESS') or (a->>'kind'='TELEGRAM_LINK_METADATA' and a->>'purpose' is distinct from 'LINK_EXTRACTION') or pg_catalog.jsonb_typeof(a->'syntheticLocator') is distinct from 'string' or a->>'syntheticLocator'!~'^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+invalid/[A-Za-z0-9/_-]*$' then perform collector_private.fail_v1('LIVE_NOT_ENABLED');end if;
   perform collector_private.instant_v1(a->'observedAt');perform collector_private.provenance_guard_v1(a->'assertedProvenance');perform collector_private.exact_v1(a->'sourceTimes',array['resolutionState','timeQuality','publishedAt','updatedAt']);perform collector_private.enum_v1(a->'sourceTimes'->'resolutionState',array['KNOWN','UNKNOWN','CONFLICT']);perform collector_private.enum_v1(a->'sourceTimes'->'timeQuality',array['KNOWN','PENDING_TIME','UNKNOWN','CONFLICT']);for k in select unnest(array['publishedAt','updatedAt']) loop perform collector_private.known_guard_v1(a->'sourceTimes'->k,'instant');end loop;
   if a->'sourceTimes'->>'timeQuality'='KNOWN' and (a->'sourceTimes'->>'resolutionState' is distinct from 'KNOWN' or a->'sourceTimes'->'publishedAt'->>'state' is distinct from 'KNOWN') then perform collector_private.fail_v1('INVALID_INPUT');end if;
   if a->'sourceTimes'->>'resolutionState'='KNOWN' and a->'sourceTimes'->'updatedAt'->>'state'='KNOWN' and a->'sourceTimes'->'publishedAt'->>'state'='KNOWN' and a->'sourceTimes'->'updatedAt'->>'value'<a->'sourceTimes'->'publishedAt'->>'value' then perform collector_private.fail_v1('INVALID_INPUT');end if;
 elsif op='ATTACH_BODY' then
   if a->>'contentEncoding' is distinct from 'identity' then perform collector_private.fail_v1('UNSUPPORTED_BODY_ENCODING');end if;
   if a->>'purpose' is distinct from 'ORIGINAL_ACCESS' or a->>'rawHashAlg' is distinct from 'RAW_BYTES_SHA256_V1' or a->>'bodyHashAlg' is distinct from 'UTF8_BODY_BYTES_SHA256_V1' then perform collector_private.fail_v1('INVALID_INPUT');end if;
   perform collector_private.hash_v1(a->'rawHash');perform collector_private.hash_v1(a->'bodyHash');perform collector_private.decimal_v1(a->'rawByteLength',1,65536);perform collector_private.decimal_v1(a->'decodedByteLength',1,65536);
   if pg_catalog.jsonb_typeof(a->'rawBytesBase64') is distinct from 'string' or length(a->>'rawBytesBase64')>87384 or a->>'rawBytesBase64'!~'^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then perform collector_private.fail_v1('INVALID_INPUT');end if;
 elsif op='READ_FOR_BRIDGE' then if a->>'expectedBodyHashAlg' is distinct from 'UTF8_BODY_BYTES_SHA256_V1' then perform collector_private.fail_v1('INVALID_INPUT');end if;perform collector_private.hash_v1(a->'expectedBodyHash');
 elsif op='REVOKE_GRANT' then perform collector_private.enum_v1(a->'reasonCode',array['AUTHORITY_REVOKED','POLICY_REPLACED','TEST_REVOKED']);
 elsif op='BLOCK_DOCUMENT' then perform collector_private.enum_v1(a->'reasonCode',array['POLICY_BLOCK','AUTHORITY_WITHDRAWAL','RETENTION_RESTRICTED','TEST_BLOCK']);
 elsif op='ROTATE_EPOCH_AND_FREEZE' then perform collector_private.enum_v1(a->'reasonCode',array['RESTORE_FENCE','AUTHORITY_RESET','TEST_ROTATION']);
 elsif op='LOOKUP_EFFECT' then perform collector_private.enum_v1(a->'originalOperation',array['ISSUE_GRANT','REVOKE_GRANT','PUT_DELIVERY','ATTACH_BODY','BLOCK_DOCUMENT','ROTATE_EPOCH_AND_FREEZE']);perform collector_private.id_v1(a->'effectKey',160);perform collector_private.hash_v1(a->'requestDigest');if a->>'canonicalAlg' is distinct from 'COLLECTOR_CANONICAL_UTF8_SHA256_V1' then perform collector_private.fail_v1('INVALID_INPUT');end if;
 end if;
 if write then perform collector_private.id_v1(c->'effectKey',160);perform collector_private.hash_v1(c->'requestDigest');if c->>'canonicalAlg' is distinct from 'COLLECTOR_CANONICAL_UTF8_SHA256_V1' or collector_private.digest_v1(case when op='ATTACH_BODY' then pg_catalog.jsonb_set(c-'requestDigest','{args}',a-'rawBytesBase64') else c-'requestDigest' end) is distinct from c->>'requestDigest' then perform collector_private.fail_v1('HASH_MISMATCH');end if;end if;
 return c;
end$$;

create function collector_private.actor_v1(s collector_private.collector_store_v1,p_kinds text[]) returns jsonb language plpgsql volatile set search_path='' as $$
declare k text;p jsonb;r record;role_row record;
begin
 perform collector_private.assert_rc_v1();
 for k in select unnest(p_kinds) loop p:=s.resource_metadata->'testLoginPrincipals'->k;if p->>'name'=session_user then
   select * into r from pg_catalog.pg_roles where rolname=session_user;
   select * into role_row from pg_catalog.pg_roles where oid=(p->>'roleOid')::oid;
   if r.oid is null or r.oid::text<>p->>'oid' or role_row.rolname<>p->>'roleName' or role_row.rolcanlogin or role_row.rolsuper or role_row.rolcreaterole or role_row.rolcreatedb or role_row.rolreplication or role_row.rolbypassrls or not r.rolcanlogin or r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls or (select count(*) from pg_catalog.pg_auth_members where member=r.oid)<>1 or not exists(select 1 from pg_catalog.pg_auth_members where member=r.oid and roleid=role_row.oid) or exists(select 1 from pg_catalog.pg_auth_members where member=role_row.oid) then perform collector_private.fail_v1('UNAUTHORIZED','AUDIT_ROLE_MISMATCH');end if;
   return pg_catalog.jsonb_build_object('principalName',r.rolname,'principalOid',r.oid::text,'roleName',role_row.rolname,'roleOid',role_row.oid::text,'runId',s.run_id::text,'resourceIdentityDigest',s.resource_identity_digest);
 end if;end loop;
 perform collector_private.fail_v1('UNAUTHORIZED','ACTOR_NOT_REGISTERED');return null;
end$$;
create function collector_private.audit_bindings_v1(s collector_private.collector_store_v1,p_audit jsonb) returns jsonb language plpgsql volatile set search_path='' as $$
declare name text;k text;p jsonb;out jsonb:='[]'::jsonb;found_principal boolean;
begin perform collector_private.audit_v1(p_audit);for name in select value from pg_catalog.jsonb_array_elements_text(p_audit->'auditPrincipals') loop found_principal:=false;for k in select unnest(array['executor','reader','authority','maintenance']) loop p:=s.resource_metadata->'testLoginPrincipals'->k;if p->>'name'=name then out:=out||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('principalName',name,'principalOid',p->>'oid'));found_principal:=true;end if;end loop;if not found_principal then perform collector_private.fail_v1('UNAUTHORIZED');end if;end loop;return out;end$$;
create function collector_private.operation_kind_v1(p text) returns text language sql volatile set search_path='' as $$select case when p in ('ISSUE_GRANT','REVOKE_GRANT') then 'authority' when p in ('PUT_DELIVERY','ATTACH_BODY') then 'executor' else 'maintenance' end$$;
create function collector_private.effect_audit_v1(s collector_private.collector_store_v1,e collector_private.collector_effect_v1) returns void language plpgsql volatile set search_path='' as $$
declare a jsonb;n timestamptz;
begin perform collector_private.assert_rc_v1();a:=collector_private.actor_v1(s,array[collector_private.operation_kind_v1(e.operation)]);if a<>e.actor_binding then perform collector_private.fail_v1('UNAUTHORIZED','AUDIT_ACTOR_MISMATCH');end if;
 if not((e.audit->'auditPrincipals') ? (a->>'principalName')) or not(e.audit_bindings @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('principalName',a->>'principalName','principalOid',a->>'principalOid'))) then perform collector_private.fail_v1('UNAUTHORIZED','AUDIT_ACTOR_MISMATCH');end if;
 if not((e.audit->'auditFieldMask') ?& collector_private.receipt_mask_v1()) then perform collector_private.fail_v1('UNAUTHORIZED','AUDIT_MASK_DENIED');end if;
 select pg_catalog.clock_timestamp() into n;if collector_private.instant_v1(e.audit->'auditRetentionUntil')<=n then perform collector_private.fail_v1('UNAUTHORIZED','AUDIT_EXPIRED');end if;
end$$;
create function collector_private.grant_snapshot_v1(g collector_private.collector_grant_v1) returns jsonb language sql volatile set search_path='' as $$select pg_catalog.jsonb_build_object('grantId',(g).grant_id::text,'grantGeneration',(g).generation::text,'grantVersion',(g).grant_version,'sourcePolicyVersion',(g).source_policy_version,'purposes',(g).payload->'purposes','knownAt',collector_private.stamp_v1((g).known_at),'expiresAt',collector_private.stamp_v1((g).expires_at),'issuerRef',(g).payload->>'issuerRef','evidenceRef',(g).payload->>'evidenceRef')$$;
create function collector_private.grant_audit_v1(g collector_private.collector_grant_v1) returns jsonb language sql volatile set search_path='' as $$select pg_catalog.jsonb_build_object('auditPolicyVersion',(g).payload->'auditPolicyVersion','auditPrincipals',(g).payload->'auditPrincipals','auditFieldMask',(g).payload->'auditFieldMask','auditRetentionUntil',(g).payload->'auditRetentionUntil')$$;
create function collector_private.current_grant_v1(p_source text,p_endpoint text) returns collector_private.collector_grant_v1 language plpgsql volatile set search_path='' as $$
declare g collector_private.collector_grant_v1;begin perform collector_private.assert_rc_v1();select v.* into g from collector_private.collector_grant_head_v1 h join collector_private.collector_grant_v1 v on v.grant_id=h.grant_id and v.generation=h.current_generation where h.source_id=p_source and h.endpoint_id=p_endpoint;return g;end$$;
create function collector_private.check_grant_v1(g collector_private.collector_grant_v1,p_binding jsonb,p_principal text,p_purposes text[],p_now timestamptz) returns void language plpgsql volatile set search_path='' as $$
declare purpose text;
begin if g.grant_id is null then perform collector_private.fail_v1('GRANT_UNKNOWN');end if;if g.event='REVOKE' or g.revoked_at is not null then perform collector_private.fail_v1('RIGHTS_HOLD','GRANT_REVOKED');end if;
 if g.grant_id::text<>p_binding->>'grantId' or g.generation::text<>p_binding->>'grantGeneration' or g.grant_version<>p_binding->>'grantVersion' or g.source_policy_version<>p_binding->>'sourcePolicyVersion' then perform collector_private.fail_v1('POLICY_STALE');end if;
 if g.known_at>p_now or g.expires_at<=p_now or g.payload->>'writePrincipal'<>p_principal then perform collector_private.fail_v1('RIGHTS_HOLD');end if;
 for purpose in select unnest(p_purposes) loop if g.payload->'purposes'->>purpose<>'ALLOW' then perform collector_private.fail_v1('RIGHTS_HOLD');end if;end loop;
 if not((g.payload->'auditPrincipals') ? p_principal) or collector_private.instant_v1(g.payload->'auditRetentionUntil')<=p_now then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;
end$$;
create function collector_private.history_result_v1(p_store uuid,p_epoch bigint,p_op text,p_key text,p_digest text,p_receipt jsonb,p_disposition text) returns jsonb language sql volatile set search_path='' as $$
select collector_private.flags_v1()||pg_catalog.jsonb_build_object('stableStoreId',p_store::text,'storeEpoch',p_epoch::text,'operation',p_op,'effectKey',p_key,'requestDigest',p_digest,'disposition',p_disposition,'temporalMeaning','HISTORICAL_COMMIT','currentUse','NOT_AUTHORIZED_BY_RECEIPT','currentReadRequired',true,'content',pg_catalog.jsonb_build_object('state','WITHHELD'),'receipt',p_receipt,'outcome',p_receipt->'outcome')$$;

create function collector_private.apply_v1(p_wire text,p_operations text[]) returns jsonb language plpgsql volatile set search_path='' as $$
declare c jsonb;a jsonb;op text;s collector_private.collector_store_v1;actor jsonb;e collector_private.collector_effect_v1;g collector_private.collector_grant_v1;oldg collector_private.collector_grant_v1;h collector_private.collector_grant_head_v1;d collector_private.collector_delivery_v1;doc collector_private.collector_document_v1;
 audit jsonb;audit_bindings jsonb;n timestamptz;outcome jsonb;binding jsonb;receipt jsonb;receipt_id uuid;receipt_digest text;source text;endpoint text;native text;new_generation bigint;body_bytes bytea;body_text text;body_hash text;retention timestamptz;document_id uuid;body_id uuid;
begin
 perform collector_private.assert_rc_v1();c:=collector_private.wire_v1(p_wire,p_operations);op:=c->>'operation';a:=c->'args';perform pg_catalog.set_config('lock_timeout','2000ms',true);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collector/I/'||(c->>'stableStoreId')||'/'||(c->>'effectKey'),0));
 if op='ROTATE_EPOCH_AND_FREEZE' then perform 1 from collector_private.collector_store_v1 where singleton for update;else perform 1 from collector_private.collector_store_v1 where singleton for share;end if;
 select * into s from collector_private.collector_store_v1 where singleton;
 if s.stable_store_id::text<>c->>'stableStoreId' then perform collector_private.fail_v1('STORE_MISMATCH');end if;if s.store_epoch::text<>c->>'storeEpoch' then perform collector_private.fail_v1('EPOCH_STALE');end if;if s.state<>'ACTIVE' then perform collector_private.fail_v1('STORE_FROZEN');end if;
 actor:=collector_private.actor_v1(s,array[collector_private.operation_kind_v1(op)]);
 select * into e from collector_private.collector_effect_v1 where effect_key=c->>'effectKey';
 if found then if e.operation<>op or e.request_digest<>c->>'requestDigest' then perform collector_private.fail_v1('EFFECT_CONFLICT');end if;perform collector_private.effect_audit_v1(s,e);return collector_private.history_result_v1(s.stable_store_id,s.store_epoch,op,e.effect_key,e.request_digest,e.receipt,'REUSED_HISTORICAL');end if;
 binding:=pg_catalog.jsonb_build_object('stableStoreId',s.stable_store_id::text,'storeEpoch',s.store_epoch::text,'sourceId',null,'endpointId',null,'documentId',null,'deliveryId',null,'bodyId',null,'grantId',null,'grantGeneration',null,'auditPrincipalBindings','[]'::jsonb);
 if op in ('ISSUE_GRANT','REVOKE_GRANT') then
   source:=a->>'sourceId';endpoint:=a->>'endpointId';perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collector/H/'||source||'/'||endpoint,0));perform 1 from collector_private.collector_grant_head_v1 where source_id=source and endpoint_id=endpoint for update;
   select * into h from collector_private.collector_grant_head_v1 where source_id=source and endpoint_id=endpoint;oldg:=collector_private.current_grant_v1(source,endpoint);
   if coalesce(h.current_generation,0)<>collector_private.decimal_v1(a->'expectedGeneration') then perform collector_private.fail_v1('GRANT_VERSION_CONFLICT');end if;new_generation:=coalesce(h.current_generation,0)+1;
   if op='ISSUE_GRANT' then
     if h.grant_id is not null and h.grant_id::text<>a->>'grantId' then perform collector_private.fail_v1('GRANT_VERSION_CONFLICT');end if;
     audit:=pg_catalog.jsonb_build_object('auditPolicyVersion',a->'auditPolicyVersion','auditPrincipals',a->'auditPrincipals','auditFieldMask',a->'auditFieldMask','auditRetentionUntil',a->'auditRetentionUntil');
     if not((audit->'auditPrincipals') ? (actor->>'principalName')) or not((audit->'auditPrincipals') ? (a->>'writePrincipal')) or a->>'writePrincipal'<>s.resource_metadata->'testLoginPrincipals'->'executor'->>'name' then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;
     if exists(select 1 from pg_catalog.jsonb_array_elements_text(a->'readPrincipals') x where x not in (s.resource_metadata->'testLoginPrincipals'->'reader'->>'name',s.resource_metadata->'testLoginPrincipals'->'executor'->>'name')) then perform collector_private.fail_v1('UNAUTHORIZED');end if;
     select pg_catalog.clock_timestamp() into n;if collector_private.instant_v1(a->'expiresAt')<=n or collector_private.instant_v1(audit->'auditRetentionUntil')<=n then perform collector_private.fail_v1('RIGHTS_HOLD');end if;
     insert into collector_private.collector_grant_v1 values((a->>'grantId')::uuid,new_generation,source,endpoint,s.store_epoch,'ISSUE',a->>'grantVersion',a->>'sourcePolicyVersion',n,(a->>'expiresAt')::timestamptz,null,(a->>'retentionMs')::bigint,a,collector_private.digest_v1(a));
   else
     if oldg.grant_id is null then perform collector_private.fail_v1('GRANT_UNKNOWN');end if;audit:=a->'receiptAudit';
     if audit->'auditPrincipals'<>pg_catalog.jsonb_build_array(actor->>'principalName') or audit->'auditFieldMask'<>pg_catalog.to_jsonb(collector_private.receipt_mask_v1()) then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;
     select pg_catalog.clock_timestamp() into n;if collector_private.instant_v1(audit->'auditRetentionUntil')<=n then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;
     insert into collector_private.collector_grant_v1 values(oldg.grant_id,new_generation,source,endpoint,s.store_epoch,'REVOKE',a->>'newGrantVersion',oldg.source_policy_version,n,oldg.expires_at,n,oldg.retention_ms,
       oldg.payload||audit||pg_catalog.jsonb_build_object('grantVersion',a->>'newGrantVersion','purposes',pg_catalog.jsonb_build_object('MACHINE_ACCESS','DENY','DISCOVERY','DENY','LINK_EXTRACTION','DENY','QUERY_TERMS','DENY','ORIGINAL_ACCESS','DENY','STORAGE','DENY','ANALYSIS','DENY')),collector_private.digest_v1(a));
   end if;
   select * into g from collector_private.collector_grant_v1 where source_id=source and endpoint_id=endpoint and generation=new_generation;
   insert into collector_private.collector_grant_head_v1 values(source,endpoint,g.grant_id,new_generation) on conflict(source_id,endpoint_id) do update set grant_id=excluded.grant_id,current_generation=excluded.current_generation;
   outcome:=pg_catalog.jsonb_build_object('kind',case when op='ISSUE_GRANT' then 'GRANT_VERSION_ISSUED' else 'GRANT_REVOKED' end,'grantId',g.grant_id::text,'grantGeneration',g.generation::text,'grantVersion',g.grant_version,'knownAt',collector_private.stamp_v1(n),'grantDigest',g.grant_digest);
   binding:=binding||pg_catalog.jsonb_build_object('sourceId',source,'endpointId',endpoint,'grantId',g.grant_id::text,'grantGeneration',g.generation::text);
 elsif op in ('PUT_DELIVERY','ATTACH_BODY') then
   if op='PUT_DELIVERY' then source:=a->>'sourceId';endpoint:=a->>'endpointId';native:=a->>'nativeId';else select * into d from collector_private.collector_delivery_v1 where delivery_id=(a->>'deliveryId')::uuid;if not found then perform collector_private.fail_v1('DELIVERY_CONFLICT');end if;source:=d.source_id;endpoint:=d.endpoint_id;native:=d.native_id;end if;
   perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collector/H/'||source||'/'||endpoint,0));perform 1 from collector_private.collector_grant_head_v1 where source_id=source and endpoint_id=endpoint for share;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collector/D/'||source||'/'||native,0));perform 1 from collector_private.collector_document_v1 where source_id=source and native_id=native for update;
   select * into doc from collector_private.collector_document_v1 where source_id=source and native_id=native;
   if exists(select 1 from collector_private.collector_tombstone_v1 where source_id=source and native_id=native) then perform collector_private.fail_v1('TOMBSTONED');end if;
   if op='ATTACH_BODY' then perform 1 from collector_private.collector_delivery_v1 where delivery_id=(a->>'deliveryId')::uuid for update;select * into d from collector_private.collector_delivery_v1 where delivery_id=(a->>'deliveryId')::uuid;if d.kind<>'ORIGINAL_ARTICLE' or d.purpose<>'ORIGINAL_ACCESS' then perform collector_private.fail_v1('RIGHTS_HOLD');end if;if exists(select 1 from collector_private.collector_body_v1 where delivery_id=d.delivery_id) then perform collector_private.fail_v1('BODY_ALREADY_ATTACHED');end if;end if;
   -- Separate statement after every relevant lock: this is the current authority snapshot.
   g:=collector_private.current_grant_v1(source,endpoint);select pg_catalog.clock_timestamp() into n;
   perform collector_private.check_grant_v1(g,a->'grant',actor->>'principalName',array[case when op='PUT_DELIVERY' then a->>'purpose' else 'ORIGINAL_ACCESS' end,'STORAGE'],n);
   if g.store_epoch<>s.store_epoch then perform collector_private.fail_v1('POLICY_STALE');end if;audit:=collector_private.grant_audit_v1(g);
   if op='PUT_DELIVERY' then
     if (a->>'observedAt')::timestamptz>n then perform collector_private.fail_v1('INVALID_INPUT');end if;
     if not((g.payload->'scope'->'hosts') ? split_part(substring(a->>'syntheticLocator' from 9),'/',1)) or not((g.payload->'scope'->'paths') ? substring(a->>'syntheticLocator' from '^https://[^/]+(.*)$')) then perform collector_private.fail_v1('RIGHTS_HOLD');end if;
     if exists(select 1 from collector_private.collector_delivery_v1 where delivery_id=(a->>'deliveryId')::uuid or raw_observation_id=(a->>'rawObservationId')::uuid and item_ordinal=(a->>'itemOrdinal')::bigint) then perform collector_private.fail_v1('DELIVERY_CONFLICT');end if;
     if doc.document_id is null then insert into collector_private.collector_document_v1 values(pg_catalog.gen_random_uuid(),source,native,0,n) returning * into doc;end if;
     update collector_private.collector_document_v1 set delivery_sequence=delivery_sequence+1 where collector_document_v1.document_id=doc.document_id returning * into doc;
     insert into collector_private.collector_delivery_v1 values((a->>'deliveryId')::uuid,doc.document_id,source,endpoint,native,(a->>'rawObservationId')::uuid,(a->>'itemOrdinal')::bigint,doc.delivery_sequence,g.grant_id,g.generation,c->>'effectKey',a->>'kind',a->>'purpose',(a->>'observedAt')::timestamptz,n,a,audit);
     outcome:=pg_catalog.jsonb_build_object('kind',case when a->>'kind'='ORIGINAL_ARTICLE' then 'DELIVERY_RECORDED_BODY_PENDING' else 'DELIVERY_METADATA_RECORDED' end,'documentId',doc.document_id::text,'deliveryId',a->>'deliveryId','documentDeliverySequence',doc.delivery_sequence::text,'acceptedAt',collector_private.stamp_v1(n));
     binding:=binding||pg_catalog.jsonb_build_object('deliveryId',a->>'deliveryId','documentId',doc.document_id::text);
   else
     body_bytes:=pg_catalog.decode(a->>'rawBytesBase64','base64');if replace(pg_catalog.encode(body_bytes,'base64'),chr(10),'')<>a->>'rawBytesBase64' then perform collector_private.fail_v1('INVALID_INPUT');end if;
     begin body_text:=pg_catalog.convert_from(body_bytes,'UTF8');exception when others then perform collector_private.fail_v1('INVALID_UTF8');end;
     if octet_length(body_bytes) not between 1 and 65536 or body_bytes<>pg_catalog.convert_to(body_text,'UTF8') or left(body_text,10)<>'SYNTHETIC ' or btrim(substring(body_text from 11))='' then perform collector_private.fail_v1('INVALID_INPUT');end if;
     body_hash:=pg_catalog.encode(pg_catalog.sha256(body_bytes),'hex');if body_hash<>a->>'rawHash' or body_hash<>a->>'bodyHash' or octet_length(body_bytes)::text<>a->>'rawByteLength' or a->>'rawByteLength'<>a->>'decodedByteLength' then perform collector_private.fail_v1('HASH_MISMATCH');end if;
     -- Expiry may pass while hashing; keep the final statement time, never call it COMMIT time.
     g:=collector_private.current_grant_v1(source,endpoint);select pg_catalog.clock_timestamp() into n;perform collector_private.check_grant_v1(g,a->'grant',actor->>'principalName',array['ORIGINAL_ACCESS','STORAGE'],n);
     retention:=least(n+g.retention_ms*interval '1 millisecond',g.expires_at);body_id:=(a->>'bodyId')::uuid;
     insert into collector_private.collector_body_v1 values(body_id,d.delivery_id,g.grant_id,g.generation,c->>'effectKey','ORIGINAL_ACCESS','identity','RAW_BYTES_SHA256_V1',body_hash,'UTF8_BODY_BYTES_SHA256_V1',body_hash,octet_length(body_bytes),octet_length(body_bytes),n,g.expires_at,retention,audit);
     insert into collector_private.collector_body_payload_v1 values(body_id,body_bytes,body_text);
     outcome:=pg_catalog.jsonb_build_object('kind','BODY_ATTACHED_ONLY','deliveryId',d.delivery_id::text,'bodyId',body_id::text,'rawHashAlg','RAW_BYTES_SHA256_V1','rawHash',body_hash,'bodyHashAlg','UTF8_BODY_BYTES_SHA256_V1','bodyHash',body_hash,'rawByteLength',octet_length(body_bytes)::text,'decodedByteLength',octet_length(body_bytes)::text,'acceptedAt',collector_private.stamp_v1(n),'rightsExpiresAt',collector_private.stamp_v1(g.expires_at),'retentionUntil',collector_private.stamp_v1(retention));
     binding:=binding||pg_catalog.jsonb_build_object('documentId',d.document_id::text,'deliveryId',d.delivery_id::text,'bodyId',body_id::text);
   end if;
   binding:=binding||pg_catalog.jsonb_build_object('sourceId',source,'endpointId',endpoint,'grantId',g.grant_id::text,'grantGeneration',g.generation::text);
 elsif op='BLOCK_DOCUMENT' then
   audit:=a->'receiptAudit';if audit->'auditPrincipals'<>pg_catalog.jsonb_build_array(actor->>'principalName') or audit->'auditFieldMask'<>pg_catalog.to_jsonb(collector_private.receipt_mask_v1()) then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;
   source:=a->>'sourceId';native:=a->>'nativeId';perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collector/D/'||source||'/'||native,0));perform 1 from collector_private.collector_document_v1 where source_id=source and native_id=native for update;select cd.document_id into document_id from collector_private.collector_document_v1 cd where cd.source_id=source and cd.native_id=native;
   if exists(select 1 from collector_private.collector_tombstone_v1 where source_id=source and native_id=native) then perform collector_private.fail_v1('TOMBSTONED');end if;select pg_catalog.clock_timestamp() into n;if collector_private.instant_v1(audit->'auditRetentionUntil')<=n then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;
   insert into collector_private.collector_tombstone_v1 values(source,native,document_id,a->>'reasonCode',a->>'evidenceRef',actor,s.store_epoch,n,c->>'effectKey');outcome:=pg_catalog.jsonb_build_object('kind','DOCUMENT_BLOCKED_PAYLOAD_RETAINED','sourceId',source,'nativeId',native,'blockedAt',collector_private.stamp_v1(n));binding:=binding||pg_catalog.jsonb_build_object('sourceId',source,'documentId',document_id::text);
 elsif op='ROTATE_EPOCH_AND_FREEZE' then
   audit:=a->'receiptAudit';if audit->'auditPrincipals'<>pg_catalog.jsonb_build_array(actor->>'principalName') or audit->'auditFieldMask'<>pg_catalog.to_jsonb(collector_private.receipt_mask_v1()) then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;if (a->>'expectedEpoch')::bigint<>s.store_epoch then perform collector_private.fail_v1('EPOCH_STALE');end if;select pg_catalog.clock_timestamp() into n;if collector_private.instant_v1(audit->'auditRetentionUntil')<=n then perform collector_private.fail_v1('AUDIT_RECOVERY_NOT_CONFIGURED');end if;
   update collector_private.collector_store_v1 set store_epoch=s.store_epoch+1,state='FROZEN' where singleton;outcome:=pg_catalog.jsonb_build_object('kind','EPOCH_ROTATED_FROZEN','previousEpoch',s.store_epoch::text,'storeEpoch',(s.store_epoch+1)::text,'state','FROZEN','appliedAt',collector_private.stamp_v1(n));
 else perform collector_private.fail_v1('INVALID_INPUT');end if;
 audit_bindings:=collector_private.audit_bindings_v1(s,audit);binding:=binding||pg_catalog.jsonb_build_object('auditPrincipalBindings',audit_bindings);receipt_id:=pg_catalog.gen_random_uuid();
 receipt:=pg_catalog.jsonb_build_object('receiptId',receipt_id::text,'operation',op,'effectKey',c->>'effectKey','requestDigest',c->>'requestDigest','appliedAt',collector_private.stamp_v1(n),'actorBinding',actor,'binding',binding,'outcome',outcome,'audit',audit);receipt_digest:=collector_private.digest_v1(receipt);receipt:=receipt||pg_catalog.jsonb_build_object('receiptDigest',receipt_digest);
 insert into collector_private.collector_effect_v1 values(c->>'effectKey',s.store_epoch,op,'COLLECTOR_CANONICAL_UTF8_SHA256_V1',c->>'requestDigest',actor->>'principalName',actor,audit,audit_bindings,receipt_id,receipt_digest,receipt,n);
 return collector_private.history_result_v1(s.stable_store_id,s.store_epoch,op,c->>'effectKey',c->>'requestDigest',receipt,'APPLIED');
end$$;

create function collector_private.mask_v1(p jsonb,p_path text,p_mask jsonb) returns jsonb language sql volatile set search_path='' as $$select case when p_mask ? p_path then collector_private.known_v1(p) else collector_private.unknown_v1('WITHHELD_BY_POLICY') end$$;
create function collector_private.read_v1(p_wire text) returns jsonb language plpgsql volatile set search_path='' as $$
declare c jsonb;a jsonb;s collector_private.collector_store_v1;actor jsonb;d collector_private.collector_delivery_v1;b collector_private.collector_body_v1;payload collector_private.collector_body_payload_v1;dg collector_private.collector_grant_v1;bg collector_private.collector_grant_v1;cg collector_private.collector_grant_v1;
 audit jsonb;mask jsonb;n timestamptz;root jsonb;current_state text;reasons text[]:='{}';blocked boolean;prov jsonb;times jsonb;verified boolean:=true;unknown_prov boolean:=false;k text;integrity text:='NOT_CHECKED';effective timestamptz;required_mask text[];identity jsonb;observation jsonb;grants jsonb;hashes jsonb;validity jsonb;body_exists boolean;payload_exists boolean;
begin
 perform collector_private.assert_rc_v1();c:=collector_private.wire_v1(p_wire,array['READ_METADATA','READ_FOR_BRIDGE']);a:=c->'args';perform pg_catalog.set_config('lock_timeout','2000ms',true);perform 1 from collector_private.collector_store_v1 where singleton for share;select * into s from collector_private.collector_store_v1 where singleton;
 if s.stable_store_id::text<>c->>'stableStoreId' then perform collector_private.fail_v1('STORE_MISMATCH');end if;if s.store_epoch::text<>c->>'storeEpoch' then perform collector_private.fail_v1('EPOCH_STALE');end if;
 actor:=collector_private.actor_v1(s,array['executor','reader','authority','maintenance']);
 select * into d from collector_private.collector_delivery_v1 where delivery_id=(a->>'deliveryId')::uuid;
 if d.delivery_id is not null then
   perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collector/H/'||d.source_id||'/'||d.endpoint_id,0));perform 1 from collector_private.collector_grant_head_v1 where source_id=d.source_id and endpoint_id=d.endpoint_id for share;
   perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collector/D/'||d.source_id||'/'||d.native_id,0));perform 1 from collector_private.collector_delivery_v1 where delivery_id=d.delivery_id for share;perform 1 from collector_private.collector_body_v1 where delivery_id=d.delivery_id for share;
 end if;
 -- All current reads are separate statements after the locks above.
 select * into d from collector_private.collector_delivery_v1 where delivery_id=(a->>'deliveryId')::uuid;
 select * into b from collector_private.collector_body_v1 where delivery_id=d.delivery_id;body_exists:=found;
 select * into payload from collector_private.collector_body_payload_v1 where body_id=b.body_id;payload_exists:=found;
 if body_exists then audit:=b.audit;else audit:=d.audit;end if;select pg_catalog.clock_timestamp() into n;
 root:=collector_private.flags_v1('COLLECTOR_DB_READ_V1')||pg_catalog.jsonb_build_object('store',pg_catalog.jsonb_build_object('stableStoreId',s.stable_store_id::text,'storeEpoch',s.store_epoch::text,'checkedAt',collector_private.stamp_v1(n)),'readPurpose',c->>'operation');
 required_mask:=array['identity.documentId','identity.deliveryId','identity.rawObservationId','identity.documentDeliverySequence','observation.kind','observation.purpose','integrity.attachmentIntegrityAtCommit','integrity.integrityAtRead','validity.tombstone','validity.auditRetentionUntil'];
 if d.delivery_id is null or audit is null or not((audit->'auditPrincipals') ? (actor->>'principalName')) or collector_private.instant_v1(audit->'auditRetentionUntil')<=n or not((audit->'auditFieldMask') ?& required_mask) then return root||pg_catalog.jsonb_build_object('disposition','READ_UNAVAILABLE','reasons',pg_catalog.jsonb_build_array('AUDIT_UNAVAILABLE'),'content',pg_catalog.jsonb_build_object('state','WITHHELD'));end if;
 mask:=audit->'auditFieldMask';select * into dg from collector_private.collector_grant_v1 where grant_id=d.grant_id and generation=d.grant_generation;select * into bg from collector_private.collector_grant_v1 where grant_id=b.grant_id and generation=b.grant_generation;cg:=collector_private.current_grant_v1(d.source_id,d.endpoint_id);
 select exists(select 1 from collector_private.collector_tombstone_v1 where source_id=d.source_id and native_id=d.native_id) into blocked;
 if cg.grant_id is null then current_state:='UNKNOWN';elsif cg.event='REVOKE' then current_state:='REVOKED';elsif cg.expires_at<=n then current_state:='EXPIRED';elsif body_exists and (cg.grant_id<>b.grant_id or cg.generation<>b.grant_generation or cg.store_epoch<>s.store_epoch) then current_state:='GENERATION_CHANGED';else current_state:='CURRENT';end if;
 prov:=d.data->'assertedProvenance';for k in select unnest(array['publisherId','originId','independenceGroupId','ownerGroupId','newsroomId']) loop
   if k=any(array['publisherId','originId','independenceGroupId']) and (prov->k->>'state' is distinct from 'KNOWN' or bg.payload->'approvedProvenance'->k->>'state' is distinct from 'KNOWN') then unknown_prov:=true;
   elsif prov->k->>'state'='KNOWN' and (bg.payload->'approvedProvenance'->k->>'state' is distinct from 'KNOWN' or prov->k is distinct from bg.payload->'approvedProvenance'->k) then verified:=false;
   end if;
 end loop;
 prov:=prov||pg_catalog.jsonb_build_object('resolutionState',case when not verified then 'CONFLICT' when unknown_prov then 'UNKNOWN' else 'KNOWN' end,'verification',case when verified and not unknown_prov and body_exists then 'SYNTHETIC_AUTHORITY_ASSERTED' when not body_exists or unknown_prov then 'UNKNOWN' else 'UNVERIFIED' end,'assertionVersion',case when body_exists then collector_private.known_v1(pg_catalog.to_jsonb(bg.source_policy_version)) else collector_private.unknown_v1() end,'evidenceRef',case when body_exists then collector_private.known_v1(bg.payload->'evidenceRef') else collector_private.unknown_v1() end);
 times:=d.data->'sourceTimes'||pg_catalog.jsonb_build_object('assertionAuthority','SOURCE_ASSERTED');
 if c->>'operation'='READ_FOR_BRIDGE' then
   if s.state<>'ACTIVE' then reasons:=array_append(reasons,'HOLD_STORE_FROZEN');end if;
   if d.kind<>'ORIGINAL_ARTICLE' or d.purpose<>'ORIGINAL_ACCESS' then reasons:=array_append(reasons,'HOLD_NOT_ORIGINAL_ARTICLE');end if;
   if not body_exists then reasons:=array_append(reasons,'HOLD_BODY_PENDING');else
     if not payload_exists then reasons:=array_append(reasons,'HOLD_BODY_MISSING');else integrity:='VERIFIED';if payload.raw_bytes<>pg_catalog.convert_to(payload.body_text,'UTF8') or pg_catalog.encode(pg_catalog.sha256(payload.raw_bytes),'hex')<>b.raw_hash or b.raw_hash<>b.body_hash or octet_length(payload.raw_bytes)<>b.raw_byte_length then integrity:='MISMATCH';reasons:=array_append(reasons,'HOLD_BODY_HASH_MISMATCH');end if;end if;
     if b.body_id::text<>a->>'expectedBodyId' or b.body_hash<>a->>'expectedBodyHash' or b.body_hash_alg<>a->>'expectedBodyHashAlg' then reasons:=array_append(reasons,'HOLD_BODY_HASH_MISMATCH');end if;
     if bg.source_policy_version<>a->>'expectedSourcePolicyVersion' then reasons:=array_append(reasons,'HOLD_SOURCE_POLICY_CHANGED');end if;
   end if;
   if current_state='UNKNOWN' then reasons:=array_append(reasons,'HOLD_GRANT_UNKNOWN');elsif current_state='REVOKED' then reasons:=array_append(reasons,'HOLD_GRANT_REVOKED');elsif current_state='EXPIRED' then reasons:=array_append(reasons,'HOLD_GRANT_EXPIRED');elsif current_state='GENERATION_CHANGED' then reasons:=array_append(reasons,'HOLD_GRANT_GENERATION_CHANGED');end if;
   if cg.grant_id is not null and (not((cg.payload->'readPrincipals') ? (actor->>'principalName')) or cg.payload->'purposes'->>'STORAGE'<>'ALLOW' or cg.payload->'purposes'->>'ANALYSIS'<>'ALLOW' or cg.payload->'purposes'->>'ORIGINAL_ACCESS'<>'ALLOW') then reasons:=array_append(reasons,'HOLD_PURPOSE_NOT_ALLOWED');end if;
   if blocked then reasons:=array_append(reasons,'HOLD_DOCUMENT_BLOCKED');end if;if not verified then reasons:=array_append(reasons,'HOLD_PROVENANCE_CONFLICT');elsif unknown_prov then reasons:=array_append(reasons,'HOLD_PROVENANCE_UNKNOWN');end if;
   if times->>'resolutionState'='CONFLICT' or times->>'timeQuality'='CONFLICT' then reasons:=array_append(reasons,'HOLD_SOURCE_TIME_CONFLICT');elsif times->>'resolutionState' is distinct from 'KNOWN' or times->>'timeQuality' is distinct from 'KNOWN' or times->'publishedAt'->>'state' is distinct from 'KNOWN' then reasons:=array_append(reasons,'HOLD_SOURCE_TIME_UNKNOWN');end if;
   if not(mask ?& array['identity.bodyId','identity.sourceId','identity.endpointId','identity.nativeId','grants.bodySnapshot','grants.current','integrity.rawHashAlg','integrity.rawHash','integrity.bodyHashAlg','integrity.bodyHash','integrity.rawByteLength','integrity.decodedByteLength','integrity.encoding','validity.rightsExpiresAt','validity.retentionUntil','validity.effectiveUsableUntil','provenance','sourceTime']) then reasons:=array_append(reasons,'HOLD_AUDIT_FIELD_MASK');end if;
 end if;
 -- This is the read's last-check timestamp, not physical transaction COMMIT time.
 cg:=collector_private.current_grant_v1(d.source_id,d.endpoint_id);select pg_catalog.clock_timestamp() into n;
 if cg.grant_id is null then current_state:='UNKNOWN';elsif cg.event='REVOKE' then current_state:='REVOKED';elsif cg.expires_at<=n then current_state:='EXPIRED';elsif body_exists and (cg.grant_id<>b.grant_id or cg.generation<>b.grant_generation or cg.store_epoch<>s.store_epoch) then current_state:='GENERATION_CHANGED';else current_state:='CURRENT';end if;
 if c->>'operation'='READ_FOR_BRIDGE' then
   if cg.expires_at<=n and not('HOLD_GRANT_EXPIRED'=any(reasons)) then reasons:=array_append(reasons,'HOLD_GRANT_EXPIRED');end if;if body_exists and b.retention_until<=n then reasons:=array_append(reasons,'HOLD_RETENTION_EXPIRED');end if;
   if times->'publishedAt'->>'state'='KNOWN' and (times->'publishedAt'->>'value')::timestamptz>n or times->'updatedAt'->>'state'='KNOWN' and (times->'updatedAt'->>'value')::timestamptz>n then reasons:=array_append(reasons,'HOLD_SOURCE_TIME_CONFLICT');end if;
 end if;
 if collector_private.instant_v1(audit->'auditRetentionUntil')<=n then return (root||pg_catalog.jsonb_build_object('store',pg_catalog.jsonb_build_object('stableStoreId',s.stable_store_id::text,'storeEpoch',s.store_epoch::text,'checkedAt',collector_private.stamp_v1(n))))||pg_catalog.jsonb_build_object('disposition','READ_UNAVAILABLE','reasons',pg_catalog.jsonb_build_array('AUDIT_EXPIRED'),'content',pg_catalog.jsonb_build_object('state','WITHHELD'));end if;
 if not(mask ? 'provenance') then prov:=pg_catalog.jsonb_build_object('resolutionState','UNKNOWN','verification','UNKNOWN','publisherId',collector_private.unknown_v1('WITHHELD_BY_POLICY'),'originId',collector_private.unknown_v1('WITHHELD_BY_POLICY'),'independenceGroupId',collector_private.unknown_v1('WITHHELD_BY_POLICY'),'ownerGroupId',collector_private.unknown_v1('WITHHELD_BY_POLICY'),'newsroomId',collector_private.unknown_v1('WITHHELD_BY_POLICY'),'assertionVersion',collector_private.unknown_v1('WITHHELD_BY_POLICY'),'evidenceRef',collector_private.unknown_v1('WITHHELD_BY_POLICY'));end if;
 if not(mask ? 'sourceTime') then times:=pg_catalog.jsonb_build_object('resolutionState','UNKNOWN','timeQuality','UNKNOWN','publishedAt',collector_private.unknown_v1('WITHHELD_BY_POLICY'),'updatedAt',collector_private.unknown_v1('WITHHELD_BY_POLICY'),'assertionAuthority','UNKNOWN');end if;
 effective:=least(b.rights_expires_at,b.retention_until,cg.expires_at);
 identity:=pg_catalog.jsonb_build_object('documentId',d.document_id::text,'deliveryId',d.delivery_id::text,'rawObservationId',d.raw_observation_id::text,'documentDeliverySequence',d.document_delivery_sequence::text,'bodyId',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(b.body_id::text),'identity.bodyId',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'sourceId',collector_private.mask_v1(pg_catalog.to_jsonb(d.source_id),'identity.sourceId',mask),'endpointId',collector_private.mask_v1(pg_catalog.to_jsonb(d.endpoint_id),'identity.endpointId',mask),'nativeId',collector_private.mask_v1(pg_catalog.to_jsonb(d.native_id),'identity.nativeId',mask));
 observation:=pg_catalog.jsonb_build_object('kind',d.kind,'purpose',d.purpose,'observedAt',collector_private.mask_v1(pg_catalog.jsonb_build_object('value',collector_private.stamp_v1(d.observed_at),'authority','SOURCE_ASSERTED'),'observation.observedAt',mask),'deliveryAcceptedAt',collector_private.mask_v1(pg_catalog.to_jsonb(collector_private.stamp_v1(d.accepted_at)),'observation.deliveryAcceptedAt',mask),'bodyAcceptedAt',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(collector_private.stamp_v1(b.accepted_at)),'observation.bodyAcceptedAt',mask) else collector_private.unknown_v1('NOT_ATTACHED') end);
 grants:=pg_catalog.jsonb_build_object('deliverySnapshot',collector_private.mask_v1(collector_private.grant_snapshot_v1(dg),'grants.deliverySnapshot',mask),'bodySnapshot',case when body_exists then collector_private.mask_v1(collector_private.grant_snapshot_v1(bg),'grants.bodySnapshot',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'current',collector_private.mask_v1(pg_catalog.jsonb_build_object('state',current_state,'grant',case when cg.grant_id is null then collector_private.unknown_v1('AUTHORITY_UNAVAILABLE') else collector_private.known_v1(collector_private.grant_snapshot_v1(cg)) end),'grants.current',mask));
 hashes:=pg_catalog.jsonb_build_object('rawHashAlg',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(b.raw_hash_alg),'integrity.rawHashAlg',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'rawHash',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(b.raw_hash),'integrity.rawHash',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'bodyHashAlg',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(b.body_hash_alg),'integrity.bodyHashAlg',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'bodyHash',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(b.body_hash),'integrity.bodyHash',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'rawByteLength',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(b.raw_byte_length::text),'integrity.rawByteLength',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'decodedByteLength',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(b.decoded_byte_length::text),'integrity.decodedByteLength',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'encoding',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(b.encoding),'integrity.encoding',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'attachmentIntegrityAtCommit',case when body_exists then 'DB_VERIFIED' else 'NOT_ATTACHED' end,'integrityAtRead',integrity);
 validity:=pg_catalog.jsonb_build_object('grantKnownAt',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(collector_private.stamp_v1(bg.known_at)),'validity.grantKnownAt',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'rightsExpiresAt',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(collector_private.stamp_v1(b.rights_expires_at)),'validity.rightsExpiresAt',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'retentionUntil',case when body_exists then collector_private.mask_v1(pg_catalog.to_jsonb(collector_private.stamp_v1(b.retention_until)),'validity.retentionUntil',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'effectiveUsableUntil',case when body_exists and cg.grant_id is not null then collector_private.mask_v1(pg_catalog.to_jsonb(collector_private.stamp_v1(effective)),'validity.effectiveUsableUntil',mask) else collector_private.unknown_v1('NOT_ATTACHED') end,'tombstone',case when blocked then 'BLOCKED' else 'ABSENT' end,'auditRetentionUntil',audit->>'auditRetentionUntil');
 select coalesce(array_agg(reason order by reason collate "C"),'{}'::text[]) into reasons from (select distinct unnest(reasons) as reason) unique_reasons;
 root:=root||pg_catalog.jsonb_build_object('store',pg_catalog.jsonb_build_object('stableStoreId',s.stable_store_id::text,'storeEpoch',s.store_epoch::text,'checkedAt',collector_private.stamp_v1(n)),'identity',identity,'observation',observation,'grants',grants,'integrity',hashes,'validity',validity,'provenance',prov,'sourceTime',times,'reasons',pg_catalog.to_jsonb(reasons));
 if c->>'operation'='READ_METADATA' then return root||pg_catalog.jsonb_build_object('disposition','METADATA_ONLY','bridgeEligibility','NOT_EVALUATED','content',pg_catalog.jsonb_build_object('state','WITHHELD'));end if;
 if cardinality(reasons)>0 then return root||pg_catalog.jsonb_build_object('disposition','HOLD','content',pg_catalog.jsonb_build_object('state','WITHHELD'));end if;
 -- Defense in depth for historical rows: no READY from upper-level labels alone.
 -- Optional ownerGroupId/newsroomId and updatedAt still accept explicit UNKNOWN variants.
 perform collector_private.provenance_guard_v1(d.data->'assertedProvenance');
 perform collector_private.provenance_guard_v1(bg.payload->'approvedProvenance');
 for k in select unnest(array['publisherId','originId','independenceGroupId']) loop
   perform collector_private.enum_v1(d.data->'assertedProvenance'->k->'state',array['KNOWN']);
   perform collector_private.id_v1(d.data->'assertedProvenance'->k->'value');
   perform collector_private.enum_v1(bg.payload->'approvedProvenance'->k->'state',array['KNOWN']);
   perform collector_private.id_v1(bg.payload->'approvedProvenance'->k->'value');
 end loop;
 perform collector_private.id_v1(bg.payload->'evidenceRef');perform collector_private.id_v1(pg_catalog.to_jsonb(bg.source_policy_version));
 perform collector_private.exact_v1(d.data->'sourceTimes',array['resolutionState','timeQuality','publishedAt','updatedAt']);
 perform collector_private.enum_v1(times->'resolutionState',array['KNOWN']);perform collector_private.enum_v1(times->'timeQuality',array['KNOWN']);
 perform collector_private.known_guard_v1(times->'publishedAt','instant');perform collector_private.known_guard_v1(times->'updatedAt','instant');
 perform collector_private.enum_v1(times->'publishedAt'->'state',array['KNOWN']);perform collector_private.instant_v1(times->'publishedAt'->'value');
 return root||pg_catalog.jsonb_build_object('disposition','READY_SYNTHETIC_ARTIFACT','content',pg_catalog.jsonb_build_object('state','AVAILABLE','kind','UNTRUSTED_ORIGINAL_TEXT','text',payload.body_text));
end$$;

create function collector_api.collector_store_identity_v1() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare s collector_private.collector_store_v1;n timestamptz;
begin perform collector_private.assert_rc_v1();perform 1 from collector_private.collector_store_v1 where singleton for share;select * into s from collector_private.collector_store_v1 where singleton;perform collector_private.actor_v1(s,array['executor','reader','authority','maintenance']);select pg_catalog.clock_timestamp() into n;
return collector_private.flags_v1()||pg_catalog.jsonb_build_object('productId','judoju-news','stableStoreId',s.stable_store_id::text,'storeEpoch',s.store_epoch::text,'bootstrapId',s.bootstrap_id::text,'runId',s.run_id::text,'resourceIdentityDigest',s.resource_identity_digest,'state',s.state,'checkedAt',collector_private.stamp_v1(n),'canonicalAlg','COLLECTOR_CANONICAL_UTF8_SHA256_V1','rawHashAlg','RAW_BYTES_SHA256_V1','bodyHashAlg','UTF8_BODY_BYTES_SHA256_V1');end$$;
create function collector_api.collector_grant_write_v1(p_wire text) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin perform collector_private.assert_rc_v1();return collector_private.apply_v1(p_wire,array['ISSUE_GRANT','REVOKE_GRANT']);end$$;
create function collector_api.collector_delivery_put_v1(p_wire text) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin perform collector_private.assert_rc_v1();return collector_private.apply_v1(p_wire,array['PUT_DELIVERY']);end$$;
create function collector_api.collector_body_attach_v1(p_wire text) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin perform collector_private.assert_rc_v1();return collector_private.apply_v1(p_wire,array['ATTACH_BODY']);end$$;
create function collector_api.collector_body_read_v1(p_wire text) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin perform collector_private.assert_rc_v1();return collector_private.read_v1(p_wire);end$$;
create function collector_api.collector_document_block_v1(p_wire text) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin perform collector_private.assert_rc_v1();return collector_private.apply_v1(p_wire,array['BLOCK_DOCUMENT']);end$$;
create function collector_api.collector_store_epoch_rotate_v1(p_wire text) returns jsonb language plpgsql volatile security definer set search_path='' as $$begin perform collector_private.assert_rc_v1();return collector_private.apply_v1(p_wire,array['ROTATE_EPOCH_AND_FREEZE']);end$$;
create function collector_api.collector_effect_lookup_v1(p_wire text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c jsonb;a jsonb;s collector_private.collector_store_v1;e collector_private.collector_effect_v1;state text;reason text:=null;
begin perform collector_private.assert_rc_v1();c:=collector_private.wire_v1(p_wire,array['LOOKUP_EFFECT']);a:=c->'args';perform pg_catalog.set_config('lock_timeout','2000ms',true);perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collector/I/'||(c->>'stableStoreId')||'/'||(a->>'effectKey'),0));perform 1 from collector_private.collector_store_v1 where singleton for share;select * into s from collector_private.collector_store_v1 where singleton;
if s.stable_store_id::text<>c->>'stableStoreId' then perform collector_private.fail_v1('STORE_MISMATCH');end if;perform collector_private.actor_v1(s,array[collector_private.operation_kind_v1(a->>'originalOperation')]);
select * into e from collector_private.collector_effect_v1 where effect_key=a->>'effectKey';
if found then if e.operation<>a->>'originalOperation' or e.request_digest<>a->>'requestDigest' or e.store_epoch::text<>c->>'storeEpoch' then perform collector_private.fail_v1('EFFECT_CONFLICT');end if;perform collector_private.effect_audit_v1(s,e);state:='APPLIED';else state:=case when s.store_epoch::text=c->>'storeEpoch' then 'ABSENT_AT_LOOKUP' else 'STALE_EPOCH_UNKNOWN' end;end if;
return collector_private.flags_v1()||pg_catalog.jsonb_build_object('stableStoreId',s.stable_store_id::text,'storeEpoch',c->>'storeEpoch','operation','LOOKUP_EFFECT','effectKey',a->>'effectKey','requestDigest',a->>'requestDigest','effectState',state,'temporalMeaning','HISTORICAL_COMMIT','currentUse','NOT_AUTHORIZED_BY_RECEIPT','currentReadRequired',true,'content',pg_catalog.jsonb_build_object('state','WITHHELD'),'receipt',case when state='APPLIED' then e.receipt else null end,'reason',reason);
exception when lock_not_available or query_canceled then return collector_private.flags_v1()||pg_catalog.jsonb_build_object('stableStoreId',c->>'stableStoreId','storeEpoch',c->>'storeEpoch','operation','LOOKUP_EFFECT','effectKey',a->>'effectKey','requestDigest',a->>'requestDigest','effectState','UNKNOWN','temporalMeaning','HISTORICAL_COMMIT','currentUse','NOT_AUTHORIZED_BY_RECEIPT','currentReadRequired',true,'content',pg_catalog.jsonb_build_object('state','WITHHELD'),'receipt',null,'reason','LOCK_WAIT_TIMEOUT');
end$$;

revoke all on all tables in schema collector_private from public,collector_executor_v1,collector_reader_v1,collector_authority_v1,collector_maintenance_v1;
revoke all on all sequences in schema collector_private from public,collector_executor_v1,collector_reader_v1,collector_authority_v1,collector_maintenance_v1;
revoke all on all functions in schema collector_private from public,collector_executor_v1,collector_reader_v1,collector_authority_v1,collector_maintenance_v1;
revoke all on all functions in schema collector_api from public,collector_executor_v1,collector_reader_v1,collector_authority_v1,collector_maintenance_v1;
grant usage on schema collector_api to collector_executor_v1,collector_reader_v1,collector_authority_v1,collector_maintenance_v1;
grant execute on function collector_api.collector_store_identity_v1() to collector_executor_v1,collector_reader_v1,collector_authority_v1,collector_maintenance_v1;
grant execute on function collector_api.collector_grant_write_v1(text) to collector_authority_v1;
grant execute on function collector_api.collector_delivery_put_v1(text),collector_api.collector_body_attach_v1(text) to collector_executor_v1;
grant execute on function collector_api.collector_body_read_v1(text) to collector_executor_v1,collector_reader_v1,collector_authority_v1,collector_maintenance_v1;
grant execute on function collector_api.collector_effect_lookup_v1(text) to collector_executor_v1,collector_authority_v1,collector_maintenance_v1;
grant execute on function collector_api.collector_document_block_v1(text),collector_api.collector_store_epoch_rotate_v1(text) to collector_maintenance_v1;
commit;
