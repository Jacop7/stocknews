/** Apply an exact pending angle using the isolated editor transport. */
import {collectorDataV1,collectorDigestV1,collectorExactV1,collectorRecordV1,collectorUuidV1}
  from '../../collectors/src/collector-db-contracts-v1.ts';
import {angleCandidateDigest,decodeAngleCandidate} from './angle-candidate.ts';
import type {AnalysisIntentReceipt} from './analysis-intent.ts';

type PendingAngle = Extract<AnalysisIntentReceipt,{state:'ANGLE_PENDING'}>;
type Identity = Pick<PendingAngle,'effectKey'|'workDigest'|'angleDigest'>;
export type AngleDraftReceipt = Identity & (
  {state:'ANGLE_DRAFT_CREATED'|'ANGLE_ALREADY_DRAFTED';angleId:string;issueId:string;draftRevision:'1'} |
  {state:'CONFLICT'|'NOT_FOUND'|'STALE_CONTEXT'|'REVISION_CONFLICT'|'UNKNOWN'}
);
type EditorCall = (args:Readonly<{p_effect:string;p_work_digest:string;p_candidate_digest:string;p_angle_id:string}>)=>Promise<unknown>;

function invalid():never {throw new Error('AI_ANGLE_DRAFT_INVALID');}

export function createSyntheticAngleEditor(callCommitted:EditorCall) {
  return Object.freeze({
    async apply(raw:PendingAngle):Promise<AngleDraftReceipt> {
      const item=collectorRecordV1(collectorDataV1(raw));
      collectorExactV1(item,['state','effectKey','workDigest','angleId','angleDigest','candidate']);
      const effectKey=item.effectKey;
      if (item.state!=='ANGLE_PENDING' || typeof effectKey!=='string' || !/^analysis:[a-f0-9]{64}$/.test(effectKey)) invalid();
      const angleId=collectorUuidV1(item.angleId);
      const workDigest=collectorDigestV1(item.workDigest);
      const angleDigest=collectorDigestV1(item.angleDigest);
      const candidate=decodeAngleCandidate(item.candidate);
      if (angleCandidateDigest(effectKey,candidate)!==angleDigest) invalid();
      const identity={effectKey,workDigest,angleDigest};
      try {
        const r=collectorRecordV1(collectorDataV1(await callCommitted({
          p_effect:effectKey,p_work_digest:workDigest,p_candidate_digest:angleDigest,p_angle_id:angleId,
        })));
        if (r.effectKey!==effectKey || r.workDigest!==workDigest || r.angleDigest!==angleDigest) invalid();
        if (r.state==='ANGLE_DRAFT_CREATED' || r.state==='ANGLE_ALREADY_DRAFTED') {
          collectorExactV1(r,['effectKey','workDigest','angleDigest','state','angleId','issueId','draftRevision']);
          if (r.angleId!==angleId || r.draftRevision!=='1') invalid();
          const issueId=collectorUuidV1(r.issueId);
          if (candidate.issueVersions.some(issue=>issue.issueId===issueId)) invalid();
          return {...identity,state:r.state,angleId,issueId,draftRevision:'1'};
        }
        collectorExactV1(r,['effectKey','workDigest','angleDigest','state']);
        if (r.state==='CONFLICT' || r.state==='NOT_FOUND' || r.state==='STALE_CONTEXT' ||
            r.state==='REVISION_CONFLICT') return {...identity,state:r.state};
        return invalid();
      } catch {
        return {...identity,state:'UNKNOWN'};
      }
    },
  });
}
