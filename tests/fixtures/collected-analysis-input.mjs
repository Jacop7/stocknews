import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareCollectorInstallContext} from '../../scripts/test-main-p4-integration.mjs';
import {
  COLLECTOR_AUDIT_MASK_V1, COLLECTOR_DB_SCHEMA_V1, COLLECTOR_CANONICAL_ALG_V1,
  COLLECTOR_BODY_HASH_ALG_V1, COLLECTOR_RAW_HASH_ALG_V1, collectorKnownV1, collectorUnknownV1,
} from '../../workers/collectors/src/collector-db-contracts-v1.ts';
import {collectorBodyHashV1, collectorRequestDigestV1} from '../../workers/collectors/src/collector-db-canonical-v1.ts';
import {CollectorDbStoreV1, createOwnedCollectorDbReadPortV1} from '../../workers/collectors/src/collector-db-store-v1.ts';
import {createDurableAnalysisInputPort} from '../../workers/ai-processing/src/durable-input.ts';

export const collectorSql = 'workers/collectors/sql/collector_db_capture_v1.sql';

export async function collectAnalysisInput(db, article) {
  const {installContext, runtimeContext, identity, local} = await prepareCollectorInstallContext(db);
  const expectedSqlSha256 = db.contractSha256;
  const before = await local.verifyCollectorDbCaptureResourceV1(installContext, {stage:'BEFORE_APPLY', expectedSqlSha256});
  const applied = await local.applyCollectorDbCaptureSqlV1(installContext, {
    operation:'APPLY_REVIEWED_COLLECTOR_SQL', expectedSqlSha256, verifiedResource:before,
  });
  assert.equal(applied.status, 'APPLIED');
  const store = applied.storeIdentity;
  const verifiedResource = await local.verifyCollectorDbCaptureResourceV1(runtimeContext, {
    stage:'AFTER_APPLY', expectedSqlSha256,
  });
  const ports = await local.createCollectorDbCapturePortsV1(runtimeContext, {verifiedResource, expectedStoreIdentity:store});
  const authority = new CollectorDbStoreV1(ports.authorityPort, store);
  const executor = new CollectorDbStoreV1(ports.executorPort, store);
  const reader = new CollectorDbStoreV1(ports.readerPort, store);

  const {checkedAt, stableStoreId, storeEpoch} = await reader.readIdentity();
  const expiresAt = new Date(Date.parse(checkedAt) + 600_000).toISOString();
  const principals = identity.testLoginPrincipals;
  const sourceId = 'fixture-analysis';
  const endpointId = 'fixture-analysis/articles';
  const sourcePolicyVersion = 'source-v1';
  const provenance = {
    publisherId:collectorKnownV1('fixture-publisher'), originId:collectorKnownV1('fixture-origin'),
    independenceGroupId:collectorKnownV1('fixture-independent'),
    ownerGroupId:collectorUnknownV1(), newsroomId:collectorUnknownV1(),
  };
  const command = (operation, args) => {
    const request = {
      schema:COLLECTOR_DB_SCHEMA_V1, mode:'SYNTHETIC_ISOLATED_DB', fixtureAssertionOnly:true,
      physicalCommitTimeRightsProven:false, stableStoreId, storeEpoch, operation,
      effectKey:'fixture-analysis/' + operation + '/' + (args.deliveryId ?? 'grant'),
      canonicalAlg:COLLECTOR_CANONICAL_ALG_V1, args,
    };
    return {...request, requestDigest:collectorRequestDigestV1(request)};
  };
  const issued = await authority.issueGrant(command('ISSUE_GRANT', {
    sourceId, endpointId, expectedGeneration:'0', grantId:randomUUID(),
    grantVersion:'grant-v1', sourcePolicyVersion,
    purposes:Object.fromEntries(['MACHINE_ACCESS','DISCOVERY','LINK_EXTRACTION','QUERY_TERMS','ORIGINAL_ACCESS','STORAGE','ANALYSIS']
      .map(purpose => [purpose,'ALLOW'])),
    writePrincipal:principals.executor.name, readPrincipals:[principals.executor.name, principals.reader.name].sort(),
    scope:{hosts:['publisher.invalid'],paths:['/article'],methods:['GET']}, expiresAt, retentionMs:'600000',
    auditPolicyVersion:'SYNTHETIC_METADATA_V1', auditPrincipals:[principals.authority.name, principals.executor.name, principals.reader.name].sort(),
    auditRetentionUntil:expiresAt, auditFieldMask:[...COLLECTOR_AUDIT_MASK_V1].sort(),
    issuerRef:'fixture-authority', evidenceRef:'fixture-evidence', approvedProvenance:provenance,
  }));
  const {grantId,grantGeneration,grantVersion} = issued.outcome;
  const grant = {grantId,grantGeneration,grantVersion,sourcePolicyVersion};
  const text = 'SYNTHETIC ' + JSON.stringify(article);
  const bytes = new TextEncoder().encode(text);
  const bodyHash = collectorBodyHashV1(bytes);
  const capture = async () => {
    const deliveryId = randomUUID();
    const observedAt = (await reader.readIdentity()).checkedAt;
    const delivered = await executor.putDelivery(command('PUT_DELIVERY', {
      grant, deliveryId, sourceId, endpointId, nativeId:'results-'+deliveryId, rawObservationId:randomUUID(), itemOrdinal:'0',
      providerDeliveryRef:null, providerRevisionRef:'provider-revision-1', kind:'ORIGINAL_ARTICLE', purpose:'ORIGINAL_ACCESS',
      syntheticLocator:'https://publisher.invalid/article', observedAt, assertedProvenance:provenance,
      sourceTimes:{resolutionState:'KNOWN',timeQuality:'KNOWN',publishedAt:collectorKnownV1(observedAt),updatedAt:collectorUnknownV1()},
    }));
    const bodyId = randomUUID();
    await executor.attachBody(command('ATTACH_BODY', {
      grant, deliveryId, bodyId, purpose:'ORIGINAL_ACCESS', contentEncoding:'identity',
      rawHashAlg:COLLECTOR_RAW_HASH_ALG_V1, rawHash:bodyHash, bodyHashAlg:COLLECTOR_BODY_HASH_ALG_V1, bodyHash,
      rawByteLength:String(bytes.length), decodedByteLength:String(bytes.length), rawBytesBase64:Buffer.from(bytes).toString('base64'),
    }));
    return {
      documentId:delivered.outcome.documentId,
      source:{
        stableStoreId, storeEpoch, deliveryId, expectedBodyId:bodyId, expectedBodyHash:bodyHash,
        expectedBodyHashAlg:COLLECTOR_BODY_HASH_ALG_V1, expectedSourcePolicyVersion:sourcePolicyVersion,
      },
    };
  };
  return {
    port:createDurableAnalysisInputPort(createOwnedCollectorDbReadPortV1(reader)),
    expiresAt, text, capture, ...await capture(),
  };
}
