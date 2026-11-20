/** Isolated handoff of an accepted analysis plan to the draft queue. */
import {pipelineCanonical, pipelineId} from '../../../packages/contracts/src/pipeline.ts';
import {
  collectorDataV1, collectorDigestV1, collectorExactV1, collectorRecordV1, collectorUuidV1,
  collectorDecimalV1,
} from '../../collectors/src/collector-db-contracts-v1.ts';
import {collectorBodyHashV1} from '../../collectors/src/collector-db-canonical-v1.ts';
import type {AnalysisRunResult} from './analysis-run.ts';

type OutboxCall = (
  operation: 'ai_proposal_save_v1' | 'ai_proposal_lookup_v1',
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

type DraftBinding = {
  inputDigest: string;
  bodyDigest: string;
  policyDigest: string;
  catalogDigest: string;
  expectedDraftRevision: string;
};

export type ProposalOutboxReceipt =
  | {state: 'PENDING_DRAFT'; effectKey: string; requestDigest: string; proposalId: string}
  | {state: 'CONFLICT' | 'NOT_FOUND' | 'UNKNOWN'; effectKey: string; requestDigest: string};

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
    proposal: {
      issueId,
      action: routing.action,
      angleCode: id(routing.angleCode),
      issueVersion: id(target[0].issueVersion),
      expectedDraftRevision: collectorDecimalV1(bound.expectedDraftRevision, 0n),
      claimIds: ids(routing.claimIds),
      pathIds: ids(routing.pathIds),
      inputDigest: collectorDigestV1(bound.inputDigest),
      bodyDigest: collectorDigestV1(bound.bodyDigest),
      policyDigest: collectorDigestV1(bound.policyDigest),
      catalogDigest: collectorDigestV1(bound.catalogDigest),
      modelRequestDigest: collectorDigestV1(routing.requestDigest),
      analysisValidationDigest: collectorDigestV1(analysis.validationRequestDigest),
    },
  };
}

function digest({effectKey, proposal: p}: ReturnType<typeof project>): string {
  // All fields are bounded ASCII IDs, digests or decimal strings. IDs contain neither delimiter.
  const preimage = ['AI_PROPOSAL_OUTBOX_V1', effectKey, p.issueId, p.action, p.angleCode, p.issueVersion,
    p.expectedDraftRevision, p.claimIds.join(','), p.pathIds.join(','), p.inputDigest, p.bodyDigest,
    p.policyDigest, p.catalogDigest, p.modelRequestDigest, p.analysisValidationDigest].join('\n');
  return collectorBodyHashV1(new TextEncoder().encode(preimage));
}

export class AiProposalOutboxV1 {
  #call: OutboxCall;

  constructor(call: OutboxCall) {
    this.#call = call;
  }

  async save(analysis: AnalysisRunResult, binding: DraftBinding): Promise<ProposalOutboxReceipt> {
    const command = project(analysis, binding);
    const {effectKey, proposal} = command;
    const requestDigest = digest(command);
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

  private async readReceipt(operation: Parameters<OutboxCall>[0], effectKey: string,
    requestDigest: string, args: Record<string, unknown>): Promise<ProposalOutboxReceipt> {
    try {
      // Pass an independent snapshot. PostgreSQL checks the digest before accepting it.
      const wire = JSON.parse(pipelineCanonical(args)) as Record<string, unknown>;
      const receipt = collectorRecordV1(collectorDataV1(await this.#call(operation, wire)));
      if (receipt.effectKey !== effectKey || receipt.requestDigest !== requestDigest) invalid();
      if (receipt.state === 'PENDING_DRAFT') {
        collectorExactV1(receipt, ['state', 'effectKey', 'requestDigest', 'proposalId']);
        return {state: receipt.state, effectKey, requestDigest, proposalId: collectorUuidV1(receipt.proposalId)};
      }
      if (receipt.state === 'CONFLICT' ||
          (operation === 'ai_proposal_lookup_v1' && receipt.state === 'NOT_FOUND')) {
        collectorExactV1(receipt, ['state', 'effectKey', 'requestDigest']);
        return {state: receipt.state, effectKey, requestDigest};
      }
      invalid();
    } catch {
      // A lost response does not authorize a new effect key or model call.
      return {state:'UNKNOWN', effectKey, requestDigest};
    }
  }
}
