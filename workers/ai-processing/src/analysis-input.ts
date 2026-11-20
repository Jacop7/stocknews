/** Node-only ANALYSIS_INPUT_P3. Offline preparation only; no model, network or publication. */
import {PipelineError} from '../../../packages/contracts/src/pipeline.ts';
import {OfflineCollectionReadBoundary,isOwnedCollectionReadBoundary} from '../../collectors/src/collection-read-boundary.ts';
import {collectionRecord,collectionExact,collectionId,collectionDigest,collectionNumber,collectionIds,collectionStamp,collectionTime,collectionHash,collectionClone,validateCollectionAnalysisRead,type CollectionObservationMetadata} from '../../collectors/src/collection-read-contracts.ts';

export const ANALYSIS_INPUT_SCHEMA='ANALYSIS_INPUT_P3' as const;
const flags=Object.freeze({schema:ANALYSIS_INPUT_SCHEMA,mode:'OFFLINE_REPLAY' as const,fixtureAssertionOnly:true as const,executionEnabled:false as const});
// Capture the original reader. An instance property or later prototype override is not an acquisition port.
const readOwned=OfflineCollectionReadBoundary.prototype.readForAnalysis;
export interface AnalysisInput {
  observationId:string;bodyHash:string;expectedGrantGeneration:number;sourcePolicyVersion:string;
  analysisPolicyVersion:string;catalogVersion:string;promptVersion:string;generatorVersion:string;sectorIds:string[];checkedAt:string;
}
export interface AnalysisInputRequest {
  schema:typeof ANALYSIS_INPUT_SCHEMA;mode:'OFFLINE_REPLAY';fixtureAssertionOnly:true;executionEnabled:false;
  perspective:'KR_LISTED_EQUITIES';checkedAt:string;source:CollectionObservationMetadata;
  versions:{sourcePolicyVersion:string;analysisPolicyVersion:string;catalogVersion:string;promptVersion:string;generatorVersion:string};
  sectorIds:string[];content:{kind:'UNTRUSTED_SOURCE_TEXT';text:string};
}
type HoldReason='SOURCE_UNAVAILABLE'|'SOURCE_RIGHTS_OR_RETENTION'|'SOURCE_GENERATION_CHANGED'|'SOURCE_POLICY_CHANGED'|'SOURCE_TIME_REQUIRED'|'SOURCE_PROVENANCE_REQUIRED'|'SOURCE_ARTICLE_REQUIRED';
export type PreparedAnalysisInput=typeof flags&(
  {disposition:'READY_FOR_ANALYSIS_INPUT';request:AnalysisInputRequest;requestDigest:string}
  |{disposition:'HOLD';observationId:string;checkedAt:string;reason:HoldReason;requestDigest:null}
);
function input(raw:unknown):AnalysisInput {
  const x=collectionRecord(raw);collectionExact(x,['observationId','bodyHash','expectedGrantGeneration','sourcePolicyVersion','analysisPolicyVersion','catalogVersion','promptVersion','generatorVersion','sectorIds','checkedAt']);
  for(const key of ['observationId','sourcePolicyVersion','analysisPolicyVersion','catalogVersion','promptVersion','generatorVersion'])collectionId(x[key]);
  collectionDigest(x.bodyHash);collectionNumber(x.expectedGrantGeneration,1);const sectorIds=collectionIds(x.sectorIds,100);if(!sectorIds.length)throw new PipelineError('INVALID_INPUT');
  return {...x,sectorIds:[...sectorIds].sort(),checkedAt:collectionStamp(x.checkedAt)} as unknown as AnalysisInput;
}
/** Sole body source is an owned offline read boundary, with current authority rechecked by that reader. */
export function prepareAnalysisInput(boundary:unknown,raw:unknown):PreparedAnalysisInput {
  if(!isOwnedCollectionReadBoundary(boundary))throw new PipelineError('INVALID_INPUT');
  const x=input(raw),hold=(reason:HoldReason):PreparedAnalysisInput=>({...flags,disposition:'HOLD',observationId:x.observationId,checkedAt:x.checkedAt,reason,requestDigest:null});
  let artifact;
  try{artifact=validateCollectionAnalysisRead(readOwned.call(boundary,x.observationId,x.bodyHash,x.checkedAt));}
  catch(e){
    if(e instanceof PipelineError){
      if(e.code==='RIGHTS_HOLD')return hold('SOURCE_RIGHTS_OR_RETENTION');
      if(e.code==='POLICY_STALE')return hold('SOURCE_GENERATION_CHANGED');
      if(e.code==='EFFECT_CONFLICT')return hold('SOURCE_UNAVAILABLE');
    }
    throw e;
  }
  const m=artifact.metadata;
  // Discovery/listing and Telegram link envelopes are not original articles, even
  // if their fixture grant separately permits ANALYSIS. Never forward them whole.
  if(m.purpose!=='ORIGINAL_ACCESS'||m.parserVersion.startsWith('pilot-telegram-')||m.parserVersion.startsWith('pilot-json-listing-'))return hold('SOURCE_ARTICLE_REQUIRED');
  if(m.grantGeneration!==x.expectedGrantGeneration)return hold('SOURCE_GENERATION_CHANGED');
  if(m.sourcePolicyVersion!==x.sourcePolicyVersion)return hold('SOURCE_POLICY_CHANGED');
  if(m.timeQuality!=='KNOWN'||m.sourcePublishedAt===null)return hold('SOURCE_TIME_REQUIRED');
  if(m.originId===null||m.independenceGroupId===null)return hold('SOURCE_PROVENANCE_REQUIRED');
  if(collectionTime(m.sourcePublishedAt)>collectionTime(x.checkedAt)||m.sourceUpdatedAt!==null&&collectionTime(m.sourceUpdatedAt)>collectionTime(x.checkedAt))return hold('SOURCE_TIME_REQUIRED');
  const request:AnalysisInputRequest={...flags,perspective:'KR_LISTED_EQUITIES',checkedAt:x.checkedAt,source:m,versions:{sourcePolicyVersion:x.sourcePolicyVersion,analysisPolicyVersion:x.analysisPolicyVersion,catalogVersion:x.catalogVersion,promptVersion:x.promptVersion,generatorVersion:x.generatorVersion},sectorIds:x.sectorIds,content:{kind:'UNTRUSTED_SOURCE_TEXT',text:artifact.text}};
  return collectionClone({...flags,disposition:'READY_FOR_ANALYSIS_INPUT',request,requestDigest:collectionHash(request)});
}
