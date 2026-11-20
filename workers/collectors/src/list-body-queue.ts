/** Worker client for the isolated collector queue. The caller supplies the database transport. */
import {collectorTypedDigestV1} from './collector-db-canonical-v1.ts';
import {
  CollectorDbErrorV1, collectorDataV1, collectorDecimalV1, collectorDigestV1, collectorExactV1, collectorIdV1,
  collectorInstantV1, collectorRecordV1, collectorRejectV1, collectorUtf8V1, collectorUuidV1,
  validateCollectorExpectedIdentityV1, type CollectorDbExpectedIdentityV1,
} from './collector-db-contracts-v1.ts';
import {validateCollectorIdentityV1} from './collector-db-rpc-v1.ts';

const RPC = {
  identity: 'collector_store_identity_v1',
  stage: 'collector_list_queue_stage_v1',
  claim: 'collector_list_queue_claim_v1',
  settle: 'collector_list_queue_settle_v1',
  checkpoint: 'collector_list_queue_checkpoint_v1',
} as const;

export type CollectorQueueCallV1 = (
  rpc: (typeof RPC)[keyof typeof RPC],
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

type Item = { deliveryId: string; title: string; lead: string };
type Grant = { grantId: string; grantGeneration: string; grantVersion: string; sourcePolicyVersion: string };
type Claim = Item & { policyVersion: string; leaseExpiresAt: string };
export type StagedCollectorPageV1 = {
  pageId: string;
  manifestDigest: string;
  version: string;
  cursorRef: string | null;
};
type Page = {
  partition: string;
  source: string;
  endpoint: string;
  grant: Grant;
  policyVersion: string;
  pageId: string;
  version: string;
  cursorRef: string | null;
  nextCursorRef: string | null;
  items: readonly Item[];
};

function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  const value = collectorRecordV1(collectorDataV1(raw));
  collectorExactV1(value, keys);
  return value;
}

function text(value: unknown, limit: number, allowBlank = true): string {
  if (typeof value !== 'string' || [...value].length > limit || (!allowBlank && !value.replace(/^ +| +$/g, ''))) {
    collectorRejectV1();
  }
  collectorUtf8V1(value);
  return value;
}

function item(raw: unknown): Item {
  const value = record(raw, ['deliveryId', 'title', 'lead']);
  return {deliveryId: collectorUuidV1(value.deliveryId), title: text(value.title, 160, false),
    lead: text(value.lead, 420)};
}

function cursor(value: unknown): string | null {
  return value === null ? null : text(value, 128);
}

export class CollectorListQueueV1 {
  #call: CollectorQueueCallV1;
  #expected: CollectorDbExpectedIdentityV1;

  constructor(call: CollectorQueueCallV1, expected: CollectorDbExpectedIdentityV1) {
    this.#call = call;
    this.#expected = validateCollectorExpectedIdentityV1(expected);
  }

  async #request<T>(
    rpc: Exclude<(typeof RPC)[keyof typeof RPC], typeof RPC.identity>,
    params: Record<string, unknown>,
    decode: (value: unknown) => T,
  ): Promise<T> {
    const identity = validateCollectorIdentityV1(await this.#call(RPC.identity, Object.freeze({})));
    for (const key of ['productId', 'mode', 'bootstrapId', 'runId', 'stableStoreId', 'resourceIdentityDigest'] as const) {
      if (identity[key] !== this.#expected[key]) collectorRejectV1('STORE_MISMATCH');
    }
    if (identity.storeEpoch !== this.#expected.storeEpoch) collectorRejectV1('EPOCH_STALE');
    if (identity.state !== 'ACTIVE') collectorRejectV1('STORE_FROZEN');
    let response: unknown;
    try {
      response = await this.#call(rpc, Object.freeze(params));
    } catch (error) {
      if (error instanceof CollectorDbErrorV1) throw error;
      throw new CollectorDbErrorV1('COMMIT_UNKNOWN', true);
    }
    try {
      return decode(response);
    } catch {
      // A malformed acknowledgement cannot establish that the database rolled back.
      throw new CollectorDbErrorV1('COMMIT_UNKNOWN', true);
    }
  }

  async stage(raw: Page): Promise<StagedCollectorPageV1> {
    const p = record(raw, ['partition', 'source', 'endpoint', 'grant', 'policyVersion', 'pageId', 'version',
      'cursorRef', 'nextCursorRef', 'items']);
    const grant = record(p.grant, ['grantId', 'grantGeneration', 'grantVersion', 'sourcePolicyVersion']);
    const partition = collectorIdV1(p.partition);
    const version = collectorDecimalV1(p.version, 0n, 9223372036854775806n);
    const pageId = collectorUuidV1(p.pageId);
    const current = cursor(p.cursorRef);
    const next = cursor(p.nextCursorRef);
    if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > 100) collectorRejectV1();
    const items = p.items.map(item);
    if (new Set(items.map(entry => entry.deliveryId)).size !== items.length) collectorRejectV1('DUPLICATE_FIELD');
    const digest = collectorTypedDigestV1({partition, version, cursor:current, nextCursor:next, items});
    return this.#request(RPC.stage, {
      p_partition:partition, p_source:collectorIdV1(p.source), p_endpoint:collectorIdV1(p.endpoint),
      p_epoch:this.#expected.storeEpoch, p_grant: {
        grantId:collectorUuidV1(grant.grantId), grantGeneration:collectorDecimalV1(grant.grantGeneration,1n),
        grantVersion:collectorIdV1(grant.grantVersion), sourcePolicyVersion:collectorIdV1(grant.sourcePolicyVersion),
      },
      p_policy:collectorIdV1(p.policyVersion), p_page:pageId, p_version:version,
      p_cursor:current, p_next_cursor:next, p_items:items,
    }, result => {
      const r = record(result, ['manifestDigest']);
      if (r.manifestDigest !== digest) collectorRejectV1('HASH_MISMATCH');
      return {pageId, manifestDigest:digest, version:String(BigInt(version)+1n), cursorRef:next};
    });
  }

  async claim(pageId: string, leaseToken: string, seconds: number): Promise<Claim | null> {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) collectorRejectV1();
    return this.#request(RPC.claim, {p_page:collectorUuidV1(pageId), p_lease:collectorUuidV1(leaseToken),
      p_seconds:seconds}, value => {
      if (value === null) return null;
      const r = record(value, ['deliveryId', 'title', 'lead', 'policyVersion', 'leaseExpiresAt']);
      const {policyVersion, leaseExpiresAt, ...entry} = r;
      return {...item(entry), policyVersion:collectorIdV1(policyVersion), leaseExpiresAt:collectorInstantV1(leaseExpiresAt)};
    });
  }

  async skipBody(pageId: string, leaseToken: string, claim: Claim) {
    const {policyVersion, leaseExpiresAt, ...entry} = record(claim, ['deliveryId', 'title', 'lead', 'policyVersion', 'leaseExpiresAt']);
    collectorInstantV1(leaseExpiresAt);
    const listing = item(entry);
    const proof = collectorTypedDigestV1({decision:'SKIP_BODY', policyVersion:collectorIdV1(policyVersion), ...listing});
    return this.#settle(pageId, leaseToken, listing.deliveryId, 'SKIP_BODY', proof, null);
  }

  async bodyStored(pageId: string, leaseToken: string, deliveryId: string, bodyId: string, receiptDigest: string) {
    return this.#settle(pageId, leaseToken, deliveryId, 'BODY_STORED', collectorDigestV1(receiptDigest), collectorUuidV1(bodyId));
  }

  async #settle(pageId: string, leaseToken: string, deliveryId: string, outcome: 'SKIP_BODY' | 'BODY_STORED',
    proof: string, bodyId: string | null) {
    return this.#request(RPC.settle, {p_page:collectorUuidV1(pageId), p_lease:collectorUuidV1(leaseToken),
      p_delivery:collectorUuidV1(deliveryId), p_outcome:outcome, p_proof:proof, p_body:bodyId}, value => {
      const r = record(value, ['deliveryId', 'outcome', 'proof', 'bodyId']);
      if (r.deliveryId !== deliveryId || r.outcome !== outcome || r.proof !== proof || r.bodyId !== bodyId) {
        collectorRejectV1('EFFECT_CONFLICT');
      }
      return {deliveryId, outcome, proof, bodyId};
    });
  }

  async checkpoint(raw: StagedCollectorPageV1): Promise<StagedCollectorPageV1> {
    const p = record(raw, ['pageId', 'version', 'cursorRef', 'manifestDigest']);
    const pageId = collectorUuidV1(p.pageId);
    const digest = collectorDigestV1(p.manifestDigest);
    const version = collectorDecimalV1(p.version, 1n);
    const next = cursor(p.cursorRef);
    return this.#request(RPC.checkpoint, {p_page:pageId, p_manifest:digest}, value => {
      const r = record(value, ['pageId', 'version', 'cursorRef', 'manifestDigest']);
      if (r.pageId !== pageId || r.manifestDigest !== digest || r.version !== version || r.cursorRef !== next) {
        collectorRejectV1('EFFECT_CONFLICT');
      }
      return {pageId, manifestDigest:digest, version, cursorRef:next};
    });
  }
}
