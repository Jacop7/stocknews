/** Evidence references for an accepted new angle. No draft creation or publication authority. */
import {pipelineId} from '../../../packages/contracts/src/pipeline.ts';
import {
  collectorDataV1,collectorDigestV1,collectorExactV1,collectorRecordV1,
} from '../../collectors/src/collector-db-contracts-v1.ts';
import {collectorBodyHashV1} from '../../collectors/src/collector-db-canonical-v1.ts';
import type {AnalysisRunResult} from './analysis-run.ts';
import type {DraftBinding} from './proposal-outbox.ts';

function invalid():never {throw new Error('AI_ANGLE_CANDIDATE_INVALID');}
function id(raw:unknown):string {
  if (!pipelineId(raw)) invalid();
  return raw;
}
function ids(raw:unknown,min:number,max:number):string[] {
  if (!Array.isArray(raw) || raw.length<min || raw.length>max) invalid();
  const result=raw.map(id);
  if (new Set(result).size!==result.length) invalid();
  return result;
}

const fields = ['storyId','storyVersion','angleCode','issueVersions','claimIds','pathIds',
  'inputDigest','bodyDigest','policyDigest','catalogDigest','routingDigest','validationDigest'];

export function decodeAngleCandidate(raw:unknown) {
  const value=collectorRecordV1(raw);
  collectorExactV1(value,fields);
  if (!Array.isArray(value.issueVersions) || !value.issueVersions.length || value.issueVersions.length>100) invalid();
  const issueVersions=value.issueVersions.map(entry=>{
    const issue=collectorRecordV1(entry);
    collectorExactV1(issue,['issueId','issueVersion']);
    return {issueId:id(issue.issueId),issueVersion:id(issue.issueVersion)};
  });
  if (new Set(issueVersions.map(issue=>issue.issueId)).size!==issueVersions.length) invalid();
  return {
    storyId:id(value.storyId),storyVersion:id(value.storyVersion),angleCode:id(value.angleCode),
    issueVersions,claimIds:ids(value.claimIds,1,300),pathIds:ids(value.pathIds,0,300),
    inputDigest:collectorDigestV1(value.inputDigest),bodyDigest:collectorDigestV1(value.bodyDigest),
    policyDigest:collectorDigestV1(value.policyDigest),catalogDigest:collectorDigestV1(value.catalogDigest),
    routingDigest:collectorDigestV1(value.routingDigest),validationDigest:collectorDigestV1(value.validationDigest),
  };
}

export type AngleCandidate = ReturnType<typeof decodeAngleCandidate>;

export function angleCandidateDigest(effectKey:string,value:AngleCandidate):string {
  // The validated IDs contain neither comma, semicolon, nor newline.
  const issues=value.issueVersions.map(issue=>issue.issueId+','+issue.issueVersion).join(';');
  const preimage=['AI_ANGLE_CANDIDATE_V1',effectKey,value.storyId,value.storyVersion,value.angleCode,
    issues,value.claimIds.join(','),value.pathIds.join(','),value.inputDigest,value.bodyDigest,
    value.policyDigest,value.catalogDigest,value.routingDigest,value.validationDigest].join('\n');
  return collectorBodyHashV1(new TextEncoder().encode(preimage));
}

export function prepareAngleCandidate(result:AnalysisRunResult,binding:DraftBinding) {
  const analysis=collectorRecordV1(collectorDataV1(result));
  if (analysis.schema!=='SYNTHETIC_ANALYSIS_RUN_V1' || analysis.sampleKind!=='SYNTHETIC' ||
      analysis.disposition!=='PLAN' || analysis.fixtureAssertionOnly!==true ||
      analysis.providerExecutionEnabled!==false || analysis.persistence!=='MEMORY_FIXTURE_ONLY' ||
      analysis.publicationAuthorized!==false || analysis.changesPublicTimestamps!==false) invalid();
  const routing=collectorRecordV1(analysis.routing);
  if (routing.schema!=='SYNTHETIC_EVENT_ROUTING_A2' || routing.sampleKind!=='SYNTHETIC' ||
      routing.disposition!=='PLAN' || routing.action!=='NEW_ANGLE' || routing.targetIssueId!==null ||
      routing.fixtureAssertionOnly!==true || routing.executionEnabled!==false ||
      routing.publicationAuthorized!==false || routing.changesPublicTimestamps!==false) invalid();
  const proposal=decodeAngleCandidate({
    storyId:routing.storyId,storyVersion:routing.expectedStoryVersion,angleCode:routing.angleCode,
    issueVersions:routing.expectedIssueVersions,claimIds:routing.claimIds,pathIds:routing.pathIds,
    inputDigest:binding.inputDigest,bodyDigest:binding.bodyDigest,policyDigest:binding.policyDigest,
    catalogDigest:binding.catalogDigest,routingDigest:routing.requestDigest,validationDigest:analysis.validationRequestDigest,
  });
  return {proposal,requestDigest:angleCandidateDigest(id(analysis.effectKey),proposal)};
}
