/** Synthetic, in-process analysis orchestration. Results have no publication authority. */
import {
  PIPELINE_CONTRACT, pipelineCanonical, pipelineId, pipelineInstant, validateSourceRevision,
  type PipelineSourceRevision, type PipelineVersions,
} from '../../../packages/contracts/src/pipeline.ts';
import {collectorDataV1, collectorRecordV1, collectorExactV1, type KnownV1} from '../../collectors/src/collector-db-contracts-v1.ts';
import {
  isOwnedDurableAnalysisInputPort, type OwnedDurableAnalysisInputPort,
  type DurableAnalysisInputV1, type DurableAnalysisRequestV1,
} from './durable-input.ts';
import {
  prepareMetadataRequest, acceptMetadataProposal,
  type MetadataContext, type MetadataRequest, type MetadataResult,
} from './metadata-intake.ts';
import {
  prepareEventRoutingRequest, acceptEventRoutingProposal,
  type EventRoutingContext, type EventRoutingResult,
} from './event-routing.ts';

interface Hash {update(value: string): Hash; digest(encoding: 'hex'): string;}
declare const process: {getBuiltinModule(name: 'node:crypto'): {createHash(name: 'sha256'): Hash}};
const {createHash} = process.getBuiltinModule('node:crypto');
const hash = (value: unknown) => createHash('sha256').update(pipelineCanonical(value)).digest('hex');
const copy = <T>(value: T): T => collectorDataV1(value) as T;
const flags = Object.freeze({
  schema: 'SYNTHETIC_ANALYSIS_RUN_V1' as const, sampleKind: 'SYNTHETIC' as const,
  persistence: 'MEMORY_FIXTURE_ONLY' as const, fixtureAssertionOnly: true as const,
  providerExecutionEnabled: false as const, publicationAuthorized: false as const,
  changesPublicTimestamps: false as const, crossWorkerAtomicityProven: false as const,
});

export interface AnalysisRunRequest {
  source: DurableAnalysisRequestV1;
  routingKey: string | null;
}
export interface AnalysisRunResult {
  schema: typeof flags.schema;
  sampleKind: 'SYNTHETIC';
  persistence: 'MEMORY_FIXTURE_ONLY';
  fixtureAssertionOnly: true;
  providerExecutionEnabled: false;
  publicationAuthorized: false;
  changesPublicTimestamps: false;
  crossWorkerAtomicityProven: false;
  effectKey: string;
  disposition: 'PASS' | 'REQUEST_EVIDENCE' | 'PLAN' | 'HOLD';
  reason: string;
  originalRequestDigest: string | null;
  validationRequestDigest: string | null;
  validatedAt: string | null;
  metadata: MetadataResult | null;
  routing: EventRoutingResult | null;
}
export type AnalysisRoutingFixture = Omit<EventRoutingContext, 'versions' | 'asOf' | 'revisions' | 'eligibility'>;
export interface AnalysisFixtureModels {
  metadata(input: {request: MetadataRequest; requestDigest: string}): Promise<unknown>;
  routing(input: {request: EventRoutingContext; requestDigest: string; content: {kind: 'UNTRUSTED_ORIGINAL_TEXT'; text: string}}): Promise<unknown>;
}
interface Binding {
  checkedAt: string;
  metadata: MetadataContext;
  revision: PipelineSourceRevision;
  eligibility: MetadataContext['eligibility'];
  input: DurableAnalysisInputV1;
}
interface Job {
  commandDigest: string;
  phase: 'RUNNING' | 'COMPLETE' | 'UNKNOWN';
  handle: object | null;
  bindingDigest: string | null;
  routingDigest: string | null;
  result: AnalysisRunResult | null;
}

function invalid(): never {throw new Error('ANALYSIS_INPUT_BINDING_INVALID');}
function known<T>(value: KnownV1<T>): T {
  if (value.state !== 'KNOWN') invalid();
  return value.value;
}
function instant(value: string): number {
  const at = pipelineInstant(value);
  if (!Number.isFinite(at)) invalid();
  return at;
}
function binding(input: DurableAnalysisInputV1): Binding {
  const text = input.content.text;
  if (!text.startsWith('SYNTHETIC ')) invalid();
  const envelope = collectorRecordV1(JSON.parse(text.slice(10)));
  collectorExactV1(envelope, ['title', 'lead', 'body']);
  if (typeof envelope.title !== 'string' || !envelope.title || envelope.title.length > 500 || envelope.title.trim() !== envelope.title
    || typeof envelope.lead !== 'string' || envelope.lead.length > 4000
    || typeof envelope.body !== 'string' || !envelope.body.trim()
    || JSON.stringify({title: envelope.title, lead: envelope.lead, body: envelope.body}) !== text.slice(10)) invalid();
  const source = input.source;
  const grant = known(known(source.grants.current).grant);
  const permissionVersion = 'grant-' + createHash('sha256')
    .update(JSON.stringify([grant.grantId, grant.grantGeneration, grant.grantVersion])).digest('hex');
  const versions: PipelineVersions = {
    contractVersion: PIPELINE_CONTRACT, sampleKind: 'SYNTHETIC',
    policyVersion: input.versions.analysisPolicyVersion, catalogVersion: input.versions.catalogVersion,
    sourcePolicyVersion: grant.sourcePolicyVersion,
  };
  const revision = validateSourceRevision({
    ...versions, sourceDocumentId: source.identity.documentId, revisionId: source.identity.deliveryId,
    sourceId: known(source.identity.sourceId), endpointId: known(source.identity.endpointId),
    nativeId: known(source.identity.nativeId), publisherId: known(source.provenance.publisherId),
    originId: known(source.provenance.originId), independenceGroupId: known(source.provenance.independenceGroupId),
    canonicalUrl: 'https://fixture.invalid/document/' + source.identity.documentId,
    collectedAt: known(source.observation.deliveryAcceptedAt), publishedAt: known(source.sourceTime.publishedAt),
    updatedAt: source.sourceTime.updatedAt.state === 'KNOWN' ? source.sourceTime.updatedAt.value : null,
    timeQuality: 'KNOWN', contentHash: known(source.integrity.bodyHash), title: envelope.title, lead: envelope.lead,
    bodyRef: 'fixture:/collector/' + source.store.stableStoreId + '/' + known(source.identity.bodyId), permissionVersion,
  });
  const expiresAt = [grant.expiresAt, known(source.validity.rightsExpiresAt), known(source.validity.retentionUntil),
    known(source.validity.effectiveUsableUntil), source.validity.auditRetentionUntil]
    .sort((a, b) => instant(a) - instant(b))[0];
  if (instant(expiresAt) <= instant(input.checkedAt)) invalid();
  const eligibility = {
    revisionId: revision.revisionId, permissionVersion, sourcePolicyVersion: versions.sourcePolicyVersion,
    analysisAllowed: grant.purposes.ANALYSIS === 'ALLOW', expiresAt,
  };
  return {
    input, revision, eligibility, checkedAt: input.checkedAt,
    metadata: {
      versions, revisions: [revision], revisionId: revision.revisionId, asOf: input.checkedAt,
      sectorIds: [...input.sectorIds], eligibility,
      promptVersion: input.versions.promptVersion, generatorVersion: input.versions.generatorVersion,
    },
  };
}
function semanticDigest(context: MetadataContext | EventRoutingContext): string {
  const {asOf, ...semantic} = context;
  return hash(semantic);
}
function rebind(raw: unknown, original: string, current: string): unknown {
  const response = collectorRecordV1(copy(raw));
  if (response.requestDigest !== original) throw new Error('ANALYSIS_REQUEST_MISMATCH');
  return {...response, requestDigest: current};
}
const routingKeys = [
  'schema', 'deadlineAt', 'storyId', 'storyVersion', 'canonicalEventKey', 'issueSetVersion',
  'completeIssueIds', 'issues', 'decision', 'claims', 'paths', 'corrections', 'delta', 'promptVersion', 'generatorVersion',
];

/** Models and loadRouting are trusted synthetic fixture callbacks, not a security sandbox. */
export function createSyntheticAnalysisRunner(
  port: OwnedDurableAnalysisInputPort,
  models: AnalysisFixtureModels,
  loadRouting: (key: string, revision: PipelineSourceRevision) => AnalysisRoutingFixture,
) {
  if (!isOwnedDurableAnalysisInputPort(port) || typeof loadRouting !== 'function') invalid();
  const modelCalls = ['metadata', 'routing'].map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(models, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') invalid();
    return descriptor.value as (input: unknown) => Promise<unknown>;
  });
  const jobs = new Map<string, Job>();
  const result = (effectKey: string, reason: string, patch: Partial<AnalysisRunResult> = {}): AnalysisRunResult => ({
    ...flags, effectKey, disposition: 'HOLD', reason, originalRequestDigest: null,
    validationRequestDigest: null, validatedAt: null, metadata: null, routing: null, ...patch,
  });
  function routing(current: Binding, key: string): EventRoutingContext {
    const fixture = collectorRecordV1(copy(loadRouting(key, copy(current.revision))));
    collectorExactV1(fixture, routingKeys);
    if (fixture.promptVersion !== current.metadata.promptVersion || fixture.generatorVersion !== current.metadata.generatorVersion) invalid();
    return {
      ...fixture, versions: current.metadata.versions, asOf: current.checkedAt,
      revisions: [current.revision], eligibility: [current.eligibility],
    } as unknown as EventRoutingContext;
  }
  async function read(job: Job): Promise<Binding> {
    if (!job.handle) invalid();
    const response = await port.readOwnedAnalysisInput(job.handle);
    if (response.disposition !== 'READY_SYNTHETIC_INPUT') throw new Error('ANALYSIS_SOURCE_NOT_CURRENT');
    const current = binding(response.input);
    if (job.bindingDigest !== null && semanticDigest(current.metadata) !== job.bindingDigest) invalid();
    return current;
  }
  async function run(effectKey: string, raw: AnalysisRunRequest): Promise<AnalysisRunResult> {
    if (!pipelineId(effectKey)) invalid();
    let request: AnalysisRunRequest;
    try {
      const data = collectorRecordV1(copy(raw));
      collectorExactV1(data, ['source', 'routingKey']);
      if (data.routingKey !== null && !pipelineId(data.routingKey)) invalid();
      request = data as unknown as AnalysisRunRequest;
    } catch {return result(effectKey, 'INPUT_BINDING_INVALID');}
    const commandDigest = hash(request);
    const prior = jobs.get(effectKey);
    if (prior) {
      if (prior.commandDigest !== commandDigest) return result(effectKey, 'EFFECT_CONFLICT');
      if (prior.phase === 'RUNNING') return result(effectKey, 'RUNNING');
      if (prior.phase === 'UNKNOWN') return copy(prior.result!);
      try {
        if (prior.handle) {
          const current = await read(prior);
          if (prior.result?.validatedAt && instant(current.checkedAt) < instant(prior.result.validatedAt)) invalid();
          if (prepareMetadataRequest(current.metadata).state !== 'READY_FOR_METADATA_MODEL') invalid();
          if (prior.routingDigest && request.routingKey) {
            const context = routing(current, request.routingKey);
            if (semanticDigest(context) !== prior.routingDigest || prepareEventRoutingRequest(context).state !== 'READY_FOR_ROUTING_MODEL') invalid();
          }
        }
        return copy(prior.result!);
      } catch {return result(effectKey, 'CURRENT_INPUT_REQUIRED');}
    }
    if (jobs.size >= 128) return result(effectKey, 'RUNNER_CAPACITY');
    const job: Job = {commandDigest, phase: 'RUNNING', handle: null, bindingDigest: null, routingDigest: null, result: null};
    jobs.set(effectKey, job);
    const finish = (value: AnalysisRunResult, unknown = false) => {
      job.result = copy(value);
      job.phase = unknown ? 'UNKNOWN' : 'COMPLETE';
      return copy(value);
    };
    try {
      const first = await port.readForAnalysis(request.source);
      if (first.disposition !== 'READY_SYNTHETIC_INPUT') return finish(result(effectKey, 'CURRENT_INPUT_REQUIRED'));
      job.handle = first.handle;
      let current = await read(job);
      if (instant(current.checkedAt) < instant(first.checkedAt)) invalid();
      job.bindingDigest = semanticDigest(current.metadata);
      const metadataRequest = prepareMetadataRequest(current.metadata);
      if (metadataRequest.state !== 'READY_FOR_METADATA_MODEL') return finish(result(effectKey, metadataRequest.result.reason));
      let proposal: unknown;
      try {proposal = await modelCalls[0](copy({request: metadataRequest.request, requestDigest: metadataRequest.requestDigest}));}
      catch {return finish(result(effectKey, 'MODEL_RESPONSE_UNKNOWN'), true);}
      const afterMetadata = await read(job);
      if (instant(afterMetadata.checkedAt) < instant(current.checkedAt)) invalid();
      const refreshedMetadata = prepareMetadataRequest(afterMetadata.metadata);
      if (refreshedMetadata.state !== 'READY_FOR_METADATA_MODEL') return finish(result(effectKey, refreshedMetadata.result.reason));
      const metadata = acceptMetadataProposal(afterMetadata.metadata, rebind(proposal, metadataRequest.requestDigest, refreshedMetadata.requestDigest));
      const evidence = {
        originalRequestDigest: metadataRequest.requestDigest, validationRequestDigest: refreshedMetadata.requestDigest,
        validatedAt: afterMetadata.checkedAt, metadata,
      };
      if (metadata.disposition !== 'REQUEST_EVIDENCE' || request.routingKey === null) {
        return finish(result(effectKey, metadata.reason, {...evidence, disposition: metadata.disposition}));
      }
      current = await read(job);
      if (instant(current.checkedAt) < instant(afterMetadata.checkedAt)) invalid();
      const context = routing(current, request.routingKey);
      job.routingDigest = semanticDigest(context);
      const routingRequest = prepareEventRoutingRequest(context);
      if (routingRequest.state !== 'READY_FOR_ROUTING_MODEL') return finish(result(effectKey, routingRequest.result.reason, {...evidence, routing: routingRequest.result}));
      try {
        proposal = await modelCalls[1](copy({
          request: routingRequest.request, requestDigest: routingRequest.requestDigest,
          content: current.input.content,
        }));
      } catch {return finish(result(effectKey, 'MODEL_RESPONSE_UNKNOWN', evidence), true);}
      const afterRouting = await read(job);
      if (instant(afterRouting.checkedAt) < instant(current.checkedAt)) invalid();
      const freshContext = routing(afterRouting, request.routingKey);
      if (semanticDigest(freshContext) !== job.routingDigest) invalid();
      const refreshedRouting = prepareEventRoutingRequest(freshContext);
      if (refreshedRouting.state !== 'READY_FOR_ROUTING_MODEL') return finish(result(effectKey, refreshedRouting.result.reason, {...evidence, routing: refreshedRouting.result}));
      const routed = acceptEventRoutingProposal(freshContext, rebind(proposal, routingRequest.requestDigest, refreshedRouting.requestDigest));
      return finish(result(effectKey, routed.reason, {
        metadata, routing: routed, disposition: routed.disposition === 'PLAN' ? 'PLAN' : 'HOLD',
        originalRequestDigest: routingRequest.requestDigest, validationRequestDigest: refreshedRouting.requestDigest,
        validatedAt: afterRouting.checkedAt,
      }));
    } catch (error) {
      const reason = error instanceof Error && error.message === 'ANALYSIS_REQUEST_MISMATCH' ? 'REQUEST_MISMATCH' : 'CURRENT_INPUT_REQUIRED';
      return finish(result(effectKey, reason));
    }
  }
  return Object.freeze({
    run,
    lookup(effectKey: string) {
      if (!pipelineId(effectKey)) invalid();
      const job = jobs.get(effectKey);
      return job ? {state: job.phase, diagnosticOnly: true as const, result: copy(job.result)}
        : {state: 'UNKNOWN_EFFECT' as const, diagnosticOnly: true as const, result: null};
    },
  });
}
