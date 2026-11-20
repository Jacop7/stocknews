/** Isolated handoff of an accepted analysis plan to the draft queue. */
import {pipelineCanonical, pipelineId} from '../../../packages/contracts/src/pipeline.ts';
import {
  collectorDataV1, collectorDigestV1, collectorExactV1, collectorRecordV1, collectorUuidV1,
  collectorDecimalV1,
} from '../../collectors/src/collector-db-contracts-v1.ts';
import {collectorBodyHashV1} from '../../collectors/src/collector-db-canonical-v1.ts';
import type {AnalysisRunResult} from './analysis-run.ts';

type OutboxOperation =
  'ai_proposal_save_v1' | 'ai_proposal_lookup_v1' | 'ai_proposal_read_pending_v1' | 'ai_proposal_apply_draft_v1';

type OutboxCall = (
  operation: OutboxOperation,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export type DraftBinding = {
  inputDigest: string;
  bodyDigest: string;
  policyDigest: string;
  catalogDigest: string;
  expectedDraftRevision: string;
};

export type ProposalOutboxReceipt =
  | {state: 'PENDING_DRAFT'; effectKey: string; requestDigest: string; proposalId: string}
  | {state: 'DRAFT_APPLIED'; effectKey: string; requestDigest: string; proposalId: string; draftRevision: string}
  | {state: 'CONFLICT' | 'NOT_FOUND' | 'UNKNOWN' | 'STALE_CONTEXT' | 'REVISION_CONFLICT'; effectKey: string; requestDigest: string};

function invalid(): never {
  throw new Error('AI_PROPOSAL_OUTBOX_INVALID');
}

function id(value: unknown): string {
  if (!pipelineId(value)) invalid();
  return value;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) invalid();
  const result = value.map(id);
  if (new Set(result).size !== result.length) invalid();
  return result;
}

function decodeProposal(raw: unknown) {
  const p = collectorRecordV1(raw);
  collectorExactV1(p, ['issueId', 'action', 'angleCode', 'issueVersion', 'expectedDraftRevision', 'claimIds',
    'pathIds', 'inputDigest', 'bodyDigest', 'policyDigest', 'catalogDigest', 'modelRequestDigest',
    'analysisValidationDigest']);
  const action = p.action;
  if (action !== 'UPDATE' && action !== 'CORRECTION') invalid();
  return {
    issueId: collectorUuidV1(p.issueId), action, angleCode: id(p.angleCode), issueVersion: id(p.issueVersion),
    expectedDraftRevision: collectorDecimalV1(p.expectedDraftRevision, 0n),
    claimIds: ids(p.claimIds), pathIds: ids(p.pathIds),
    inputDigest: collectorDigestV1(p.inputDigest), bodyDigest: collectorDigestV1(p.bodyDigest),
    policyDigest: collectorDigestV1(p.policyDigest), catalogDigest: collectorDigestV1(p.catalogDigest),
    modelRequestDigest: collectorDigestV1(p.modelRequestDigest),
    analysisValidationDigest: collectorDigestV1(p.analysisValidationDigest),
  };
}

export type PendingDraftProposalRead =
  | (Extract<ProposalOutboxReceipt, {state: 'PENDING_DRAFT'}> & {proposal: ReturnType<typeof decodeProposal>})
  | Exclude<ProposalOutboxReceipt, {state: 'PENDING_DRAFT'}>;

/**
 * The caller supplies the current, already validated source and draft bindings.
 * No article text, body locator, or publication instructions are projected.
 */
function project(raw: AnalysisRunResult, binding: DraftBinding) {
  const analysis = collectorRecordV1(collectorDataV1(raw));
  if (analysis.schema !== 'SYNTHETIC_ANALYSIS_RUN_V1' || analysis.sampleKind !== 'SYNTHETIC' ||
      analysis.disposition !== 'PLAN' || analysis.fixtureAssertionOnly !== true ||
      analysis.providerExecutionEnabled !== false || analysis.persistence !== 'MEMORY_FIXTURE_ONLY' ||
      analysis.publicationAuthorized !== false || analysis.changesPublicTimestamps !== false) invalid();
  const routing = collectorRecordV1(analysis.routing);
  if (routing.schema !== 'SYNTHETIC_EVENT_ROUTING_A2' || routing.sampleKind !== 'SYNTHETIC' ||
      routing.disposition !== 'PLAN' || routing.fixtureAssertionOnly !== true ||
      routing.executionEnabled !== false || routing.publicationAuthorized !== false ||
      routing.changesPublicTimestamps !== false ||
      (routing.action !== 'UPDATE' && routing.action !== 'CORRECTION')) invalid();
  const issueId = collectorUuidV1(routing.targetIssueId);
  if (!Array.isArray(routing.expectedIssueVersions)) invalid();
  const target = routing.expectedIssueVersions.map(collectorRecordV1)
    .filter(issue => issue.issueId === issueId);
  if (target.length !== 1) invalid();
  const bound = collectorRecordV1(collectorDataV1(binding));
  collectorExactV1(bound, ['inputDigest', 'bodyDigest', 'policyDigest', 'catalogDigest', 'expectedDraftRevision']);
  return {
    effectKey: id(analysis.effectKey),
    proposal: decodeProposal({
      issueId,
      action: routing.action,
      angleCode: routing.angleCode,
      issueVersion: target[0].issueVersion,
      expectedDraftRevision: bound.expectedDraftRevision,
      claimIds: routing.claimIds,
      pathIds: routing.pathIds,
      inputDigest: bound.inputDigest,
      bodyDigest: bound.bodyDigest,
      policyDigest: bound.policyDigest,
      catalogDigest: bound.catalogDigest,
      modelRequestDigest: routing.requestDigest,
      analysisValidationDigest: analysis.validationRequestDigest,
    }),
  };
}

function digest({effectKey, proposal: p}: ReturnType<typeof project>): string {
  // All fields are bounded ASCII IDs, digests or decimal strings. IDs contain neither delimiter.
  const preimage = ['AI_PROPOSAL_OUTBOX_V1', effectKey, p.issueId, p.action, p.angleCode, p.issueVersion,
    p.expectedDraftRevision, p.claimIds.join(','), p.pathIds.join(','), p.inputDigest, p.bodyDigest,
    p.policyDigest, p.catalogDigest, p.modelRequestDigest, p.analysisValidationDigest].join('\n');
  return collectorBodyHashV1(new TextEncoder().encode(preimage));
}

export function prepareSyntheticProposalCommand(analysis: AnalysisRunResult, binding: DraftBinding) {
  const command = project(analysis, binding);
  return {...command, requestDigest:digest(command)};
}

function decodeTerminal(receipt: Record<string, unknown>, effectKey: string, requestDigest: string,
  operation: OutboxOperation): Exclude<ProposalOutboxReceipt, {state:'PENDING_DRAFT'}> {
  const state = receipt.state;
  if (state === 'DRAFT_APPLIED') {
    collectorExactV1(receipt, ['state', 'effectKey', 'requestDigest', 'proposalId', 'draftRevision']);
    return {state, effectKey, requestDigest, proposalId:collectorUuidV1(receipt.proposalId),
      draftRevision:collectorDecimalV1(receipt.draftRevision,1n)};
  }
  if (state === 'CONFLICT' || (operation !== 'ai_proposal_save_v1' && state === 'NOT_FOUND') ||
      (operation === 'ai_proposal_apply_draft_v1' && (state === 'STALE_CONTEXT' || state === 'REVISION_CONFLICT'))) {
    collectorExactV1(receipt, ['state', 'effectKey', 'requestDigest']);
    return {state, effectKey, requestDigest};
  }
  return invalid();
}

export class AiProposalOutboxV1 {
  #call: OutboxCall;

  constructor(call: OutboxCall) {
    this.#call = call;
  }

  async save(analysis: AnalysisRunResult, binding: DraftBinding): Promise<ProposalOutboxReceipt> {
    const {effectKey, proposal, requestDigest} = prepareSyntheticProposalCommand(analysis, binding);
    return this.readReceipt('ai_proposal_save_v1', effectKey, requestDigest, {
      p_effect: effectKey, p_request_digest: requestDigest, p_proposal: proposal,
    });
  }

  /** NOT_FOUND describes the current read only. It cannot authorize replay of an uncertain write. */
  async lookup(effectKey: string, requestDigest: string): Promise<ProposalOutboxReceipt> {
    effectKey = id(effectKey);
    requestDigest = collectorDigestV1(requestDigest);
    return this.readReceipt('ai_proposal_lookup_v1', effectKey, requestDigest, {
      p_effect: effectKey, p_request_digest: requestDigest,
    });
  }

  /** Uses an editor transport. The fixture authority must have prepared an exact current draft context. */
  async applyDraft(effectKey: string, requestDigest: string): Promise<ProposalOutboxReceipt> {
    effectKey = id(effectKey);
    requestDigest = collectorDigestV1(requestDigest);
    return this.readReceipt('ai_proposal_apply_draft_v1', effectKey, requestDigest, {
      p_effect:effectKey, p_request_digest:requestDigest,
    });
  }

  /** Read an exact pending proposal for later draft validation. This does not reserve or apply it. */
  async readPending(effectKey: string, requestDigest: string): Promise<PendingDraftProposalRead> {
    effectKey = id(effectKey);
    requestDigest = collectorDigestV1(requestDigest);
    try {
      const raw = await this.#call('ai_proposal_read_pending_v1', {p_effect:effectKey, p_request_digest:requestDigest});
      const receipt = collectorRecordV1(collectorDataV1(raw));
      if (receipt.effectKey !== effectKey || receipt.requestDigest !== requestDigest) invalid();
      if (receipt.state !== 'PENDING_DRAFT') return decodeTerminal(receipt, effectKey, requestDigest,
        'ai_proposal_read_pending_v1');
      collectorExactV1(receipt, ['state', 'effectKey', 'requestDigest', 'proposalId', 'proposal']);
      const proposal = decodeProposal(receipt.proposal);
      if (digest({effectKey, proposal}) !== requestDigest) invalid();
      return {state:'PENDING_DRAFT', effectKey, requestDigest, proposalId:collectorUuidV1(receipt.proposalId), proposal};
    } catch {
      return {state:'UNKNOWN', effectKey, requestDigest};
    }
  }

  private async readReceipt(operation: OutboxOperation, effectKey: string,
    requestDigest: string, args: Record<string, unknown>): Promise<ProposalOutboxReceipt> {
    try {
      // Pass an independent snapshot. PostgreSQL checks the digest before accepting it.
      const wire = JSON.parse(pipelineCanonical(args)) as Record<string, unknown>;
      const receipt = collectorRecordV1(collectorDataV1(await this.#call(operation, wire)));
      if (receipt.effectKey !== effectKey || receipt.requestDigest !== requestDigest) invalid();
      if (receipt.state === 'PENDING_DRAFT' && operation !== 'ai_proposal_apply_draft_v1') {
        collectorExactV1(receipt, ['state', 'effectKey', 'requestDigest', 'proposalId']);
        return {state: receipt.state, effectKey, requestDigest, proposalId: collectorUuidV1(receipt.proposalId)};
      }
      return decodeTerminal(receipt, effectKey, requestDigest, operation);
    } catch {
      // A lost response does not authorize a new effect key or model call.
      return {state:'UNKNOWN', effectKey, requestDigest};
    }
  }
}
