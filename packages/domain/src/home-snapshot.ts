/** Internal SYNTHETIC protocol model. No runtime scheduler, persistence or public caller. */
export const SNAPSHOT_POLICY='SYNTHETIC_HOME_SNAPSHOT_7B2A_V1';
type Failure='INVALID_INPUT'|'LIVE_NOT_ENABLED'|'CONTEXT_UNAVAILABLE'|'KNOWLEDGE_UNAVAILABLE';
type Result<T>={status:'DRAFT_SYNTHETIC';value:T}|{status:Failure;reason:string};
type Basis='KR_COMBINED'|'FOREIGN_US';
type Segment='FOREIGN_PRE'|'KR_DAY'|'FOREIGN_POST'|'FOREIGN_DAY';
type Kind='ISSUE'|'CLAIM'|'QUOTE'|'SEARCH'|'UV'|'CALENDAR';
interface Mode {mode:'LOCAL_SYNTHETIC';sampleKind:'SYNTHETIC';}
export interface CalendarDay {date:string;state:'OPEN'|'CLOSED';}
export interface HomeContextInput extends Mode {
 cutoff:string;policyVersion:typeof SNAPSHOT_POLICY;catalogVersion:string;comparisonSetVersion:string;evaluationSetVersion:string;
 signals:{T:boolean;M:boolean;P:boolean;};
 calendar:{calendarVersion:string;evidenceId:string;knownAt:string;validUntil:string;coverageStart:string;coverageEnd:string;days:readonly CalendarDay[];};
}
export interface HomeContext {
 cutoff:string;koreaDate:string;marketBasis:Basis;segment:Segment;targetKrTradingDay:string;contextKey:string;
 policyVersion:string;catalogVersion:string;comparisonSetVersion:string;evaluationSetVersion:string;calendarVersion:string;signals:{T:boolean;M:boolean;P:boolean;};
}
export interface RevisionRef {kind:Kind;entityId:string;revision:number;knownAt:string;status:'VALID'|'BLOCKED';contentId:string;}
export interface KnownRevisionsInput extends Mode {cutoff:string;knownDataSetVersion:string;complete:boolean;watermarkAt:string;revisions:readonly RevisionRef[];}
export interface KnownSelection {cutoff:string;knownDataSetVersion:string;selected:RevisionRef[];}
export interface SnapshotRecipe extends Mode {streamId:string;context:HomeContextInput;knowledge:KnownRevisionsInput;}
export interface SnapshotEnvelope {recipe:SnapshotRecipe;cutoff:string;context:HomeContext;knowledge:KnownSelection;canonical:string;}
export interface SnapshotState {streamId:string;revision:number;snapshots:readonly SnapshotEnvelope[];}
export interface CommitResult {
 status:'COMMITTED'|'REUSED'|'SLOT_CONFLICT'|'STALE_CUTOFF'|'CAS_CONFLICT'|Failure;
 reason:string;currentRevision:number|null;state:SnapshotState|null;snapshot:SnapshotEnvelope|null;
}
const FIVE=300000,DAY=86400000,KST=9*3600000;
const kinds:Kind[]=['ISSUE','CLAIM','QUOTE','SEARCH','UV','CALENDAR'];
const fail=(status:Failure,reason:string):{status:Failure;reason:string}=>({status,reason});
function record(v:unknown):v is Record<string,unknown> {
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const p=Object.getPrototypeOf(v);if(p!==null&&p!==Object.prototype)return false;
 return Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>'value' in d);
}
const dense=(v:unknown):v is unknown[]=>Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&Reflect.ownKeys(v).length===v.length+1&&Array.from({length:v.length},(_,n)=>n).every(n=>{const d=Object.getOwnPropertyDescriptor(v,String(n));return !!d&&'value' in d&&d.enumerable;});
const items=<T>(v:readonly T[]):T[]=>Array.from({length:v.length},(_,n)=>v[n]);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=160&&v.trim()===v;
const fields=(v:Record<string,unknown>,keys:readonly string[])=>Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return !!d&&'value' in d&&d.enumerable;});
const codepoint=(a:string,b:string):number=>{
 const x=Array.from(a),y=Array.from(b);for(let n=0;n<Math.min(x.length,y.length);n++){const d=x[n].codePointAt(0)!-y[n].codePointAt(0)!;if(d)return d;}return x.length-y.length;
};
function instant(v:unknown):number {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))return NaN;
 const n=Date.parse(v);return Number.isFinite(n)&&new Date(n).toISOString()===v.replace(/Z$/,v.includes('.')?'Z':'.000Z')?n:NaN;
}
const stamp=(v:string)=>new Date(instant(v)).toISOString();
const dayTime=(v:unknown):number=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?instant(v+'T00:00:00Z'):NaN;
const dayString=(n:number)=>new Date(n).toISOString().slice(0,10);
const cutoffOk=(v:unknown)=>Number.isFinite(instant(v))&&instant(v)%FIVE===0;
function mode(v:unknown):Failure|null {
 if(!record(v))return 'INVALID_INPUT';
 return v.mode==='LOCAL_SYNTHETIC'&&v.sampleKind==='SYNTHETIC'?null:'LIVE_NOT_ENABLED';
}
function contextInput(v:unknown):v is HomeContextInput {
 if(!record(v)||!fields(v,['mode','sampleKind','cutoff','policyVersion','catalogVersion','comparisonSetVersion','evaluationSetVersion','signals','calendar'])||mode(v)||!cutoffOk(v.cutoff)||v.policyVersion!==SNAPSHOT_POLICY||![v.catalogVersion,v.comparisonSetVersion,v.evaluationSetVersion].every(id))return false;
 if(!record(v.signals)||!fields(v.signals,['T','M','P'])||typeof v.signals.T!=='boolean'||typeof v.signals.M!=='boolean'||typeof v.signals.P!=='boolean'||!record(v.calendar))return false;
 const c=v.calendar;
 if(!fields(c,['calendarVersion','evidenceId','knownAt','validUntil','coverageStart','coverageEnd','days'])||!id(c.calendarVersion)||!id(c.evidenceId)||!Number.isFinite(instant(c.knownAt))||!Number.isFinite(instant(c.validUntil))||instant(c.knownAt)>=instant(c.validUntil)||!Number.isFinite(dayTime(c.coverageStart))||!Number.isFinite(dayTime(c.coverageEnd))||!dense(c.days))return false;
 const length=(dayTime(c.coverageEnd)-dayTime(c.coverageStart))/DAY+1;
 if(!Number.isInteger(length)||length<1||length>366||c.days.length!==length)return false;
 const dates=new Set<string>();
 for(const d of items(c.days)){if(!record(d)||!fields(d,['date','state'])||!Number.isFinite(dayTime(d.date))||dayTime(d.date)<dayTime(c.coverageStart)||dayTime(d.date)>dayTime(c.coverageEnd)||dates.has(d.date as string)||typeof d.state!=='string'||!['OPEN','CLOSED'].includes(d.state))return false;dates.add(d.date as string);}
 return true;
}
/** Chooses a home basis, not an exchange session or a usable market quote. */
export function deriveHomeContext(raw:unknown):Result<HomeContext> {
 const m=mode(raw);if(m)return fail(m,'MODE');
 if(!contextInput(raw))return fail('INVALID_INPUT','CONTEXT_SHAPE');
 const c=raw.calendar,at=instant(raw.cutoff),local=at+KST,date=dayString(local),minutes=new Date(local).getUTCHours()*60+new Date(local).getUTCMinutes();
 if(instant(c.knownAt)>at||instant(c.validUntil)<=at)return fail('CONTEXT_UNAVAILABLE','CALENDAR_TIME');
 if(dayTime(date)<dayTime(c.coverageStart)||dayTime(date)>dayTime(c.coverageEnd))return fail('CONTEXT_UNAVAILABLE','CALENDAR_COVERAGE');
 const days=items(c.days).sort((a,b)=>codepoint(a.date,b.date)),today=days.find(d=>d.date===date)!;
 const target=days.find(d=>d.state==='OPEN'&&(minutes>=1200?d.date>date:d.date>=date));
 if(!target)return fail('CONTEXT_UNAVAILABLE','NEXT_KR_DAY_UNAVAILABLE');
 const marketBasis:Basis=today.state==='OPEN'&&minutes>=490&&minutes<1200?'KR_COMBINED':'FOREIGN_US';
 const segment:Segment=today.state==='CLOSED'?'FOREIGN_DAY':minutes<490?'FOREIGN_PRE':minutes<1200?'KR_DAY':'FOREIGN_POST';
 const signals={T:raw.signals.T,M:raw.signals.M,P:raw.signals.P};
 const contextKey=JSON.stringify([raw.policyVersion,raw.catalogVersion,raw.comparisonSetVersion,raw.evaluationSetVersion,c.calendarVersion,marketBasis,target.date,signals.T,signals.M,signals.P]);
 return {status:'DRAFT_SYNTHETIC',value:{cutoff:stamp(raw.cutoff),koreaDate:date,marketBasis,segment,targetKrTradingDay:target.date,contextKey,policyVersion:raw.policyVersion,catalogVersion:raw.catalogVersion,comparisonSetVersion:raw.comparisonSetVersion,evaluationSetVersion:raw.evaluationSetVersion,calendarVersion:c.calendarVersion,signals}};
}
function knownInput(v:unknown):v is KnownRevisionsInput {
 if(!record(v)||!fields(v,['mode','sampleKind','cutoff','knownDataSetVersion','complete','watermarkAt','revisions'])||mode(v)||!cutoffOk(v.cutoff)||!id(v.knownDataSetVersion)||typeof v.complete!=='boolean'||!Number.isFinite(instant(v.watermarkAt))||!dense(v.revisions))return false;
 const seen=new Set<string>(),groups=new Map<string,RevisionRef[]>();
 for(const r of items(v.revisions)){
  if(!record(r)||!fields(r,['kind','entityId','revision','knownAt','status','contentId'])||!kinds.includes(r.kind as Kind)||!id(r.entityId)||!Number.isSafeInteger(r.revision)||Number(r.revision)<1||!Number.isFinite(instant(r.knownAt))||typeof r.status!=='string'||!['VALID','BLOCKED'].includes(r.status)||!id(r.contentId))return false;
  const key=JSON.stringify([r.kind,r.entityId]),unique=JSON.stringify([r.kind,r.entityId,r.revision]);if(seen.has(unique))return false;seen.add(unique);
  const group=groups.get(key)??[];group.push(r as unknown as RevisionRef);groups.set(key,group);
 }
 for(const group of groups.values()){group.sort((a,b)=>a.revision-b.revision);for(let n=1;n<group.length;n++)if(instant(group[n].knownAt)<instant(group[n-1].knownAt))return false;}
 return true;
}
const refCopy=(r:RevisionRef):RevisionRef=>({kind:r.kind,entityId:r.entityId,revision:r.revision,knownAt:stamp(r.knownAt),status:r.status,contentId:r.contentId});
export function selectKnownRevisions(raw:unknown):Result<KnownSelection> {
 const m=mode(raw);if(m)return fail(m,'MODE');
 if(!knownInput(raw))return fail('INVALID_INPUT','REVISION_SHAPE');
 if(!raw.complete||instant(raw.watermarkAt)!==instant(raw.cutoff))return fail('KNOWLEDGE_UNAVAILABLE','INCOMPLETE_WATERMARK');
 const selected=new Map<string,RevisionRef>(),at=instant(raw.cutoff);
 for(const r of items(raw.revisions)){if(instant(r.knownAt)>at)continue;const key=JSON.stringify([r.kind,r.entityId]),old=selected.get(key);if(!old||r.revision>old.revision)selected.set(key,refCopy(r));}
 return {status:'DRAFT_SYNTHETIC',value:{cutoff:stamp(raw.cutoff),knownDataSetVersion:raw.knownDataSetVersion,selected:[...selected.values()].sort((a,b)=>codepoint(a.kind,b.kind)||codepoint(a.entityId,b.entityId))}};
}
function normalizedRecipe(raw:SnapshotRecipe):SnapshotRecipe {
 const c=raw.context,k=raw.knowledge;
 return {mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',streamId:raw.streamId,context:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:stamp(c.cutoff),policyVersion:SNAPSHOT_POLICY,catalogVersion:c.catalogVersion,comparisonSetVersion:c.comparisonSetVersion,evaluationSetVersion:c.evaluationSetVersion,signals:{T:c.signals.T,M:c.signals.M,P:c.signals.P},calendar:{calendarVersion:c.calendar.calendarVersion,evidenceId:c.calendar.evidenceId,knownAt:stamp(c.calendar.knownAt),validUntil:stamp(c.calendar.validUntil),coverageStart:c.calendar.coverageStart,coverageEnd:c.calendar.coverageEnd,days:items(c.calendar.days).sort((a,b)=>codepoint(a.date,b.date)).map(d=>({date:d.date,state:d.state}))}},knowledge:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:stamp(k.cutoff),knownDataSetVersion:k.knownDataSetVersion,complete:k.complete,watermarkAt:stamp(k.watermarkAt),revisions:items(k.revisions).sort((a,b)=>codepoint(a.kind,b.kind)||codepoint(a.entityId,b.entityId)||a.revision-b.revision).map(refCopy)}};
}
/** Canonical equality is reproducibility metadata, never a signature or source integrity proof. */
export function buildSnapshotEnvelope(raw:unknown):Result<SnapshotEnvelope> {
 const m=mode(raw);if(m)return fail(m,'MODE');
 if(!record(raw)||!fields(raw,['mode','sampleKind','streamId','context','knowledge'])||!id(raw.streamId))return fail('INVALID_INPUT','RECIPE_SHAPE');
 const context=deriveHomeContext(raw.context);if(context.status!=='DRAFT_SYNTHETIC')return context;
 const knowledge=selectKnownRevisions(raw.knowledge);if(knowledge.status!=='DRAFT_SYNTHETIC')return knowledge;
 if(context.value.cutoff!==knowledge.value.cutoff)return fail('INVALID_INPUT','CUTOFF_MISMATCH');
 const recipe=normalizedRecipe(raw as unknown as SnapshotRecipe);
 const canonical=JSON.stringify([SNAPSHOT_POLICY,raw.streamId,context.value,knowledge.value]);
 return {status:'DRAFT_SYNTHETIC',value:{recipe,cutoff:context.value.cutoff,context:context.value,knowledge:knowledge.value,canonical}};
}
function envelope(raw:unknown):SnapshotEnvelope|null {
 if(!record(raw)||!fields(raw,['recipe','cutoff','context','knowledge','canonical'])||typeof raw.canonical!=='string')return null;
 const rebuilt=buildSnapshotEnvelope(raw.recipe);if(rebuilt.status!=='DRAFT_SYNTHETIC')return null;
 // Compare explicit structured fields too; caller-supplied success flags/canonical never bypass validation.
 if(raw.cutoff!==rebuilt.value.cutoff||!record(raw.context)||!record(raw.knowledge))return null;
 const c=raw.context,k=raw.knowledge;
 if(!fields(c,Object.keys(rebuilt.value.context))||!fields(k,['cutoff','knownDataSetVersion','selected'])||!dense(k.selected))return null;
 const keys=Object.keys(rebuilt.value.context) as (keyof HomeContext)[];
 for(const key of keys){if(key==='signals'){const signals=c.signals;if(!record(signals)||!fields(signals,['T','M','P'])||(['T','M','P'] as const).some(s=>signals[s]!==rebuilt.value.context.signals[s]))return null;}else if(c[key]!==rebuilt.value.context[key])return null;}
 if(k.cutoff!==rebuilt.value.knowledge.cutoff||k.knownDataSetVersion!==rebuilt.value.knowledge.knownDataSetVersion||k.selected.length!==rebuilt.value.knowledge.selected.length)return null;
 for(let n=0;n<k.selected.length;n++){const r=k.selected[n],want=rebuilt.value.knowledge.selected[n];if(!record(r)||!fields(r,['kind','entityId','revision','knownAt','status','contentId'])||Object.keys(want).some(key=>r[key]!==want[key as keyof RevisionRef]))return null;}
 return raw.canonical===rebuilt.value.canonical?rebuilt.value:null;
}
/** Sequential CAS model only. A real database transaction and durability remain separate work. */
export function planSnapshotCommit(raw:unknown):CommitResult {
 const bad=(status:Failure,reason:string):CommitResult=>({status,reason,currentRevision:null,state:null,snapshot:null});
 const m=mode(raw);if(m)return bad(m,'MODE');
 if(!record(raw)||!fields(raw,['mode','sampleKind','state','expectedRevision','recipe'])||!record(raw.state)||!fields(raw.state,['streamId','revision','snapshots'])||!id(raw.state.streamId)||!Number.isSafeInteger(raw.state.revision)||Number(raw.state.revision)<0||!Number.isSafeInteger(raw.expectedRevision)||Number(raw.expectedRevision)<0||!dense(raw.state.snapshots)||raw.state.revision!==raw.state.snapshots.length)return bad('INVALID_INPUT','STATE_SHAPE');
 const proposal=buildSnapshotEnvelope(raw.recipe);if(proposal.status!=='DRAFT_SYNTHETIC')return bad(proposal.status,proposal.reason);
 const snapshots:SnapshotEnvelope[]=[];
 for(const s of items(raw.state.snapshots)){const v=envelope(s);if(!v||v.recipe.streamId!==raw.state.streamId||snapshots.length&&instant(snapshots[snapshots.length-1].cutoff)>=instant(v.cutoff))return bad('INVALID_INPUT','INVALID_HISTORY');snapshots.push(v);}
 if(proposal.value.recipe.streamId!==raw.state.streamId)return bad('INVALID_INPUT','STREAM_MISMATCH');
 const state:SnapshotState={streamId:raw.state.streamId,revision:raw.state.revision as number,snapshots};
 const reply=(status:CommitResult['status'],reason:string,snapshot:SnapshotEnvelope|null):CommitResult=>({status,reason,currentRevision:state.revision,state,snapshot});
 const existing=snapshots.find(s=>s.cutoff===proposal.value.cutoff);
 if(existing)return reply(existing.canonical===proposal.value.canonical?'REUSED':'SLOT_CONFLICT','EXISTING_CUTOFF',existing);
 if(snapshots.length&&instant(proposal.value.cutoff)<instant(snapshots[snapshots.length-1].cutoff))return reply('STALE_CUTOFF','NO_POINTER_REGRESSION',null);
 if(raw.expectedRevision!==state.revision)return reply('CAS_CONFLICT','EXPECTED_REVISION_MISMATCH',null);
 state.snapshots=[...snapshots,proposal.value];state.revision++;return reply('COMMITTED','SYNTHETIC_APPEND_ONLY',proposal.value);
}
