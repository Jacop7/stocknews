/** Pure SYNTHETIC K1 meaning checks. No acquisition, model, IO or actual evidence verification. */
import {PipelineError,pipelineData,pipelineCanonical,pipelineId,pipelineInstant,validateSourceRevision,validatePipelineVersions,assertPipelineVersions,validatePipelineDecision,type PipelineVersions,type PipelineSourceRevision,type PipelineDecision} from './pipeline.ts';
import type {DetailSection,ImpactProfile} from './index.ts';
const bad=():never=>{throw new PipelineError('INVALID_INPUT');};
export const k1Record=(v:unknown):Record<string,unknown>=>{const x=pipelineData(v);if(!x||typeof x!=='object'||Array.isArray(x))bad();return x as Record<string,unknown>;};
export function k1Exact(v:Record<string,unknown>,fields:string[]):void {if(Object.keys(v).length!==fields.length||fields.some(f=>!Object.hasOwn(v,f)))bad();}
const list=(v:unknown):unknown[]=>{if(!Array.isArray(v)||v.length>300)bad();return v as unknown[];};
const ids=(v:unknown,nonempty=false):string[]=>{const a=list(v);if((nonempty&&!a.length)||!a.every(pipelineId)||new Set(a).size!==a.length)bad();return a as string[];};
const text=(v:unknown,max=4000):boolean=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const moment=(v:unknown):number=>{const n=pipelineInstant(v);if(!Number.isFinite(n))bad();return n;};
const stamp=(v:string)=>new Date(moment(v)).toISOString();
export interface SourceSelection {sourceDocumentId:string;status:'SELECTED'|'PENDING_TIME'|'CONFLICT_SAME_TIME'|'NOT_KNOWN';revision:PipelineSourceRevision|null;}
/** Arrival sequence is not a chronology. All deliveries remain intact; only a representative is chosen. */
export function selectPipelineSources(raw:unknown,expected:unknown,asOf:unknown):SourceSelection[]{
  const ver=validatePipelineVersions(expected),cutoff=moment(asOf),revisions=list(pipelineData(raw)).map(validateSourceRevision);
  const docIdentity=new Map<string,string>(),nativeIdentity=new Map<string,string>(),byId=new Map<string,string>(),groups=new Map<string,PipelineSourceRevision[]>();
  for(const r of revisions){
    assertPipelineVersions(r,ver);const key=pipelineCanonical([r.sourceId,r.nativeId]),canonical=pipelineCanonical(r);
    if(docIdentity.has(r.sourceDocumentId)&&docIdentity.get(r.sourceDocumentId)!==key||nativeIdentity.has(key)&&nativeIdentity.get(key)!==r.sourceDocumentId||byId.has(r.revisionId)&&byId.get(r.revisionId)!==canonical)bad();
    docIdentity.set(r.sourceDocumentId,key);nativeIdentity.set(key,r.sourceDocumentId);byId.set(r.revisionId,canonical);
    const g=groups.get(r.sourceDocumentId)??[];if(!g.some(x=>x.revisionId===r.revisionId))g.push(r);groups.set(r.sourceDocumentId,g);
  }
  const semantic=(r:PipelineSourceRevision)=>pipelineCanonical(Object.fromEntries(Object.entries(r).filter(([k])=>!['revisionId','collectedAt'].includes(k)).map(([k,v])=>[k,['publishedAt','updatedAt'].includes(k)&&v!==null?stamp(v as string):v])));
  return [...groups].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([sourceDocumentId,all])=>{
    const known=all.filter(r=>moment(r.collectedAt)<=cutoff),reply=(status:SourceSelection['status'],revision:PipelineSourceRevision|null=null)=>({sourceDocumentId,status,revision});
    if(!known.length)return reply('NOT_KNOWN');
    if(known.some(r=>r.updatedAt===null&&r.publishedAt===null))return reply('PENDING_TIME');
    const latest=Math.max(...known.map(r=>moment(r.updatedAt??r.publishedAt))),ties=known.filter(r=>moment(r.updatedAt??r.publishedAt)===latest);
    if(new Set(ties.map(semantic)).size!==1)return reply('CONFLICT_SAME_TIME');
    ties.sort((a,b)=>a.revisionId<b.revisionId?-1:a.revisionId>b.revisionId?1:0);return reply('SELECTED',ties[0]);
  });
}
export interface K1Impact {sectorId:string;pathId:string;direction:'BENEFIT'|'DAMAGE'|'RELATED';conditionalDirection:'NONE'|'POSITIVE'|'NEGATIVE';evidenceIds:string[];}
export interface K1Scenario {direction:'POSITIVE'|'NEGATIVE';text:string;pathIds:string[];}
export interface K1Risk {riskId:string;text:string;pathIds:string[];evidenceIds:string[];}
export type K1Schedule={scheduleId:string;evidenceIds:string[];knownAt:string;verified:boolean;cancelled:boolean;timezone:string;label:string;kind:'EXACT';eventAt:string}|{scheduleId:string;evidenceIds:string[];knownAt:string;verified:boolean;cancelled:boolean;timezone:string;label:string;kind:'PERIOD';startAt:string;endAt:string};
export interface K1VisibilityInput {sampleKind:'SYNTHETIC';evidenceVersion:string;asOf:string;keyIssueEvidenceIds:string[];analysisEvidenceIds:string[];impacts:K1Impact[];scenarios:K1Scenario[];risks:K1Risk[];schedule:K1Schedule[];}
export interface K1Visibility {sampleKind:'SYNTHETIC';evidenceVersion:string;asOf:string;impactProfile:ImpactProfile;scenarioMode:'HIDDEN'|'POSITIVE'|'POSITIVE_NEGATIVE';visibleSections:DetailSection[];impacts:K1Impact[];scenarios:K1Scenario[];risks:K1Risk[];schedule:K1Schedule[];}
/** verified is a fixture assertion bound to decision claims, not a fact-verification service. */
export function projectPipelineVisibility(raw:unknown,decisionRaw:unknown):K1Visibility {
  const d=validatePipelineDecision(decisionRaw),v=k1Record(raw);k1Exact(v,['sampleKind','evidenceVersion','asOf','keyIssueEvidenceIds','analysisEvidenceIds','impacts','scenarios','risks','schedule']);
  if(v.sampleKind!=='SYNTHETIC')throw new PipelineError('LIVE_NOT_ENABLED');
  if(v.evidenceVersion!==d.evidenceVersion||moment(v.asOf)<moment(d.knownAt))bad();
  const asOf=v.asOf as string,at=moment(asOf),claims=new Map(d.evidence.map(e=>[e.claimId,e]));
  const refs=(rawIds:unknown):string[]=>{const a=ids(rawIds,true);if(!a.every(k=>claims.get(k)?.verified))throw new PipelineError('RIGHTS_HOLD');return a;};
  refs(v.keyIssueEvidenceIds);refs(v.analysisEvidenceIds);
  const positive=new Set<string>(),negative=new Set<string>(),paths=new Set<string>(),seen=new Set<string>();
  const impacts=list(v.impacts).map(rawImpact=>{
    const x=k1Record(rawImpact);k1Exact(x,['sectorId','pathId','direction','conditionalDirection','evidenceIds']);
    if(!pipelineId(x.sectorId)||!pipelineId(x.pathId)||paths.has(x.pathId)||!['BENEFIT','DAMAGE','RELATED'].includes(x.direction as string)||!['NONE','POSITIVE','NEGATIVE'].includes(x.conditionalDirection as string)||x.direction!=='RELATED'&&x.conditionalDirection!=='NONE')bad();
    const pathId=x.pathId as string;paths.add(pathId);refs(x.evidenceIds);if(x.direction==='BENEFIT'||x.direction==='RELATED'&&x.conditionalDirection==='POSITIVE')positive.add(pathId);if(x.direction==='DAMAGE'||x.direction==='RELATED'&&x.conditionalDirection==='NEGATIVE')negative.add(pathId);return x as unknown as K1Impact;
  });
  const scenarios=list(v.scenarios).map(rawScenario=>{
    const x=k1Record(rawScenario);k1Exact(x,['direction','text','pathIds']);if(!['POSITIVE','NEGATIVE'].includes(x.direction as string)||!text(x.text))bad();
    const p=ids(x.pathIds,true),allowed=x.direction==='POSITIVE'?positive:negative;
    if(!positive.size||!p.every(k=>allowed.has(k)))throw new PipelineError('RIGHTS_HOLD');return x as unknown as K1Scenario;
  });
  if(positive.size&&!scenarios.some(x=>x.direction==='POSITIVE')||positive.size&&negative.size&&!scenarios.some(x=>x.direction==='NEGATIVE')||!negative.size&&scenarios.some(x=>x.direction==='NEGATIVE'))throw new PipelineError('RIGHTS_HOLD');
  const risks=list(v.risks).map(rawRisk=>{const x=k1Record(rawRisk);k1Exact(x,['riskId','text','pathIds','evidenceIds']);if(!pipelineId(x.riskId)||seen.has('risk:'+x.riskId)||!text(x.text)||!ids(x.pathIds).every(k=>paths.has(k)))bad();seen.add('risk:'+x.riskId);refs(x.evidenceIds);return x as unknown as K1Risk;});
  if(!positive.size&&negative.size&&!risks.length)throw new PipelineError('RIGHTS_HOLD');
  const schedule=list(v.schedule).map(rawSchedule=>{
    const x=k1Record(rawSchedule);if(!['EXACT','PERIOD'].includes(x.kind as string))bad();
    k1Exact(x,['scheduleId','evidenceIds','knownAt','verified','cancelled','timezone','label','kind',...(x.kind==='EXACT'?['eventAt']:['startAt','endAt'])]);
    if(!pipelineId(x.scheduleId)||seen.has('schedule:'+x.scheduleId)||typeof x.verified!=='boolean'||typeof x.cancelled!=='boolean'||!text(x.timezone,80)||!text(x.label,500))bad();
    try{new Intl.DateTimeFormat('en',{timeZone:x.timezone as string});}catch{bad();}
    seen.add('schedule:'+x.scheduleId);refs(x.evidenceIds);const known=moment(x.knownAt),end=x.kind==='EXACT'?moment(x.eventAt):moment(x.endAt);
    if(x.kind==='PERIOD'&&moment(x.startAt)>end)bad();
    return {value:x as unknown as K1Schedule,eligible:x.verified&&!x.cancelled&&known<=at&&end>at};
  }).filter(x=>x.eligible).map(x=>x.value);
  const hasBenefit=impacts.some(x=>x.direction==='BENEFIT'),hasDamage=impacts.some(x=>x.direction==='DAMAGE');
  const impactProfile:ImpactProfile=!hasBenefit&&!hasDamage?'RELATED_CONDITIONAL':positive.size?(negative.size?'POSITIVE_NEGATIVE':'POSITIVE_ONLY'):'DAMAGE_ONLY';
  const scenarioMode:K1Visibility['scenarioMode']=!positive.size?'HIDDEN':negative.size?'POSITIVE_NEGATIVE':'POSITIVE';
  const visibleSections:DetailSection[]=['KEY_ISSUES','ISSUE_ANALYSIS'];if(scenarios.length)visibleSections.push('SCENARIOS');
  if(hasBenefit)visibleSections.push('BENEFIT_SECTORS');if(hasDamage)visibleSections.push('DAMAGE_SECTORS');if(impacts.some(x=>x.direction==='RELATED'))visibleSections.push('RELATED_SECTORS');if(risks.length)visibleSections.push('RISKS');if(schedule.length)visibleSections.push('SCHEDULE');visibleSections.push('SOURCES');
  return {sampleKind:'SYNTHETIC',evidenceVersion:d.evidenceVersion,asOf,impactProfile,scenarioMode,visibleSections,impacts,scenarios,risks,schedule};
}
