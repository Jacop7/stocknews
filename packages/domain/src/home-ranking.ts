/** Internal SYNTHETIC composition; no public caller, scheduler or persistence. */
import {draftIssuePriority,type PriorityInput,type PriorityIssue,type PriorityRow} from './issue-priority.ts';
import {deriveHomeContext,type HomeContext,type HomeContextInput} from './home-snapshot.ts';

export const HOME_RANKING_POLICY='SYNTHETIC_HOME_RANKING_7B2B_V1';
type Tier='HIGH'|'MEDIUM'|'STANDARD';
type Lane='A'|'B'|'C';
type ContextInput=Omit<HomeContextInput,'signals'>;
export interface HomeCard extends PriorityRow {role:Lane;publishedAt:string;primarySectorId:string|null;}
interface MemoryCard {
 issueId:string;storyId:string;role:Lane;tier:Tier;score:number;materialChangeAt:string;publishedAt:string;
 primarySectorId:string|null;I:number;T:number|null;M:number|null;P:number|null;
}
export interface RankingState {
 sampleKind:'SYNTHETIC';policyVersion:typeof HOME_RANKING_POLICY;cutoff:string;contextInput:HomeContextInput;
 records:MemoryCard[];pools:Record<Lane,string[]>;seen:{issueId:string;publishedAt:string;}[];
}
export interface HomeRankingInput {
 mode:'LOCAL_SYNTHETIC';sampleKind:'SYNTHETIC';policyVersion:typeof HOME_RANKING_POLICY;context:ContextInput;
 priority:PriorityInput;sectors:{issueId:string;primarySectorId:string|null;}[];previous:RankingState|null;
}
export interface HomeRankingDraft {
 status:'DRAFT_SYNTHETIC'|'INVALID_INPUT'|'LIVE_NOT_ENABLED'|'CONTEXT_UNAVAILABLE';reason:string;
 context:HomeContext|null;lanes:Record<Lane,HomeCard[]>;state:RankingState|null;
 signals:ReturnType<typeof draftIssuePriority>['signals']|null;
 diagnostics:{code:string;issueId?:string;slot?:number;}[];limitations:readonly string[];
}
const FIVE=300000,HOUR=3600000,tiers:Tier[]=['HIGH','MEDIUM','STANDARD'],lanes:Lane[]=['A','B','C'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,names:readonly string[])=>Reflect.ownKeys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=160&&v.trim()===v;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const unit=(v:unknown):v is number=>finite(v)&&v>=0&&v<=1;
const optionalUnit=(v:unknown):v is number|null=>v===null||unit(v);
function time(v:unknown):number {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))return NaN;
 const n=Date.parse(v);return Number.isFinite(n)&&new Date(n).toISOString()===v.replace(/Z$/,v.includes('.')?'Z':'.000Z')?n:NaN;
}
const stamp=(s:string)=>new Date(time(s)).toISOString();
function canonicalContext(input:HomeContextInput):HomeContextInput {
 return {...input,cutoff:stamp(input.cutoff),calendar:{...input.calendar,knownAt:stamp(input.calendar.knownAt),validUntil:stamp(input.calendar.validUntil),days:[...input.calendar.days].sort((a,b)=>codepoint(a.date,b.date)).map(d=>({date:d.date,state:d.state}))}};
}
function codepoint(a:string,b:string):number {
 const x=Array.from(a),y=Array.from(b);for(let n=0;n<Math.min(x.length,y.length);n++){const d=x[n].codePointAt(0)!-y[n].codePointAt(0)!;if(d)return d;}return x.length-y.length;
}
/** Reify JSON data through descriptors, never an input getter or iterator. */
function copyJson(raw:unknown):unknown {
 let budget=200000;const ancestors=new Set<object>();
 function copy(v:unknown,depth:number):unknown {
  if(--budget<0||depth>20)throw new Error('JSON_LIMIT');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='string'){if(v.length>262144)throw new Error('STRING_LIMIT');return v;}
  if(typeof v==='number'){if(!Number.isFinite(v))throw new Error('NUMBER');return v;}
  if(!v||typeof v!=='object'||ancestors.has(v))throw new Error('JSON_SHAPE');
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v),own=Reflect.ownKeys(v);
  if(array?(proto!==Array.prototype||v.length>10000||own.length!==v.length+1):(proto!==Object.prototype&&proto!==null))throw new Error('JSON_PROTOTYPE');
  ancestors.add(v);
  let out:unknown;
  if(array){const values:unknown[]=[];for(let n=0;n<v.length;n++){const d=Object.getOwnPropertyDescriptor(v,String(n));if(!d||!('value'in d)||!d.enumerable)throw new Error('ARRAY_INDEX');values.push(copy(d.value,depth+1));}out=values;}
  else {const values:Record<string,unknown>={};for(const k of own){const d=Object.getOwnPropertyDescriptor(v,k)!;if(typeof k!=='string'||!d.enumerable||!('value'in d))throw new Error('OBJECT_KEY');Object.defineProperty(values,k,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}out=values;}
  ancestors.delete(v);return out;
 }
 return copy(raw,0);
}
function empty(status:HomeRankingDraft['status'],reason:string):HomeRankingDraft {
 return {status,reason,context:null,lanes:{A:[],B:[],C:[]},state:null,signals:null,diagnostics:[],limitations:['INTERNAL_UNCONNECTED_SYNTHETIC_RANKING','NO_FACT_SOURCE_OR_PREVIOUS_STATE_AUTHENTICATION','NO_DB_ATOMICITY_PUBLIC_DTO_OR_LIVE_SUPPLY']};
}
const basic=(a:MemoryCard,b:MemoryCard)=>tiers.indexOf(a.tier)-tiers.indexOf(b.tier)||b.score-a.score||time(b.materialChangeAt)-time(a.materialChangeAt)||codepoint(a.issueId,b.issueId);
const sameSet=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
function numericScore(r:MemoryCard,cutoff:string):number {
 const F=Math.pow(.5,(time(cutoff)-time(r.materialChangeAt))/(6*HOUR));
 const sum=55+(r.T===null?0:20)+(r.M===null?0:15)+(r.P===null?0:10);
 return 100*(50/sum*r.I+(r.T===null?0:20/sum*r.T)+(r.M===null?0:15/sum*r.M)+(r.P===null?0:10/sum*r.P)+5/sum*F);
}
function previousState(v:unknown,cutoff:string):RankingState|null|false {
 if(v===null)return null;
 if(!object(v)||!keys(v,['sampleKind','policyVersion','cutoff','contextInput','records','pools','seen'])||v.sampleKind!=='SYNTHETIC'||v.policyVersion!==HOME_RANKING_POLICY||!Number.isFinite(time(v.cutoff))||time(v.cutoff)>=time(cutoff)||!Array.isArray(v.records)||v.records.length>300||!object(v.pools)||!keys(v.pools,lanes)||!Array.isArray(v.seen)||v.seen.length>600)return false;
 const context=deriveHomeContext(v.contextInput);if(context.status!=='DRAFT_SYNTHETIC'||time(context.value.cutoff)!==time(v.cutoff))return false;
 const previousCutoff=stamp(v.cutoff as string);
 const signals=context.value.signals,ids=new Set<string>(),stories=new Set<string>();
 const records:MemoryCard[]=[];
 for(const r of v.records){
  if(!object(r)||!keys(r,['issueId','storyId','role','tier','score','materialChangeAt','publishedAt','primarySectorId','I','T','M','P'])||!id(r.issueId)||!id(r.storyId)||ids.has(r.issueId)||stories.has(r.storyId)||!lanes.includes(r.role as Lane)||!tiers.includes(r.tier as Tier)||!finite(r.score)||r.score<0||r.score>100||!unit(r.I)||Math.abs(r.I*100-Math.round(r.I*100))>1e-8||!optionalUnit(r.T)||!optionalUnit(r.M)||!optionalUnit(r.P)||r.primarySectorId!==null&&!id(r.primarySectorId)||!Number.isFinite(time(r.publishedAt))||!Number.isFinite(time(r.materialChangeAt))||time(r.publishedAt)>time(r.materialChangeAt)||time(r.materialChangeAt)>time(v.cutoff))return false;
  const tier:Tier=r.I>=.75?'HIGH':r.I>=.45?'MEDIUM':'STANDARD',role:Lane=tier==='HIGH'?(r.primarySectorId===null?'A':'B'):'C';
  if(r.tier!==tier||r.role!==role||(r.T!==null)!==signals.T||(r.P!==null)!==signals.P||(r.M!==null)!==(signals.M&&tier!=='HIGH')||signals.T&&r.primarySectorId===null&&r.T!==.5)return false;
  if(Math.abs(numericScore(r as unknown as MemoryCard,v.cutoff as string)-r.score)>1e-8)return false;
  ids.add(r.issueId);stories.add(r.storyId);records.push({...r,materialChangeAt:stamp(r.materialChangeAt as string),publishedAt:stamp(r.publishedAt as string)} as unknown as MemoryCard);
 }
 if(signals.M&&!records.some(r=>r.tier!=='HIGH')||signals.P&&(records.length<5||!records.some(r=>r.P!==null&&Math.abs(r.P-1)<1e-10)))return false;
 for(const lane of lanes)if(!Array.isArray(v.pools[lane])||v.pools[lane].length>300||!v.pools[lane].every(id))return false;
 const pools=v.pools as Record<Lane,string[]>;
 if(!sameSet(pools.A,records.filter(r=>r.role==='A').map(r=>r.issueId)))return false;
 const pickedA=new Set(pools.A.slice(0,2));
 if(!sameSet(pools.B,records.filter(r=>r.tier==='HIGH'&&!pickedA.has(r.issueId)).map(r=>r.issueId)))return false;
 const pickedB=new Set(pools.B.slice(0,3));
 if(!sameSet(pools.C,records.filter(r=>!pickedA.has(r.issueId)&&!pickedB.has(r.issueId)).map(r=>r.issueId)))return false;
 const byId=new Map(records.map(r=>[r.issueId,r]));
 if(pools.C.some((s,n)=>n>0&&tiers.indexOf(byId.get(s)!.tier)<tiers.indexOf(byId.get(pools.C[n-1])!.tier)))return false;
 const seenIds=new Set<string>(),seen:RankingState['seen']=[];
 for(const s of v.seen){if(!object(s)||!keys(s,['issueId','publishedAt'])||!id(s.issueId)||seenIds.has(s.issueId)||!Number.isFinite(time(s.publishedAt))||time(s.publishedAt)>time(v.cutoff)||time(s.publishedAt)+HOUR<=time(v.cutoff)||byId.has(s.issueId)&&time(byId.get(s.issueId)!.publishedAt)!==time(s.publishedAt))return false;seenIds.add(s.issueId);seen.push({issueId:s.issueId,publishedAt:stamp(s.publishedAt as string)});}
 return {sampleKind:'SYNTHETIC',policyVersion:HOME_RANKING_POLICY,cutoff:previousCutoff,contextInput:canonicalContext(v.contextInput as HomeContextInput),records,pools,seen};
}
function memory(card:HomeCard):MemoryCard {
 return {issueId:card.issueId,storyId:card.storyId,role:card.role,tier:card.tier,score:card.score,materialChangeAt:stamp(card.materialChangeAt),publishedAt:stamp(card.publishedAt),primarySectorId:card.primarySectorId,I:card.components.I,T:card.components.T,M:card.components.M,P:card.components.P};
}
function highSignature(context:HomeContext,records:MemoryCard[]):string {
 return JSON.stringify([HOME_RANKING_POLICY,context.catalogVersion,context.evaluationSetVersion,context.signals.T,context.signals.P,records.filter(r=>r.tier==='HIGH').sort((a,b)=>codepoint(a.issueId,b.issueId)).map(r=>[r.issueId,r.storyId,r.role,r.tier,r.materialChangeAt])]);
}
function stabilize(pool:MemoryCard[],lane:Lane,previous:RankingState|null,context:HomeContext,highSame:boolean,diagnostics:HomeRankingDraft['diagnostics']):string[] {
 const oldContext=previous?deriveHomeContext(previous.contextInput):null;
 const same=oldContext?.status==='DRAFT_SYNTHETIC'&&oldContext.value.contextKey===context.contextKey;
 const oldRows=new Map(previous?.records.map(r=>[r.issueId,r])??[]),oldPool=previous?.pools[lane]??[];
 const consecutive=!!previous&&time(context.cutoff)-time(previous.cutoff)===FIVE;
 const order:MemoryCard[]=[];
 for(const tier of tiers){
  const current=pool.filter(r=>r.tier===tier).sort(basic);
  if(!previous||!(same||tier==='HIGH'&&highSame)){order.push(...current);continue;}
  const currentMap=new Map(current.map(r=>[r.issueId,r]));
  const urgent=new Set(current.filter(r=>{const p=oldRows.get(r.issueId);return !p||!oldPool.includes(r.issueId)||p.tier!==r.tier||p.role!==r.role||p.storyId!==r.storyId||time(r.materialChangeAt)>time(p.materialChangeAt);}).map(r=>r.issueId));
  const stable=oldPool.filter(s=>currentMap.has(s)&&!urgent.has(s)).map(s=>currentMap.get(s)!);
  for(const r of current.filter(r=>urgent.has(r.issueId))){const at=stable.findIndex(s=>basic(r,s)<0);stable.splice(at<0?stable.length:at,0,r);diagnostics.push({code:'IMMEDIATE_INSERT_'+lane,issueId:r.issueId});}
  let changed=true;
  while(changed){changed=false;for(let n=0;n+1<stable.length;n++){
   const a=stable[n],b=stable[n+1];if(basic(b,a)>=0)continue;
   const pa=oldRows.get(a.issueId),pb=oldRows.get(b.issueId);
   const immediate=urgent.has(a.issueId)||urgent.has(b.issueId);
   const mature=consecutive&&pa&&pb&&pa.tier===tier&&pb.tier===tier&&oldPool.includes(a.issueId)&&oldPool.includes(b.issueId)&&b.score-a.score>=5&&pb.score-pa.score>=5;
   if(immediate||mature){stable[n]=b;stable[n+1]=a;changed=true;diagnostics.push({code:immediate?'IMMEDIATE_ORDER_'+lane:'TWO_FRAME_SWAP_'+lane,issueId:b.issueId});}
  }}
  order.push(...stable);
 }
 return order.map(r=>r.issueId);
}
function selectC(pool:string[],cards:Map<string,HomeCard>,cutoff:string,seen:Set<string>,diagnostics:HomeRankingDraft['diagnostics']):string[] {
 const remaining=[...pool],picked:string[]=[],counts=new Map<string,number>(),now=time(cutoff);
 while(remaining.length&&picked.length<20){
  const slot=picked.length+1,tier=cards.get(remaining[0])!.tier,group=remaining.filter(s=>cards.get(s)!.tier===tier);
  const allowed=(s:string)=>{const sector=cards.get(s)!.primarySectorId;return slot>10||sector===null||(counts.get(sector)??0)<2;};
  const preferred=group.filter(allowed);let chosen=preferred[0]??group[0];
  if(!preferred.length)diagnostics.push({code:'QUOTA_RELAXED_SAME_TIER',slot});
  if([5,10,15,20].includes(slot)&&tier==='STANDARD'){
   const fresh=preferred.filter(s=>!seen.has(s)&&now-time(cards.get(s)!.publishedAt)<HOUR).sort((a,b)=>time(cards.get(b)!.publishedAt)-time(cards.get(a)!.publishedAt)||codepoint(a,b));
   if(fresh.length){chosen=fresh[0];diagnostics.push({code:'DISCOVERY_STANDARD',issueId:chosen,slot});}
  }
  picked.push(chosen);remaining.splice(remaining.indexOf(chosen),1);const sector=cards.get(chosen)!.primarySectorId;if(slot<=10&&sector!==null)counts.set(sector,(counts.get(sector)??0)+1);
 }
 return picked;
}
function rank(raw:unknown):HomeRankingDraft {
 if(!object(raw))return empty('INVALID_INPUT','ROOT');
 if(raw.mode!=='LOCAL_SYNTHETIC'||raw.sampleKind!=='SYNTHETIC')return empty('LIVE_NOT_ENABLED','MODE');
 if(!keys(raw,['mode','sampleKind','policyVersion','context','priority','sectors','previous'])||raw.policyVersion!==HOME_RANKING_POLICY||!object(raw.context)||!keys(raw.context,['mode','sampleKind','cutoff','policyVersion','catalogVersion','comparisonSetVersion','evaluationSetVersion','calendar'])||!object(raw.priority)||!Array.isArray(raw.sectors))return empty('INVALID_INPUT','INPUT_SHAPE');
 const initialContext=deriveHomeContext({...raw.context,signals:{T:false,M:false,P:false}});
 if(initialContext.status!=='DRAFT_SYNTHETIC')return empty(initialContext.status==='LIVE_NOT_ENABLED'?'LIVE_NOT_ENABLED':initialContext.status==='CONTEXT_UNAVAILABLE'?'CONTEXT_UNAVAILABLE':'INVALID_INPUT',initialContext.reason);
 const priority=raw.priority as unknown as PriorityInput;
 if(!Array.isArray(priority.issues)||priority.issues.length>300||!Array.isArray(priority.claims)||priority.claims.length>5000||time(priority.cutoff)!==time(initialContext.value.cutoff)||priority.catalogVersion!==initialContext.value.catalogVersion||priority.evaluationSetVersion!==initialContext.value.evaluationSetVersion)return empty('INVALID_INPUT','INPUT_VERSION_OR_SIZE');
 const global=draftIssuePriority(priority);if(global.status!=='DRAFT_SYNTHETIC')return empty(global.status,'PRIORITY_STRUCTURE');
 priority.cutoff=initialContext.value.cutoff;
 const previous=previousState(raw.previous,priority.cutoff);if(previous===false)return empty('INVALID_INPUT','PREVIOUS_STATE');
 const sectors=new Map<string,string|null>(),issueMap=new Map(priority.issues.map(i=>[i.issueId,i]));
 for(const s of raw.sectors){if(!object(s)||!keys(s,['issueId','primarySectorId'])||!id(s.issueId)||sectors.has(s.issueId)||!issueMap.has(s.issueId)||s.primarySectorId!==null&&!id(s.primarySectorId))return empty('INVALID_INPUT','SECTOR_MAP');sectors.set(s.issueId,s.primarySectorId as string|null);}
 if(sectors.size!==priority.issues.length||priority.issues.some(i=>i.scope==='MACRO_ALL'?sectors.get(i.issueId)!==null:!id(sectors.get(i.issueId))))return empty('INVALID_INPUT','SECTOR_COVERAGE');
 const result=empty('DRAFT_SYNTHETIC','SYNTHETIC_COMPOSITION');
 const eligible:{issue:PriorityIssue;row:PriorityRow;role:Lane;}[]=[];
 for(const issue of priority.issues){const isolated:PriorityInput={...priority,issues:[issue]};delete isolated.signals;const single=draftIssuePriority(isolated);if(single.status!=='DRAFT_SYNTHETIC')return empty('INVALID_INPUT','ISOLATED_PRIORITY');if(single.rows.length){const row=single.rows[0];eligible.push({issue,row,role:row.tier==='HIGH'?(issue.scope==='MACRO_ALL'?'A':'B'):'C'});}else for(const x of single.excluded)result.diagnostics.push({code:x.reason,issueId:x.issueId});}
 const grouped=new Map<string,typeof eligible>();for(const e of eligible){const group=grouped.get(e.issue.storyId)??[];group.push(e);grouped.set(e.issue.storyId,group);}
 const previousRepresentatives=new Map(previous?.records.map(r=>[r.storyId,r])??[]),selected:PriorityIssue[]=[];
 for(const storyId of [...grouped.keys()].sort(codepoint)){
  const group=grouped.get(storyId)!,best=Math.min(...group.map(e=>lanes.indexOf(e.role))),pool=group.filter(e=>lanes.indexOf(e.role)===best);
  const old=previousRepresentatives.get(storyId),kept=pool.find(e=>e.issue.issueId===old?.issueId);
  const representative=kept??pool.sort((a,b)=>time(b.issue.materialChangeAt)-time(a.issue.materialChangeAt)||time(b.issue.publishedAt)-time(a.issue.publishedAt)||codepoint(a.issue.issueId,b.issue.issueId))[0];
  selected.push(representative.issue);for(const e of group)if(e!==representative)result.diagnostics.push({code:'STORY_NON_REPRESENTATIVE',issueId:e.issue.issueId});
 }
 const selectedIds=new Set(selected.map(i=>i.issueId)),scoring:PriorityInput={...priority,issues:selected};
 if(priority.signals){scoring.signals={};for(const k of ['T','M','P'] as const){const source=priority.signals[k];if(source){const filtered={...source,values:source.values.filter(v=>selectedIds.has(v.issueId))};if(k==='T'){
    filtered.values=filtered.values.filter(v=>issueMap.get(v.issueId)!.scope!=='MACRO_ALL');
    for(const i of selected.filter(i=>i.scope==='MACRO_ALL')){filtered.values.push({issueId:i.issueId,value:.5,sampleKind:'SYNTHETIC',version:source.version,knownAt:source.knownAt,validUntil:source.validUntil});result.diagnostics.push({code:'DERIVED_MACRO_NEUTRAL',issueId:i.issueId});}
   }(scoring.signals as Record<string,unknown>)[k]=filtered;
  }}}
 const scored=draftIssuePriority(scoring);if(scored.status!=='DRAFT_SYNTHETIC')return empty('INVALID_INPUT','REPRESENTATIVE_PRIORITY');
 const signals={T:scored.signals.T.enabled,M:scored.signals.M.enabled,P:scored.signals.P.enabled};
 const sourceContext=raw.context as unknown as ContextInput;
 const contextInput:HomeContextInput=canonicalContext({...sourceContext,cutoff:priority.cutoff,signals});
 const context=deriveHomeContext(contextInput);if(context.status!=='DRAFT_SYNTHETIC')return empty('INVALID_INPUT','DERIVED_CONTEXT');
 const cards=new Map<string,HomeCard>();for(const row of scored.rows){const i=issueMap.get(row.issueId)!;cards.set(row.issueId,{...row,role:row.tier==='HIGH'?(i.scope==='MACRO_ALL'?'A':'B'):'C',materialChangeAt:stamp(row.materialChangeAt),publishedAt:stamp(i.publishedAt),primarySectorId:sectors.get(row.issueId)!});}
 const records=[...cards.values()].map(memory).sort((a,b)=>codepoint(a.issueId,b.issueId)),previousById=new Map(previous?.records.map(r=>[r.issueId,r])??[]),seenOld=new Map(previous?.seen.map(s=>[s.issueId,s.publishedAt])??[]);
 for(const r of records){const old=previousById.get(r.issueId)?.publishedAt??seenOld.get(r.issueId);if(old!==undefined&&old!==r.publishedAt)return empty('INVALID_INPUT','FIRST_PUBLICATION_CHANGED');}
 const oldContext=previous?deriveHomeContext(previous.contextInput):null;
 const highSame=!!previous&&oldContext?.status==='DRAFT_SYNTHETIC'&&highSignature(context.value,records)===highSignature(oldContext.value,previous.records);
 if(highSame&&oldContext?.status==='DRAFT_SYNTHETIC'&&oldContext.value.contextKey!==context.value.contextKey)result.diagnostics.push({code:'HIGH_NONPRICE_CONTINUITY'});
 const A=stabilize(records.filter(r=>r.role==='A'),'A',previous,context.value,highSame,result.diagnostics),pickedA=new Set(A.slice(0,2));
 const B=stabilize(records.filter(r=>r.tier==='HIGH'&&!pickedA.has(r.issueId)),'B',previous,context.value,highSame,result.diagnostics),pickedB=new Set(B.slice(0,3));
 const C=stabilize(records.filter(r=>!pickedA.has(r.issueId)&&!pickedB.has(r.issueId)),'C',previous,context.value,highSame,result.diagnostics);
 const now=time(priority.cutoff),seen=new Map((previous?.seen??[]).filter(s=>time(s.publishedAt)+HOUR>now).map(s=>[s.issueId,s.publishedAt]));
 const pickedC=selectC(C,cards,priority.cutoff,new Set(seen.keys()),result.diagnostics);
 for(const s of [...pickedA,...pickedB,...pickedC]){const c=cards.get(s)!;if(time(c.publishedAt)+HOUR>now)seen.set(s,c.publishedAt);}
 if(seen.size>600)return empty('INVALID_INPUT','SEEN_LIMIT');
 result.context=context.value;result.signals=scored.signals;result.lanes={A:[...pickedA].map(s=>cards.get(s)!),B:[...pickedB].map(s=>cards.get(s)!),C:pickedC.map(s=>cards.get(s)!)};
 result.state={sampleKind:'SYNTHETIC',policyVersion:HOME_RANKING_POLICY,cutoff:priority.cutoff,contextInput,records,pools:{A,B,C},seen:[...seen].sort((a,b)=>codepoint(a[0],b[0])).map(([issueId,publishedAt])=>({issueId,publishedAt}))};
 result.diagnostics.sort((a,b)=>codepoint(a.code,b.code)||codepoint(a.issueId??'',b.issueId??'')||(a.slot??0)-(b.slot??0));return result;
}
/** Previous state is synthetic input, not an authenticated database completion receipt. */
export function draftHomeRanking(raw:unknown):HomeRankingDraft {
 try{return rank(copyJson(raw));}catch{return empty('INVALID_INPUT','JSON_STRUCTURE_OR_LIMIT');}
}
