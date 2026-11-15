/** Internal, unconnected SYNTHETIC draft. Not a publication or live ranking API. */
export const PRIORITY_POLICY = 'SYNTHETIC_PRIORITY_7B1_V1';
export const ATTENTION_GROUPS = ['AI_SEMICONDUCTOR','ROBOT','EV','BATTERY','ENERGY','SPACE','DEFENSE','SHIPBUILDING','TRANSPORT','BIO','MEDICAL','FINANCE','CONSTRUCTION','INDUSTRIAL','CONSUMER','TELECOM_ENT_GAME'] as const;
type Kind = 'OFFICIAL_ANNOUNCEMENT'|'FILING'|'ENACTED_POLICY'|'INDUSTRY_DATA'|'OTHER';
type Dimension = 'transmission'|'breadth'|'magnitude'|'persistence';
type Tier = 'HIGH'|'MEDIUM'|'STANDARD';
type SignalKey = 'T'|'M'|'P';
interface Timed {sampleKind:'SYNTHETIC';version:string;knownAt:string;validUntil:string;}
export interface PriorityClaim extends Timed {claimId:string;originId:string;kind:Kind;verifiedAt:string;status:'VERIFIED'|'UNVERIFIED'|'RETRACTED';}
interface Grade {grade:number;claimIds:readonly string[];}
export interface PriorityIssue {
 issueId:string;storyId:string;version:string;assessmentVersion:string;sampleKind:'SYNTHETIC';
 inputKnownAt:string;publishedAt:string;materialChangeAt:string;lastVerifiedAt:string;evidenceValidUntil:string;scheduledEndAt?:string;
 publicationState:'PUBLISHED'|'DRAFT'|'CORRECTION_PENDING'|'HIDDEN'|'RETRACTED';
 contentClass:'SECTOR_EVENT'|'SYSTEMIC_MACRO'|'AD_PROMOTION'|'IRRELEVANT'|'UNVERIFIED';
 impactState:'ACTIVE'|'CHECK_PENDING'|'RESOLVED'|'INVALIDATED';
 direction:'POSITIVE'|'NEGATIVE'|'MIXED'|'UNCERTAIN';scope:'SECTOR'|'MACRO_ALL';
 assessment:Record<Dimension,Grade>;
 macroGate?:{decision:'PASS'|'HOLD';gateVersion:string;claimIds:readonly string[];independentOriginIds:readonly string[];officialCoreClaimId?:string;};
}
export interface PriorityValue extends Timed {issueId:string;value:number;}
interface SignalSet extends Timed {values:readonly PriorityValue[];}
export interface PriorityInput {
 mode:'LOCAL_SYNTHETIC';sampleKind:'SYNTHETIC';cutoff:string;policyVersion:typeof PRIORITY_POLICY;catalogVersion:string;evaluationSetVersion:string;
 claims:readonly PriorityClaim[];issues:readonly PriorityIssue[];
 signals?:{
  T?:SignalSet & {mode:'DERIVED_SYNTHETIC';completedGroups:readonly string[];};
  M?:SignalSet & {unit:'PERCENT';comparisonPolicyVersion:string;};
  P?:SignalSet & {windowEndAt:string;watermarkComplete:boolean;};
 };
}
export interface PriorityRow {
 issueId:string;storyId:string;issueVersion:string;assessmentVersion:string;claimIds:string[];
 rawImpact:number;effectiveImpact:number;tier:Tier;score:number;materialChangeAt:string;
 components:{I:number;T:number|null;M:number|null;P:number|null;F:number;};
 weights:Record<'I'|'T'|'M'|'P'|'F',number>;
}
export interface PriorityDraft {
 status:'DRAFT_SYNTHETIC'|'INVALID_INPUT'|'LIVE_NOT_ENABLED';sampleKind:'SYNTHETIC';
 policyVersion:string;cutoff:string;catalogVersion:string;evaluationSetVersion:string;
 rows:PriorityRow[];excluded:{issueId:string;reason:string;}[];
 signals:Record<SignalKey,{enabled:boolean;reason:string;}>;
 limitations:readonly string[];
}
const dimensions:Dimension[]=['transmission','breadth','magnitude','persistence'];
const strong:Kind[]=['OFFICIAL_ANNOUNCEMENT','FILING','ENACTED_POLICY','INDUSTRY_DATA'];
const official:Kind[]=['OFFICIAL_ANNOUNCEMENT','FILING','ENACTED_POLICY'];
const HOUR=3600000;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=160&&v.trim()===v;
const inSet=(v:unknown,values:readonly string[])=>typeof v==='string'&&values.includes(v);
function time(v:unknown):number {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))return NaN;
 const ms=Date.parse(v);return Number.isFinite(ms)&&new Date(ms).toISOString()===v.replace(/Z$/,v.includes('.')?'Z':'.000Z')?ms:NaN;
}
const instant=(v:unknown)=>Number.isFinite(time(v));
const ids=(v:unknown):v is string[]=>Array.isArray(v)&&Array.from(v).every((item,n)=>Object.hasOwn(v,n)&&id(item))&&new Set(v).size===v.length;
function timed(v:unknown):v is Timed {
 return object(v)&&v.sampleKind==='SYNTHETIC'&&id(v.version)&&instant(v.knownAt)&&instant(v.validUntil)&&time(v.validUntil)>time(v.knownAt);
}
function validate(raw:unknown):raw is PriorityInput {
 if(!object(raw)||raw.mode!=='LOCAL_SYNTHETIC'||raw.sampleKind!=='SYNTHETIC'||raw.policyVersion!==PRIORITY_POLICY||!instant(raw.cutoff)||!id(raw.catalogVersion)||!id(raw.evaluationSetVersion)||!Array.isArray(raw.claims)||!Array.isArray(raw.issues))return false;
 const claimIds=new Set<string>(),issueIds=new Set<string>();
 for(const c of raw.claims){
  if(!timed(c)||!object(c)||!id(c.claimId)||claimIds.has(c.claimId)||!id(c.originId)||!inSet(c.kind,[...strong,'OTHER'])||!inSet(c.status,['VERIFIED','UNVERIFIED','RETRACTED'])||!instant(c.verifiedAt)||time(c.verifiedAt)<time(c.knownAt)||time(c.verifiedAt)>=time(c.validUntil))return false;
  claimIds.add(c.claimId);
 }
 for(const i of raw.issues){
  if(!object(i)||!id(i.issueId)||issueIds.has(i.issueId)||!id(i.storyId)||!id(i.version)||!id(i.assessmentVersion)||i.sampleKind!=='SYNTHETIC'||!object(i.assessment))return false;
  issueIds.add(i.issueId);
  if(!['inputKnownAt','publishedAt','materialChangeAt','lastVerifiedAt','evidenceValidUntil'].every(k=>instant(i[k]))||i.scheduledEndAt!==undefined&&!instant(i.scheduledEndAt))return false;
  if(time(i.materialChangeAt)<time(i.publishedAt)||time(i.lastVerifiedAt)<time(i.publishedAt)||time(i.evidenceValidUntil)<=time(i.lastVerifiedAt)||time(i.evidenceValidUntil)-time(i.lastVerifiedAt)>24*HOUR)return false;
  if(!inSet(i.publicationState,['PUBLISHED','DRAFT','CORRECTION_PENDING','HIDDEN','RETRACTED'])||!inSet(i.contentClass,['SECTOR_EVENT','SYSTEMIC_MACRO','AD_PROMOTION','IRRELEVANT','UNVERIFIED'])||!inSet(i.impactState,['ACTIVE','CHECK_PENDING','RESOLVED','INVALIDATED'])||!inSet(i.direction,['POSITIVE','NEGATIVE','MIXED','UNCERTAIN'])||!inSet(i.scope,['SECTOR','MACRO_ALL']))return false;
  if(i.scope==='MACRO_ALL'&&i.contentClass!=='SYSTEMIC_MACRO')return false;
  for(const d of dimensions){let g=i.assessment[d];if(!object(g)||!Number.isInteger(g.grade)||Number(g.grade)<0||Number(g.grade)>5||!ids(g.claimIds))return false;}
  if(i.macroGate!==undefined){let g=i.macroGate;if(!object(g)||!inSet(g.decision,['PASS','HOLD'])||!id(g.gateVersion)||!ids(g.claimIds)||!ids(g.independentOriginIds)||g.officialCoreClaimId!==undefined&&!id(g.officialCoreClaimId))return false;}
 }
 if(raw.signals!==undefined){
  if(!object(raw.signals)||Object.keys(raw.signals).some(k=>!['T','M','P'].includes(k)))return false;
  for(const k of ['T','M','P']){let s=raw.signals[k];if(s===undefined)continue;
   if(!timed(s)||!object(s)||!Array.isArray(s.values))return false;
   const seen=new Set<string>();
   for(const e of s.values){if(!timed(e)||!object(e)||!id(e.issueId)||!issueIds.has(e.issueId)||seen.has(e.issueId)||typeof e.value!=='number'||!Number.isFinite(e.value))return false;seen.add(e.issueId);
    if(k==='T'&&(e.value<0||e.value>1)||k==='P'&&(!Number.isSafeInteger(e.value)||e.value<0))return false;
   }
   if(k==='T'&&(s.mode!=='DERIVED_SYNTHETIC'||!ids(s.completedGroups)))return false;
   if(k==='M'&&(s.unit!=='PERCENT'||!id(s.comparisonPolicyVersion)))return false;
   if(k==='P'&&(!instant(s.windowEndAt)||typeof s.watermarkComplete!=='boolean'))return false;
  }
 }
 return true;
}
function codepoint(a:string,b:string):number {
 const aa=Array.from(a),bb=Array.from(b);
 for(let n=0;n<Math.min(aa.length,bb.length);n++){const diff=aa[n].codePointAt(0)!-bb[n].codePointAt(0)!;if(diff)return diff;}
 return aa.length-bb.length;
}
const valid=(v:Timed,now:number)=>time(v.knownAt)<=now&&time(v.validUntil)>now;
function admission(i:PriorityIssue,claims:Map<string,PriorityClaim>,now:number):string|null {
 if(time(i.inputKnownAt)>now)return 'FUTURE_KNOWN_INPUT';
 if([i.publishedAt,i.materialChangeAt,i.lastVerifiedAt].some(t=>time(t)>now))return 'FUTURE_EVENT';
 if(i.publicationState!=='PUBLISHED')return 'PUBLICATION_'+i.publicationState;
 if(!['SECTOR_EVENT','SYSTEMIC_MACRO'].includes(i.contentClass))return 'CONTENT_'+i.contentClass;
 if(i.impactState!=='ACTIVE')return 'IMPACT_'+i.impactState;
 if(i.scheduledEndAt!==undefined&&time(i.scheduledEndAt)<=now)return 'SCHEDULED_END';
 if(time(i.evidenceValidUntil)<=now||now-time(i.lastVerifiedAt)>=24*HOUR)return 'EVIDENCE_EXPIRED';
 const current=(c:PriorityClaim|undefined):c is PriorityClaim=>!!c&&c.status==='VERIFIED'&&valid(c,now)&&time(c.verifiedAt)<=now;
 for(const d of dimensions){
  const g=i.assessment[d],cs=g.claimIds.map(ref=>claims.get(ref));
  if(cs.some(c=>!current(c)))return 'EVIDENCE_UNAVAILABLE';
  if(g.grade>0&&cs.length===0)return 'EVIDENCE_GRADE_UNSUPPORTED';
  if((d==='magnitude'||d==='persistence')&&g.grade>=3&&!cs.some(c=>!!c&&strong.includes(c.kind)))return 'EVIDENCE_GRADE_UNSUPPORTED';
 }
 if(i.contentClass==='SYSTEMIC_MACRO'){
  const g=i.macroGate;if(!g||g.decision!=='PASS'||i.assessment.transmission.grade<3)return 'MACRO_GATE';
  const cs=g.claimIds.map(ref=>claims.get(ref));if(!cs.length||cs.some(c=>!current(c)))return 'MACRO_GATE';
  const core=g.officialCoreClaimId?cs.find(c=>c?.claimId===g.officialCoreClaimId):undefined;
  const originIds=new Set(cs.map(c=>c!.originId));
  if(g.officialCoreClaimId&&!core||!g.independentOriginIds.every(o=>originIds.has(o)))return 'MACRO_GATE';
  if(!(core&&official.includes(core.kind))&&!(g.independentOriginIds.length>=3&&g.independentOriginIds.every(o=>originIds.has(o))))return 'MACRO_GATE';
 }
 return null;
}
function signalStatus(k:SignalKey,input:PriorityInput,candidates:PriorityIssue[],now:number):{enabled:boolean;reason:string;} {
 const s=input.signals?.[k];if(!s)return {enabled:false,reason:'NOT_PROVIDED'};
 if(!valid(s,now))return {enabled:false,reason:time(s.knownAt)>now?'FUTURE_KNOWN_INPUT':'EXPIRED'};
 if(k==='T'){
  const t=input.signals!.T!;
  if(t.completedGroups.length!==16||ATTENTION_GROUPS.some(g=>!t.completedGroups.includes(g)))return {enabled:false,reason:'INCOMPLETE_GROUPS'};
 }
 if(k==='P'&&(!input.signals!.P!.watermarkComplete||time(input.signals!.P!.windowEndAt)!==now))return {enabled:false,reason:'INCOMPLETE_WATERMARK'};
 const required=k==='M'?candidates.filter(i=>impact(i).tier!=='HIGH'):candidates;
 const values=new Map(s.values.map(e=>[e.issueId,e]));
 for(const i of required){
  const e=values.get(i.issueId);if(!e)return {enabled:false,reason:'INCOMPLETE'};
  if(e.version!==s.version)return {enabled:false,reason:'VERSION_MISMATCH'};
  if(!valid(e,now))return {enabled:false,reason:time(e.knownAt)>now?'FUTURE_KNOWN_INPUT':'EXPIRED'};
 }
 if(k==='M'&&!required.length)return {enabled:false,reason:'NO_NON_HIGH_CANDIDATES'};
 if(k==='P'){
  const total=required.reduce((sum,i)=>sum+values.get(i.issueId)!.value,0);
  if(!Number.isSafeInteger(total)||required.length<5||total<50)return {enabled:false,reason:'INSUFFICIENT_SAMPLE'};
 }
 return {enabled:true,reason:'COMPLETE_SYNTHETIC'};
}
function impact(i:PriorityIssue):{rawImpact:number;effectiveImpact:number;tier:Tier;} {
 const a=i.assessment,rawImpact=a.transmission.grade*8+a.breadth.grade*4+a.magnitude.grade*5+a.persistence.grade*3;
 const effectiveImpact=a.transmission.grade<3?Math.min(rawImpact,44):rawImpact;
 return {rawImpact,effectiveImpact,tier:effectiveImpact>=75?'HIGH':effectiveImpact>=45?'MEDIUM':'STANDARD'};
}
/** Returns a score draft only: no lane allocation, persistence hysteresis or publication. */
export function draftIssuePriority(raw:unknown):PriorityDraft {
 const emptySignals:PriorityDraft['signals']={T:{enabled:false,reason:'INVALID_INPUT'},M:{enabled:false,reason:'INVALID_INPUT'},P:{enabled:false,reason:'INVALID_INPUT'}};
 const out:PriorityDraft={status:'INVALID_INPUT',sampleKind:'SYNTHETIC',policyVersion:PRIORITY_POLICY,cutoff:'',catalogVersion:'',evaluationSetVersion:'',rows:[],excluded:[],signals:emptySignals,limitations:['INTERNAL_UNCONNECTED_SYNTHETIC_DRAFT','NO_LIVE_FACT_VERIFICATION','NO_HOME_CONTEXT_LANES_OR_STABILITY','SIGNAL_POPULATION_BEFORE_STORY_DEDUP']};
 if(object(raw)&&(raw.mode!=='LOCAL_SYNTHETIC'||raw.sampleKind!=='SYNTHETIC'))return {...out,status:'LIVE_NOT_ENABLED'};
 if(!validate(raw))return out;
 const input=raw,now=time(input.cutoff),claims=new Map(input.claims.map(c=>[c.claimId,c]));
 out.cutoff=input.cutoff;out.catalogVersion=input.catalogVersion;out.evaluationSetVersion=input.evaluationSetVersion;
 const candidates:PriorityIssue[]=[];
 for(const i of input.issues){const reason=admission(i,claims,now);if(reason)out.excluded.push({issueId:i.issueId,reason});else candidates.push(i);}
 // Canonical order also fixes the precedence of mixed missing/expired/version failures.
 candidates.sort((a,b)=>codepoint(a.issueId,b.issueId));
 // P3 S7B1P-02: use the pre-dedup eligible population for every signal, explicitly.
 out.signals={T:signalStatus('T',input,candidates,now),M:signalStatus('M',input,candidates,now),P:signalStatus('P',input,candidates,now)};
 const values=(k:SignalKey)=>new Map(input.signals?.[k]?.values.map(e=>[e.issueId,e.value])||[]);
 const ts=values('T'),ms=values('M'),ps=values('P');
 const maxUV=out.signals.P.enabled?Math.max(...candidates.map(i=>Math.log1p(ps.get(i.issueId)!))):1;
 const scored=candidates.map(i=>{
  const imp=impact(i),high=imp.tier==='HIGH';
  const components={I:imp.effectiveImpact/100,T:out.signals.T.enabled?(i.scope==='MACRO_ALL'?0.5:ts.get(i.issueId)!):null,M:!high&&out.signals.M.enabled?Math.min(Math.abs(ms.get(i.issueId)!)/10,1):null,P:out.signals.P.enabled?Math.log1p(ps.get(i.issueId)!)/maxUV:null,F:Math.pow(0.5,(now-time(i.materialChangeAt))/(6*HOUR))};
  const rawWeights={I:50,T:components.T===null?0:20,M:components.M===null?0:15,P:components.P===null?0:10,F:5};
  const denominator=Object.values(rawWeights).reduce((a,b)=>a+b,0);
  const weights={I:rawWeights.I/denominator,T:rawWeights.T/denominator,M:rawWeights.M/denominator,P:rawWeights.P/denominator,F:rawWeights.F/denominator};
  const score=100*(weights.I*components.I+weights.T*(components.T??0)+weights.M*(components.M??0)+weights.P*(components.P??0)+weights.F*components.F);
  const claimIds=[...new Set([...dimensions.flatMap(d=>i.assessment[d].claimIds),...(i.contentClass==='SYSTEMIC_MACRO'?i.macroGate!.claimIds:[])])].sort(codepoint);
  return {issueId:i.issueId,storyId:i.storyId,issueVersion:i.version,assessmentVersion:i.assessmentVersion,claimIds,...imp,components,weights,score,materialChangeAt:i.materialChangeAt};
 });
 const tierOrder={HIGH:0,MEDIUM:1,STANDARD:2};
 scored.sort((a,b)=>tierOrder[a.tier]-tierOrder[b.tier]||b.score-a.score||time(b.materialChangeAt)-time(a.materialChangeAt)||codepoint(a.issueId,b.issueId));
 const stories=new Set<string>();for(const row of scored){if(stories.has(row.storyId))out.excluded.push({issueId:row.issueId,reason:'STORY_DUPLICATE'});else{stories.add(row.storyId);out.rows.push(row);}}
 out.excluded.sort((a,b)=>codepoint(a.issueId,b.issueId));out.status='DRAFT_SYNTHETIC';return out;
}
