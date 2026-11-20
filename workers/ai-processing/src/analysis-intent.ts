/** Single-dispatch jobs using the isolated, autocommit PostgreSQL fixture transport. */
import {pipelineCanonical,pipelineId} from '../../../packages/contracts/src/pipeline.ts';
import {
  collectorDataV1,collectorDecimalV1,collectorDigestV1,collectorExactV1,collectorIdV1,collectorRecordV1,collectorUuidV1,
  validateCollectorBridgeRequestV1,
} from '../../collectors/src/collector-db-contracts-v1.ts';
import {collectorBodyHashV1} from '../../collectors/src/collector-db-canonical-v1.ts';
import type {AnalysisRunRequest,createSyntheticAnalysisRunner} from './analysis-run.ts';
import {prepareSyntheticProposalCommand,type DraftBinding} from './proposal-outbox.ts';
import {angleCandidateDigest,decodeAngleCandidate,prepareAngleCandidate,type AngleCandidate} from './angle-candidate.ts';

declare const process: {getBuiltinModule(name:'node:crypto'): {randomUUID():string}};
const {randomUUID} = process.getBuiltinModule('node:crypto');
const encoder = new TextEncoder();
const digest = (value:unknown) => collectorBodyHashV1(encoder.encode(pipelineCanonical(value)));
type DraftContext = Omit<DraftBinding,'inputDigest'|'bodyDigest'>;
type Operation = 'RESERVE'|'OBSERVE'|'FINISH'|'HOLD'|'QUEUE_ANGLE';
type ProposalCommand = ReturnType<typeof prepareSyntheticProposalCommand> | ReturnType<typeof prepareAngleCandidate>;
type RequestIdentity = {effectKey:string;workDigest:string};
type IntentState = 'INDETERMINATE'|'HELD'|'NO_PROPOSAL'|'CONFLICT'|'NOT_FOUND'|'UNKNOWN';
export type AnalysisIntentReceipt = RequestIdentity & (
  {state:IntentState} | {state:'PROPOSAL_STORED';proposalId:string;proposalDigest:string} |
  {state:'AWAITING_INPUT';reason:string} |
  {state:'ANGLE_PENDING';angleId:string;angleDigest:string;candidate:AngleCandidate}
);
type Reservation = AnalysisIntentReceipt | RequestIdentity & {state:'START_ONCE'};
type CommittedIntentCall = (args:Readonly<Record<string,unknown>>) => Promise<unknown>;
type Runner = Pick<ReturnType<typeof createSyntheticAnalysisRunner>,'runWithDispatchGate'>;

function work(raw:AnalysisRunRequest, draft:DraftContext) {
  const request = collectorRecordV1(collectorDataV1(raw));
  collectorExactV1(request,['source','routingKey']);
  if (request.routingKey!==null && !pipelineId(request.routingKey)) throw new Error('AI_ANALYSIS_INTENT_INVALID');
  const source = collectorRecordV1(request.source);
  collectorExactV1(source,['source','versions','sectorIds']);
  const sourceRequest = validateCollectorBridgeRequestV1(source.source);
  const versions = collectorRecordV1(source.versions);
  collectorExactV1(versions,['analysisPolicyVersion','catalogVersion','promptVersion','generatorVersion']);
  collectorIdV1(versions.analysisPolicyVersion);
  collectorIdV1(versions.catalogVersion);
  if (!pipelineId(versions.promptVersion) || !pipelineId(versions.generatorVersion)) throw new Error('AI_ANALYSIS_INTENT_INVALID');
  const bodyDigest = sourceRequest.expectedBodyHash;
  const sectors = source.sectorIds;
  if (!Array.isArray(sectors) || sectors.length<1 || sectors.length>100 ||
      !sectors.every(pipelineId) || new Set(sectors).size!==sectors.length) {
    throw new Error('AI_ANALYSIS_INTENT_INVALID');
  }
  source.sectorIds = [...sectors].sort();
  const currentDraft = collectorRecordV1(collectorDataV1(draft));
  collectorExactV1(currentDraft,['expectedDraftRevision','policyDigest','catalogDigest']);
  const inputDigest = digest(['AI_ANALYSIS_INPUT_V1',request]);
  const binding = {
    inputDigest,bodyDigest,expectedDraftRevision:collectorDecimalV1(currentDraft.expectedDraftRevision,0n),
    policyDigest:collectorDigestV1(currentDraft.policyDigest),catalogDigest:collectorDigestV1(currentDraft.catalogDigest),
  };
  // A worker cannot turn an uncertain delivery into a fresh dispatch by changing
  // its prompt, routing key, body, or draft inputs. Those remain conflict fields.
  const deliveryDigest = digest(['AI_ANALYSIS_DELIVERY_V1',sourceRequest.stableStoreId,sourceRequest.deliveryId]);
  return {
    identity:{effectKey:'analysis:'+deliveryDigest,workDigest:digest(['AI_ANALYSIS_WORK_V1',binding])},
    request:request as unknown as AnalysisRunRequest,
    binding,
  };
}

/** Preflight can run again. A fresh committed reservation authorizes the first model call. */
export function createDurableSyntheticAnalysis(runner:Runner, callCommitted:CommittedIntentCall) {
  async function call(operation:Operation, identity:RequestIdentity, nonce:string|null=null,
    command?:ProposalCommand):Promise<Reservation> {
    const {effectKey,workDigest}=identity;
    try {
      const raw = await callCommitted({
        p_operation:operation,p_effect:effectKey,p_work_digest:workDigest,p_nonce:nonce,
        p_proposal_digest:command?.requestDigest??null,p_proposal:command?.proposal??null,
      });
      const reply = collectorRecordV1(collectorDataV1(raw));
      if (reply.effectKey!==effectKey || reply.workDigest!==workDigest) throw new Error('AI_ANALYSIS_INTENT_MISMATCH');
      if (reply.state==='ANGLE_PENDING' && ['RESERVE','OBSERVE','QUEUE_ANGLE'].includes(operation)) {
        collectorExactV1(reply,['state','effectKey','workDigest','angleId','angleDigest','candidate']);
        const candidate=decodeAngleCandidate(reply.candidate);
        const angleDigest=collectorDigestV1(reply.angleDigest);
        if (angleCandidateDigest(effectKey,candidate)!==angleDigest || (command && angleDigest!==command.requestDigest)) {
          throw new Error('AI_ANALYSIS_INTENT_MISMATCH');
        }
        return {...identity,state:reply.state,angleId:collectorUuidV1(reply.angleId),angleDigest,candidate};
      }
      if (reply.state==='PROPOSAL_STORED' && ['RESERVE','OBSERVE','FINISH'].includes(operation)) {
        collectorExactV1(reply,['state','effectKey','workDigest','proposalId','proposalDigest']);
        const proposalDigest = collectorDigestV1(reply.proposalDigest);
        if (command && proposalDigest!==command.requestDigest) throw new Error('AI_ANALYSIS_INTENT_MISMATCH');
        return {...identity,state:reply.state,proposalId:collectorUuidV1(reply.proposalId),proposalDigest};
      }
      collectorExactV1(reply,['state','effectKey','workDigest']);
      const state = reply.state;
      if (operation==='QUEUE_ANGLE' && state!=='NOT_FOUND' && state!=='CONFLICT') {
        throw new Error('AI_ANALYSIS_INTENT_MISMATCH');
      }
      if (operation==='RESERVE' && state==='START_ONCE') return {...identity,state};
      if (state==='NOT_FOUND' || state==='CONFLICT' || state==='NO_PROPOSAL' ||
          state==='HELD' || state==='INDETERMINATE') return {...identity,state};
      throw new Error('AI_ANALYSIS_INTENT_INVALID');
    } catch {
      return {...identity,state:'UNKNOWN'};
    }
  }
  function terminal(receipt:Reservation):AnalysisIntentReceipt {
    return receipt.state==='START_ONCE' ? {effectKey:receipt.effectKey,workDigest:receipt.workDigest,state:'UNKNOWN'} : receipt;
  }
  return Object.freeze({
    async run(raw:AnalysisRunRequest,draft:DraftContext):Promise<AnalysisIntentReceipt> {
      const {identity,request,binding}=work(raw,draft);
      const existing=terminal(await call('OBSERVE',identity));
      if (existing.state!=='NOT_FOUND') return existing;
      const nonce=randomUUID();
      let reservation:Promise<Reservation>|undefined;
      try {
        const result=await runner.runWithDispatchGate(identity.effectKey,request,async()=>{
          reservation ??= call('RESERVE',identity,nonce);
          return (await reservation).state==='START_ONCE';
        });
        if (!reservation) {
          // A peer may have reserved while this runner was checking the original.
          const latest=terminal(await call('OBSERVE',identity));
          return latest.state==='NOT_FOUND'?{...identity,state:'AWAITING_INPUT',reason:result.reason}:latest;
        }
        const reserved=await reservation;
        if (reserved.state!=='START_ONCE') return reserved;
        if (result.effectKey!==identity.effectKey || result.reason==='MODEL_RESPONSE_UNKNOWN' ||
            result.reason==='RUNNING') return {...identity,state:'INDETERMINATE'};
        if (result.disposition==='PLAN' && (result.routing?.action==='UPDATE' || result.routing?.action==='CORRECTION')) {
          const command = prepareSyntheticProposalCommand(result,binding);
          return terminal(await call('FINISH',identity,nonce,command));
        }
        if (result.disposition==='PLAN' && result.routing?.action==='NEW_ANGLE') {
          return terminal(await call('QUEUE_ANGLE',identity,nonce,prepareAngleCandidate(result,binding)));
        }
        if (result.disposition==='PASS' || (result.disposition==='PLAN' && result.routing?.action==='NO_CHANGE')) {
          return terminal(await call('FINISH',identity,nonce));
        }
        return terminal(await call('HOLD',identity,nonce));
      } catch {
        return {...identity,state:reservation?'INDETERMINATE':'UNKNOWN'};
      }
    },
    async observe(raw:AnalysisRunRequest,draft:DraftContext):Promise<AnalysisIntentReceipt> {
      return terminal(await call('OBSERVE',work(raw,draft).identity));
    },
  });
}
