begin;

-- This component is installed after collector_db_capture_v1 in its isolated
-- development database. The caller must bind the existing store identity.
do $$
begin
  if not exists (
    select 1 from collector_private.collector_store_v1
    where singleton and product_id = 'judoju-news' and mode = 'SYNTHETIC_ISOLATED_DB'
      and state = 'ACTIVE'
      and resource_identity_digest = current_setting('collector.queue_fixture_v1', true)
  ) then
    raise exception 'QUEUE_FIXTURE_NOT_BOUND';
  end if;
end
$$;
set local role collector_owner_v1;

create table collector_private.list_queue_partition_v1 (
  partition_id text primary key,
  source_id text not null,
  endpoint_id text not null,
  store_epoch bigint not null,
  grant_binding jsonb not null,
  policy_version text not null,
  version bigint not null default 0,
  cursor_ref text
);

create table collector_private.list_queue_page_v1 (
  page_id uuid primary key,
  partition_id text not null references collector_private.list_queue_partition_v1(partition_id),
  version bigint not null,
  next_cursor_ref text,
  manifest_digest text not null,
  checkpoint jsonb,
  unique (partition_id, version),
  unique (page_id, partition_id)
);

create table collector_private.list_queue_job_v1 (
  partition_id text not null references collector_private.list_queue_partition_v1(partition_id),
  delivery_id uuid not null references collector_private.collector_delivery_v1(delivery_id),
  title text not null,
  lead text not null,
  lease_token uuid unique,
  lease_expires_at timestamptz,
  outcome text check (outcome in ('SKIP_BODY', 'BODY_STORED')),
  proof text,
  body_id uuid references collector_private.collector_body_v1(body_id),
  primary key (partition_id, delivery_id)
);

create table collector_private.list_queue_page_item_v1 (
  page_id uuid not null,
  partition_id text not null,
  delivery_id uuid not null,
  ordinal integer not null,
  primary key (page_id, delivery_id),
  unique (page_id, ordinal),
  foreign key (page_id, partition_id) references collector_private.list_queue_page_v1(page_id, partition_id),
  foreign key (partition_id, delivery_id) references collector_private.list_queue_job_v1(partition_id, delivery_id)
);

create table collector_private.list_queue_lease_v1 (
  lease_token uuid primary key,
  page_id uuid not null,
  delivery_id uuid not null,
  receipt jsonb,
  foreign key (page_id, delivery_id) references collector_private.list_queue_page_item_v1(page_id, delivery_id)
);

create function collector_private.list_queue_authorize_v1(
  p_source text, p_endpoint text, p_epoch bigint, p_grant jsonb, p_purposes text[]
) returns void language plpgsql volatile set search_path = '' as $$
declare
  s collector_private.collector_store_v1;
  g collector_private.collector_grant_v1;
  principal text;
begin
  perform collector_private.assert_rc_v1();
  select * into strict s from collector_private.collector_store_v1 where singleton for share;
  if s.state <> 'ACTIVE' or s.store_epoch <> p_epoch then
    perform collector_private.fail_v1('EPOCH_STALE');
  end if;
  principal := collector_private.actor_v1(s, array['executor'])->>'principalName';
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('collector/H/' || p_source || '/' || p_endpoint, 0));
  perform 1 from collector_private.collector_grant_head_v1
    where source_id = p_source and endpoint_id = p_endpoint for share;
  g := collector_private.current_grant_v1(p_source, p_endpoint);
  perform collector_private.check_grant_v1(g, p_grant, principal, p_purposes, pg_catalog.clock_timestamp());
  if g.store_epoch <> s.store_epoch then
    perform collector_private.fail_v1('POLICY_STALE');
  end if;
end
$$;

create function collector_api.collector_list_queue_stage_v1(
  p_partition text, p_source text, p_endpoint text, p_epoch bigint, p_grant jsonb, p_policy text,
  p_page uuid, p_version bigint, p_cursor text, p_next_cursor text, p_items jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  part collector_private.list_queue_partition_v1;
  page collector_private.list_queue_page_v1;
  entry jsonb;
  item_number integer;
  delivery uuid;
  manifest text;
begin
  perform collector_private.id_v1(pg_catalog.to_jsonb(p_partition));
  perform collector_private.id_v1(pg_catalog.to_jsonb(p_source));
  perform collector_private.id_v1(pg_catalog.to_jsonb(p_endpoint));
  perform collector_private.id_v1(pg_catalog.to_jsonb(p_policy));
  perform collector_private.binding_guard_v1(p_grant);
  if p_page is null or p_version is null or p_version < 0 or p_epoch is null
    or length(p_cursor) > 128 or length(p_next_cursor) > 128
    or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
    or octet_length(p_items::text) > 131072 then
    perform collector_private.fail_v1('INVALID_INPUT');
  end if;
  if pg_catalog.jsonb_array_length(p_items) not between 1 and 100 then
    perform collector_private.fail_v1('INVALID_INPUT');
  end if;
  perform collector_private.list_queue_authorize_v1(p_source, p_endpoint, p_epoch, p_grant, array['DISCOVERY','STORAGE']);
  manifest := collector_private.digest_v1(pg_catalog.jsonb_build_object(
    'partition', p_partition, 'version', p_version::text, 'cursor', p_cursor, 'nextCursor', p_next_cursor, 'items', p_items));
  insert into collector_private.list_queue_partition_v1
    (partition_id, source_id, endpoint_id, store_epoch, grant_binding, policy_version)
    values (p_partition, p_source, p_endpoint, p_epoch, p_grant, p_policy) on conflict do nothing;
  select * into strict part from collector_private.list_queue_partition_v1
    where partition_id = p_partition for update;
  if (part.source_id, part.endpoint_id, part.store_epoch, part.grant_binding, part.policy_version)
    is distinct from (p_source, p_endpoint, p_epoch, p_grant, p_policy) then
    perform collector_private.fail_v1('POLICY_STALE');
  end if;
  select * into page from collector_private.list_queue_page_v1 where page_id = p_page;
  if found then
    if page.manifest_digest <> manifest then perform collector_private.fail_v1('EFFECT_CONFLICT'); end if;
    perform collector_private.list_queue_authorize_v1(p_source, p_endpoint, p_epoch, p_grant, array['DISCOVERY','STORAGE']);
    return pg_catalog.jsonb_build_object('manifestDigest', page.manifest_digest);
  end if;
  if part.version <> p_version or part.cursor_ref is distinct from p_cursor
    or exists (select 1 from collector_private.list_queue_page_v1 where partition_id = p_partition and version = p_version) then
    perform collector_private.fail_v1('EFFECT_CONFLICT');
  end if;
  insert into collector_private.list_queue_page_v1 values (p_page, p_partition, p_version, p_next_cursor, manifest, null);
  for entry, item_number in
    select value, ordinality::integer from pg_catalog.jsonb_array_elements(p_items) with ordinality
  loop
    perform collector_private.exact_v1(entry, array['deliveryId','title','lead']);
    delivery := collector_private.uuid_v1(entry->'deliveryId');
    if pg_catalog.jsonb_typeof(entry->'title') is distinct from 'string'
      or pg_catalog.jsonb_typeof(entry->'lead') is distinct from 'string'
      or length(btrim(entry->>'title')) not between 1 and 160 or length(entry->>'title') > 160
      or length(entry->>'lead') > 420
      or not exists (select 1 from collector_private.collector_delivery_v1 d
        where d.delivery_id = delivery and d.source_id = p_source and d.endpoint_id = p_endpoint
          and d.grant_id::text = p_grant->>'grantId' and d.grant_generation::text = p_grant->>'grantGeneration'
          and d.kind = 'DISCOVERY_METADATA') then
      perform collector_private.fail_v1('DELIVERY_CONFLICT');
    end if;
    perform collector_private.list_queue_guard_document_v1(delivery);
    insert into collector_private.list_queue_job_v1 (partition_id, delivery_id, title, lead)
      values (p_partition, delivery, entry->>'title', entry->>'lead') on conflict do nothing;
    if not exists (select 1 from collector_private.list_queue_job_v1
      where partition_id = p_partition and delivery_id = delivery and title = entry->>'title' and lead = entry->>'lead') then
      perform collector_private.fail_v1('DELIVERY_CONFLICT');
    end if;
    insert into collector_private.list_queue_page_item_v1 values (p_page, p_partition, delivery, item_number);
  end loop;
  perform collector_private.list_queue_authorize_v1(p_source, p_endpoint, p_epoch, p_grant, array['DISCOVERY','STORAGE']);
  return pg_catalog.jsonb_build_object('manifestDigest', manifest);
end
$$;

create function collector_api.collector_list_queue_claim_v1(p_page uuid, p_lease uuid, p_seconds integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  part collector_private.list_queue_partition_v1;
  job collector_private.list_queue_job_v1;
  old_lease collector_private.list_queue_lease_v1;
  staged_page collector_private.list_queue_page_v1;
  replay boolean;
  now_at timestamptz;
begin
  if p_page is null or p_lease is null or p_seconds is null or p_seconds not between 1 and 300 then
    perform collector_private.fail_v1('INVALID_INPUT');
  end if;
  select q.* into strict part from collector_private.list_queue_partition_v1 q
    join collector_private.list_queue_page_v1 p using (partition_id) where p.page_id = p_page;
  perform collector_private.list_queue_authorize_v1(part.source_id, part.endpoint_id, part.store_epoch,
    part.grant_binding, array['DISCOVERY','STORAGE']);
  perform 1 from collector_private.list_queue_partition_v1 where partition_id = part.partition_id for update;
  select * into strict staged_page from collector_private.list_queue_page_v1 where page_id = p_page;
  if staged_page.checkpoint is not null then return null; end if;
  now_at := pg_catalog.clock_timestamp();
  select * into old_lease from collector_private.list_queue_lease_v1 where lease_token = p_lease;
  replay := found;
  if replay then
    select * into job from collector_private.list_queue_job_v1
      where partition_id = part.partition_id and delivery_id = old_lease.delivery_id;
    if old_lease.page_id <> p_page or job.lease_token is distinct from p_lease
      or job.outcome is not null then
      perform collector_private.fail_v1('EFFECT_CONFLICT');
    end if;
  else
    select j.* into job from collector_private.list_queue_page_item_v1 i
      join collector_private.list_queue_job_v1 j using (partition_id, delivery_id)
      where i.page_id = p_page and ((j.outcome is null
        and (j.lease_expires_at is null or j.lease_expires_at <= now_at))
        or (j.outcome = 'BODY_STORED' and not collector_private.list_queue_body_proved_v1(
          j.delivery_id, j.body_id, j.proof, part.store_epoch, now_at)))
      order by i.ordinal limit 1 for update of j skip locked;
    if not found then return null; end if;
    -- A matching token in another partition can wait for its transaction
    -- before this insert succeeds. Recheck time-based authority afterward.
    insert into collector_private.list_queue_lease_v1 (lease_token, page_id, delivery_id)
      values (p_lease, p_page, job.delivery_id);
  end if;
  perform collector_private.list_queue_guard_document_v1(job.delivery_id);
  perform collector_private.list_queue_authorize_v1(part.source_id, part.endpoint_id, part.store_epoch,
    part.grant_binding, array['DISCOVERY','STORAGE']);
  now_at := pg_catalog.clock_timestamp();
  if replay then
    if job.lease_expires_at <= now_at then perform collector_private.fail_v1('EFFECT_CONFLICT'); end if;
  else
    update collector_private.list_queue_job_v1
      set lease_token = p_lease, lease_expires_at = now_at + p_seconds * interval '1 second', outcome = null
      where partition_id = job.partition_id and delivery_id = job.delivery_id returning * into job;
  end if;
  return pg_catalog.jsonb_build_object('deliveryId', job.delivery_id, 'title', job.title, 'lead', job.lead,
    'policyVersion', part.policy_version, 'leaseExpiresAt', collector_private.stamp_v1(job.lease_expires_at));
end
$$;

create function collector_private.list_queue_body_proved_v1(
  p_delivery uuid, p_body uuid, p_proof text, p_epoch bigint, p_checked_at timestamptz
) returns boolean language sql volatile set search_path = '' as $$
  select exists (
    select 1 from collector_private.collector_body_v1 b
      join collector_private.collector_delivery_v1 original on original.delivery_id = b.delivery_id
      join collector_private.collector_delivery_v1 metadata on metadata.delivery_id = p_delivery
      join collector_private.collector_effect_v1 e on e.effect_key = b.original_effect_key
    where b.body_id = p_body and original.kind = 'ORIGINAL_ARTICLE' and original.purpose = 'ORIGINAL_ACCESS'
      and (original.document_id, original.source_id, original.endpoint_id, original.grant_id, original.grant_generation)
        = (metadata.document_id, metadata.source_id, metadata.endpoint_id, metadata.grant_id, metadata.grant_generation)
      and original.accepted_at >= metadata.accepted_at
      and original.data->>'syntheticLocator' = metadata.data->>'syntheticLocator'
      and (original.data->>'providerRevisionRef') is not distinct from (metadata.data->>'providerRevisionRef')
      and (b.grant_id, b.grant_generation) = (metadata.grant_id, metadata.grant_generation)
      and e.operation = 'ATTACH_BODY' and e.store_epoch = p_epoch and e.receipt_digest = p_proof
      and e.receipt->'binding'->>'bodyId' = b.body_id::text
      and e.receipt->'binding'->>'deliveryId' = original.delivery_id::text
      and exists (select 1 from collector_private.collector_body_payload_v1 payload where payload.body_id = b.body_id)
      and p_checked_at < least(b.rights_expires_at, b.retention_until)
  )
$$;

create function collector_private.list_queue_guard_document_v1(p_delivery uuid)
returns void language plpgsql volatile set search_path = '' as $$
declare
  d collector_private.collector_delivery_v1;
begin
  select * into strict d from collector_private.collector_delivery_v1 where delivery_id = p_delivery;
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('collector/D/' || d.source_id || '/' || d.native_id, 0));
  if exists (select 1 from collector_private.collector_tombstone_v1
    where source_id = d.source_id and native_id = d.native_id) then
    perform collector_private.fail_v1('TOMBSTONED');
  end if;
end
$$;

create function collector_api.collector_list_queue_settle_v1(
  p_page uuid, p_delivery uuid, p_lease uuid, p_outcome text, p_proof text, p_body uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  part collector_private.list_queue_partition_v1;
  job collector_private.list_queue_job_v1;
  purposes text[] := array['DISCOVERY','STORAGE'];
  now_at timestamptz;
  settlement jsonb;
begin
  perform collector_private.hash_v1(pg_catalog.to_jsonb(p_proof));
  if p_outcome is null or p_outcome not in ('SKIP_BODY','BODY_STORED')
    or (p_outcome = 'SKIP_BODY') <> (p_body is null) then
    perform collector_private.fail_v1('INVALID_INPUT');
  end if;
  if p_outcome = 'BODY_STORED' then
    purposes := array_append(purposes, 'ORIGINAL_ACCESS');
  end if;
  select q.* into strict part from collector_private.list_queue_partition_v1 q
    join collector_private.list_queue_page_v1 p using (partition_id) where p.page_id = p_page;
  perform collector_private.list_queue_authorize_v1(part.source_id, part.endpoint_id, part.store_epoch,
    part.grant_binding, purposes);
  perform 1 from collector_private.list_queue_partition_v1 where partition_id = part.partition_id for update;
  select j.* into strict job from collector_private.list_queue_job_v1 j
    join collector_private.list_queue_page_item_v1 i using (partition_id, delivery_id)
    join collector_private.list_queue_lease_v1 l using (page_id, delivery_id)
    where i.page_id = p_page and j.delivery_id = p_delivery and l.lease_token = p_lease;
  if job.lease_token is distinct from p_lease then perform collector_private.fail_v1('EFFECT_CONFLICT'); end if;
  perform collector_private.list_queue_guard_document_v1(p_delivery);
  perform collector_private.list_queue_authorize_v1(part.source_id, part.endpoint_id, part.store_epoch, part.grant_binding, purposes);
  now_at := pg_catalog.clock_timestamp();
  if job.outcome is not null then
    if (job.outcome, job.proof, job.body_id) is distinct from (p_outcome, p_proof, p_body) then
      perform collector_private.fail_v1('EFFECT_CONFLICT');
    end if;
  else
    if job.lease_expires_at <= now_at then perform collector_private.fail_v1('LOCK_BUSY'); end if;
    if p_outcome = 'SKIP_BODY' then
      if job.body_id is not null then perform collector_private.fail_v1('RIGHTS_HOLD'); end if;
      if p_proof <> collector_private.digest_v1(pg_catalog.jsonb_build_object(
        'decision','SKIP_BODY','policyVersion',part.policy_version,'deliveryId',p_delivery,'title',job.title,'lead',job.lead)) then
        perform collector_private.fail_v1('HASH_MISMATCH');
      end if;
    elsif not collector_private.list_queue_body_proved_v1(p_delivery, p_body, p_proof, part.store_epoch, now_at) then
      perform collector_private.fail_v1('RIGHTS_HOLD');
    end if;
    update collector_private.list_queue_job_v1 set outcome = p_outcome, proof = p_proof, body_id = p_body
      where partition_id = part.partition_id and delivery_id = p_delivery;
  end if;
  settlement := pg_catalog.jsonb_build_object('deliveryId', p_delivery, 'outcome', p_outcome, 'proof', p_proof, 'bodyId', p_body);
  update collector_private.list_queue_lease_v1
    set receipt = settlement where lease_token = p_lease and receipt is null;
  return settlement;
end
$$;

create function collector_api.collector_list_queue_checkpoint_v1(p_page uuid, p_manifest text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  part collector_private.list_queue_partition_v1;
  page collector_private.list_queue_page_v1;
  job collector_private.list_queue_job_v1;
  now_at timestamptz;
  receipt jsonb;
begin
  perform collector_private.hash_v1(pg_catalog.to_jsonb(p_manifest));
  select q.* into strict part from collector_private.list_queue_partition_v1 q
    join collector_private.list_queue_page_v1 p using (partition_id) where p.page_id = p_page;
  perform collector_private.list_queue_authorize_v1(part.source_id, part.endpoint_id, part.store_epoch,
    part.grant_binding, array['DISCOVERY','STORAGE']);
  select * into strict part from collector_private.list_queue_partition_v1
    where partition_id = part.partition_id for update;
  select * into strict page from collector_private.list_queue_page_v1 where page_id = p_page;
  if page.manifest_digest <> p_manifest then perform collector_private.fail_v1('HASH_MISMATCH'); end if;
  if page.checkpoint is not null then
    perform collector_private.list_queue_authorize_v1(part.source_id, part.endpoint_id, part.store_epoch,
      part.grant_binding, array['DISCOVERY','STORAGE']);
    return page.checkpoint;
  end if;
  if page.version <> part.version then perform collector_private.fail_v1('EFFECT_CONFLICT'); end if;
  for job in
    select j.* from collector_private.list_queue_page_item_v1 i
      join collector_private.list_queue_job_v1 j using (partition_id, delivery_id)
      join collector_private.collector_delivery_v1 d using (delivery_id)
      where i.page_id = p_page order by d.native_id, j.delivery_id
  loop
    perform collector_private.list_queue_guard_document_v1(job.delivery_id);
    if job.outcome is null then perform collector_private.fail_v1('LOCK_BUSY'); end if;
  end loop;
  perform collector_private.list_queue_authorize_v1(part.source_id, part.endpoint_id, part.store_epoch,
    part.grant_binding, array['DISCOVERY','STORAGE']);
  now_at := pg_catalog.clock_timestamp();
  if exists (select 1 from collector_private.list_queue_page_item_v1 i
      join collector_private.list_queue_job_v1 j using (partition_id, delivery_id)
      where i.page_id = p_page and j.outcome = 'BODY_STORED'
        and not collector_private.list_queue_body_proved_v1(j.delivery_id, j.body_id, j.proof, part.store_epoch, now_at)) then
    perform collector_private.fail_v1('RIGHTS_HOLD');
  end if;
  receipt := pg_catalog.jsonb_build_object('version', (part.version + 1)::text, 'cursorRef', page.next_cursor_ref,
    'pageId', page.page_id, 'manifestDigest', page.manifest_digest);
  update collector_private.list_queue_partition_v1 set version = version + 1, cursor_ref = page.next_cursor_ref
    where partition_id = part.partition_id;
  update collector_private.list_queue_page_v1 set checkpoint = receipt where page_id = p_page;
  return receipt;
end
$$;

-- Read a staged page and its historical checkpoint without claiming or settling any work.
create function collector_api.collector_list_queue_observe_v1(p_page uuid,p_manifest text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  part collector_private.list_queue_partition_v1;
  result jsonb;
  observed_at timestamptz;
begin
  if p_page is null then perform collector_private.fail_v1('INVALID_INPUT'); end if;
  perform collector_private.hash_v1(pg_catalog.to_jsonb(p_manifest));
  select q.* into strict part from collector_private.list_queue_partition_v1 q
    join collector_private.list_queue_page_v1 p using (partition_id) where p.page_id=p_page;
  perform collector_private.list_queue_authorize_v1(part.source_id,part.endpoint_id,part.store_epoch,
    part.grant_binding,array['DISCOVERY','STORAGE']);
  -- Queue writes lock the partition before changing jobs or checkpoint state.
  perform 1 from collector_private.list_queue_partition_v1 where partition_id=part.partition_id for share;
  perform collector_private.list_queue_authorize_v1(part.source_id,part.endpoint_id,part.store_epoch,
    part.grant_binding,array['DISCOVERY','STORAGE']);
  observed_at:=pg_catalog.clock_timestamp();
  -- Checkpointed pages retain their completed counts when a later page reopens a shared job.
  select pg_catalog.jsonb_build_object('pageId',p.page_id,'manifestDigest',p.manifest_digest,
    'checkpoint',p.checkpoint,'total',pg_catalog.count(*),
    'settled',pg_catalog.count(*) filter(where case
      when p.checkpoint is not null then true
      when j.outcome = 'BODY_STORED' then collector_private.list_queue_body_proved_v1(
        j.delivery_id,j.body_id,j.proof,part.store_epoch,observed_at)
      else j.outcome = 'SKIP_BODY'
    end),
    'leased',pg_catalog.count(*) filter(where p.checkpoint is null and j.outcome is null
      and j.lease_expires_at>observed_at))
    into result
    from collector_private.list_queue_page_v1 p
    join collector_private.list_queue_page_item_v1 i using (page_id,partition_id)
    join collector_private.list_queue_job_v1 j using (partition_id,delivery_id)
    where p.page_id=p_page group by p.page_id;
  if result->>'manifestDigest' is distinct from p_manifest then
    perform collector_private.fail_v1('HASH_MISMATCH');
  end if;
  return result;
end
$$;

revoke all on function collector_api.collector_list_queue_stage_v1(
  text, text, text, bigint, jsonb, text, uuid, bigint, text, text, jsonb),
  collector_api.collector_list_queue_claim_v1(uuid, uuid, integer),
  collector_api.collector_list_queue_settle_v1(uuid, uuid, uuid, text, text, uuid),
  collector_api.collector_list_queue_checkpoint_v1(uuid, text),
  collector_api.collector_list_queue_observe_v1(uuid, text) from public;
grant execute on function collector_api.collector_list_queue_stage_v1(
  text, text, text, bigint, jsonb, text, uuid, bigint, text, text, jsonb),
  collector_api.collector_list_queue_claim_v1(uuid, uuid, integer),
  collector_api.collector_list_queue_settle_v1(uuid, uuid, uuid, text, text, uuid),
  collector_api.collector_list_queue_checkpoint_v1(uuid, text),
  collector_api.collector_list_queue_observe_v1(uuid, text) to collector_executor_v1;
commit;
