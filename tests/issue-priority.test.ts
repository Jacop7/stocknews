import test from 'node:test';
import assert from 'node:assert/strict';
import {draftIssuePriority,PRIORITY_POLICY,ATTENTION_GROUPS,type PriorityInput,type PriorityIssue,type PriorityValue} from '../packages/domain/src/issue-priority.ts';

const now=Date.parse('2026-11-15T03:00:00.000Z'),at=(hours:number)=>new Date(now+hours*3600000).toISOString();
const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} ~= ${expected}`);
function issue(issueId='ai',grades=[4,4,4,4]):PriorityIssue {
 return {issueId,storyId:'story-'+issueId,version:'v1',assessmentVersion:'assessment-v1',sampleKind:'SYNTHETIC',inputKnownAt:at(-1),publishedAt:at(-12),materialChangeAt:at(0),lastVerifiedAt:at(-1),evidenceValidUntil:at(23),publicationState:'PUBLISHED',contentClass:'SECTOR_EVENT',impactState:'ACTIVE',direction:'POSITIVE',scope:'SECTOR',assessment:{transmission:{grade:grades[0],claimIds:['claim']},breadth:{grade:grades[1],claimIds:['claim']},magnitude:{grade:grades[2],claimIds:['claim']},persistence:{grade:grades[3],claimIds:['claim']}}};
}
function fixture(issues:PriorityIssue[]=[issue()]):PriorityInput {
 return {mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:at(0),policyVersion:PRIORITY_POLICY,catalogVersion:'catalog-v1',evaluationSetVersion:'evaluations-v1',claims:[{claimId:'claim',originId:'origin',kind:'FILING',sampleKind:'SYNTHETIC',version:'v1',knownAt:at(-13),verifiedAt:at(-12),validUntil:at(24),status:'VERIFIED'}],issues};
}
const value=(issueId:string,v:number):PriorityValue=>({issueId,value:v,sampleKind:'SYNTHETIC',version:'signals-v1',knownAt:at(-1),validUntil:at(24)});
function signals(f:PriorityInput,t=.5,m=2,uv=[3,31,8,8,0]){
 const meta={sampleKind:'SYNTHETIC' as const,version:'signals-v1',knownAt:at(-1),validUntil:at(24)};
 f.signals={T:{...meta,mode:'DERIVED_SYNTHETIC',completedGroups:[...ATTENTION_GROUPS],values:f.issues.map(i=>value(i.issueId,t))},M:{...meta,unit:'PERCENT',comparisonPolicyVersion:'comparison-v1',values:f.issues.map(i=>value(i.issueId,m))},P:{...meta,windowEndAt:at(0),watermarkComplete:true,values:f.issues.map((i,n)=>value(i.issueId,uv[n]??0))}};return f;
}
function reason(f:PriorityInput){return draftIssuePriority(f).excluded[0]?.reason;}
test('SYNTHETIC draft is not a live/home API; all missing signals off, no IO entry needed',()=>{let r=draftIssuePriority(fixture());assert.equal(r.status,'DRAFT_SYNTHETIC');assert.equal(r.rows.length,1);assert.ok(Object.values(r.signals).every(s=>!s.enabled));close(r.rows[0].weights.I,50/55);assert.ok(r.limitations.includes('NO_HOME_CONTEXT_LANES_OR_STABILITY'));});
test('numeric policy examples use effective I/100 and renormalize available weights',()=>{
 let f=signals(fixture(['a','b','c','d','e'].map(n=>issue(n,[3,3,3,3]))));let r=draftIssuePriority(f),a=r.rows.find(i=>i.issueId==='a')!;close(a.components.P!,0.4);close(a.score,52);
 delete f.signals!.M;r=draftIssuePriority(f);close(r.rows.find(i=>i.issueId==='a')!.score,100*49/85);
 f=signals(fixture(['a','b','c','d','e'].map(n=>issue(n))),.8);close(draftIssuePriority(f).rows.find(i=>i.issueId==='a')!.score,100*65/85);
});
test('tier boundaries are 44/45/74/75; max100 and all-zero0',()=>{
 for(const [g,want] of [[[3,0,4,0],'STANDARD'],[[3,2,2,1],'MEDIUM'],[[4,3,3,5],'MEDIUM'],[[4,4,3,4],'HIGH'],[[5,5,5,5],'HIGH'],[[0,0,0,0],'STANDARD']] as const){let i=issue('x',[...g]),r=draftIssuePriority(fixture([i])).rows[0];assert.equal(r.tier,want);assert.ok(r.effectiveImpact<=100);}
});
test('weak Korean transmission caps raw HIGH to44',()=>{let r=draftIssuePriority(fixture([issue('x',[2,5,5,5])])).rows[0];assert.equal(r.rawImpact,76);assert.equal(r.effectiveImpact,44);assert.equal(r.tier,'STANDARD');});
test('negative evidence direction is not a negative importance score',()=>{let f=fixture(),before=draftIssuePriority(f).rows[0];f.issues[0].direction='NEGATIVE';assert.equal(draftIssuePriority(f).rows[0].score,before.score);});
for(const state of ['DRAFT','CORRECTION_PENDING','HIDDEN','RETRACTED'] as const)test('publication exclusion '+state,()=>{let f=fixture();f.issues[0].publicationState=state;assert.equal(reason(f),'PUBLICATION_'+state);});
for(const state of ['CHECK_PENDING','RESOLVED','INVALIDATED'] as const)test('impact exclusion '+state,()=>{let f=fixture();f.issues[0].impactState=state;assert.equal(reason(f),'IMPACT_'+state);});
for(const c of ['AD_PROMOTION','IRRELEVANT','UNVERIFIED'] as const)test('content exclusion '+c,()=>{let f=fixture();f.issues[0].contentClass=c;assert.equal(reason(f),'CONTENT_'+c);});
test('24h verification boundary and exact evidence expiry exclude, without fallback',()=>{let f=fixture();f.issues[0].publishedAt=at(-30);f.issues[0].materialChangeAt=at(-24);f.issues[0].lastVerifiedAt=at(-24);f.issues[0].evidenceValidUntil=at(0);assert.equal(reason(f),'EVIDENCE_EXPIRED');f.issues[0].lastVerifiedAt=at(-1);f.issues[0].evidenceValidUntil=at(0);assert.equal(reason(f),'EVIDENCE_EXPIRED');});
test('scheduled end earlier than evidence expiry excludes immediately',()=>{let f=fixture();f.issues[0].scheduledEndAt=at(0);assert.equal(reason(f),'SCHEDULED_END');f.issues[0].scheduledEndAt=at(-1);assert.equal(reason(f),'SCHEDULED_END');f.issues[0].scheduledEndAt=at(1);assert.equal(draftIssuePriority(f).rows.length,1);});
test('future received candidate does not reuse an earlier version',()=>{let f=fixture();f.issues[0].inputKnownAt=at(1);assert.equal(reason(f),'FUTURE_KNOWN_INPUT');});
for(const key of ['publishedAt','materialChangeAt','lastVerifiedAt'] as const)test('future event '+key,()=>{let f=fixture();if(key==='publishedAt'){f.issues[0].lastVerifiedAt=at(2);f.issues[0].materialChangeAt=at(2);f.issues[0].evidenceValidUntil=at(23);}f.issues[0][key]=at(1);assert.equal(reason(f),'FUTURE_EVENT');});
test('absent/retracted/unverified/expired or future claim makes evidence unavailable',()=>{
 for(const mut of [(f:PriorityInput)=>{f.claims=[];},(f:PriorityInput)=>{f.claims[0].status='RETRACTED';},(f:PriorityInput)=>{f.claims[0].status='UNVERIFIED';},(f:PriorityInput)=>{f.claims[0].validUntil=at(0);},(f:PriorityInput)=>{f.claims[0].knownAt=at(1);f.claims[0].verifiedAt=at(2);}]){let f=fixture();mut(f);assert.equal(reason(f),'EVIDENCE_UNAVAILABLE');}
});
test('high grades with only weak claims exclude entire candidate, not silently downgrade',()=>{let f=fixture();f.claims[0].kind='OTHER';assert.equal(reason(f),'EVIDENCE_GRADE_UNSUPPORTED');});
test('positive grade with no claim excludes; zero grades allow no claim',()=>{let f=fixture();f.issues[0].assessment.breadth.claimIds=[];assert.equal(reason(f),'EVIDENCE_GRADE_UNSUPPORTED');f.issues=[issue('zero',[0,0,0,0])];for(const g of Object.values(f.issues[0].assessment))g.claimIds=[];let r=draftIssuePriority(f);assert.equal(r.rows[0].effectiveImpact,0);});
test('sparse or inherited claim-ID positions cannot manufacture unsupported HIGH',()=>{
 for(const sparse of [Array(1),Object.assign(Array(2),{1:'claim'}),Object.setPrototypeOf(Array(1),Object.assign(Object.create(Array.prototype),{0:'claim'}))]){let f=fixture([issue('unsupported',[5,5,2,2])]);f.claims=[];for(const g of Object.values(f.issues[0].assessment))g.claimIds=sparse;let r=draftIssuePriority(f);assert.equal(r.status,'INVALID_INPUT');assert.deepEqual(r.rows,[]);}
});
test('sparse macro references and attention-group arrays are malformed, never eligible evidence',()=>{
 let f=macro();f.issues[0].macroGate!.claimIds=Array(1);assert.equal(draftIssuePriority(f).status,'INVALID_INPUT');f=macro();f.issues[0].macroGate!.independentOriginIds=Array(1);assert.equal(draftIssuePriority(f).status,'INVALID_INPUT');f=signals(fixture());f.signals!.T!.completedGroups=Array(16);assert.equal(draftIssuePriority(f).status,'INVALID_INPUT');
});
function macro(){let f=fixture();f.issues[0].contentClass='SYSTEMIC_MACRO';f.issues[0].scope='MACRO_ALL';f.issues[0].macroGate={decision:'PASS',gateVersion:'macro-v1',claimIds:['claim'],independentOriginIds:[],officialCoreClaimId:'claim'};return f;}
test('macro official core1 and independently linked3; forwarded same origin is not3',()=>{
 let f=macro();assert.equal(draftIssuePriority(f).rows.length,1);delete f.issues[0].macroGate!.officialCoreClaimId;assert.equal(reason(f),'MACRO_GATE');
 f.claims=[1,2,3].map(n=>({...fixture().claims[0],claimId:'c'+n,originId:'o'+n,kind:'INDUSTRY_DATA'}));for(const g of Object.values(f.issues[0].assessment))g.claimIds=['c1'];f.issues[0].macroGate={decision:'PASS',gateVersion:'macro-v1',claimIds:['c1','c2','c3'],independentOriginIds:['o1','o2','o3']};assert.equal(draftIssuePriority(f).rows.length,1);f.claims[2].originId='o1';assert.equal(reason(f),'MACRO_GATE');
});
test('macro missing gate/HOLD/low Korean transmission cannot enter',()=>{let f=macro();f.issues[0].macroGate!.decision='HOLD';assert.equal(reason(f),'MACRO_GATE');delete f.issues[0].macroGate;assert.equal(reason(f),'MACRO_GATE');f=macro();f.issues[0].assessment.transmission.grade=2;assert.equal(reason(f),'MACRO_GATE');});
test('all macro gate-only evidence IDs survive independent-three and separate-core admission',()=>{
 let f=macro();f.claims=[1,2,3].map(n=>({...fixture().claims[0],claimId:'c'+n,originId:'o'+n,kind:'INDUSTRY_DATA'}));for(const g of Object.values(f.issues[0].assessment))g.claimIds=['c1'];f.issues[0].macroGate={decision:'PASS',gateVersion:'macro-v1',claimIds:['c3','c1','c2'],independentOriginIds:['o3','o2','o1']};assert.deepEqual(draftIssuePriority(f).rows[0].claimIds,['c1','c2','c3']);
 f=macro();f.claims.push({...f.claims[0],claimId:'core',originId:'official-core'});f.issues[0].macroGate!.claimIds=['core','claim'];f.issues[0].macroGate!.officialCoreClaimId='core';assert.deepEqual(draftIssuePriority(f).rows[0].claimIds,['claim','core']);
 f.issues[0].macroGate!.officialCoreClaimId='unregistered';assert.equal(reason(f),'MACRO_GATE');f.issues[0].macroGate!.officialCoreClaimId='core';f.issues[0].macroGate!.independentOriginIds=['unlinked-origin'];assert.equal(reason(f),'MACRO_GATE');
});
test('macro attention is neutral .5 only after complete signal-set checks',()=>{let f=signals(macro(),.9);close(draftIssuePriority(f).rows[0].components.T!,0.5);f.signals!.T!.completedGroups=[];assert.equal(draftIssuePriority(f).rows[0].components.T,null);});
test('AI HIGH beats shipbuilding STANDARD even with maximal price/attention signals',()=>{let f=signals(fixture([issue('ai'),issue('ship',[2,5,5,5])]),1,100);let r=draftIssuePriority(f);assert.equal(r.rows[0].issueId,'ai');assert.equal(r.rows[1].tier,'STANDARD');});
test('two HIGH issues cannot reorder on M alone and HIGH missing M never disables other valid M',()=>{
 let f=signals(fixture([issue('ai'),issue('ship',[4,4,4,3]),issue('medium',[3,3,3,3])]));let before=draftIssuePriority(f);f.signals!.M!.values=f.signals!.M!.values.filter(v=>v.issueId!=='ai');f.signals!.M!.values.find(v=>v.issueId==='ship')!.value=-10;let after=draftIssuePriority(f);assert.deepEqual(after.rows.map(r=>[r.issueId,r.score]),before.rows.map(r=>[r.issueId,r.score]));assert.ok(after.signals.M.enabled);assert.equal(after.rows[0].weights.M,0);
});
test('new stronger supported event may outrank AI without fixed-sector bonus',()=>{let f=fixture([issue('ai'),issue('ship',[5,5,5,5])]);assert.equal(draftIssuePriority(f).rows[0].issueId,'ship');});
test('one non-HIGH missing M disables M for entire draft; signed response uses absolute magnitude',()=>{let f=signals(fixture([issue('a',[3,3,3,3]),issue('b',[3,3,3,3])]));f.signals!.M!.values[0].value=-2;close(draftIssuePriority(f).rows[0].components.M!,.2);f.signals!.M!.values=f.signals!.M!.values.slice(0,1);let r=draftIssuePriority(f);assert.equal(r.signals.M.reason,'INCOMPLETE');assert.ok(r.rows.every(r=>r.components.M===null));});
for(const kind of ['T','M','P'] as const)test('one invalid/future/expired/version signal disables entire '+kind,()=>{
 let f=signals(fixture(['a','b','c','d','e'].map(n=>issue(n,[3,3,3,3]))));f.signals![kind]!.values[0].version='other';assert.equal(draftIssuePriority(f).signals[kind].reason,'VERSION_MISMATCH');f.signals![kind]!.values[0].version='signals-v1';f.signals![kind]!.values[0].validUntil=at(0);assert.equal(draftIssuePriority(f).signals[kind].reason,'EXPIRED');f.signals![kind]!.values[0].knownAt=at(1);f.signals![kind]!.values[0].validUntil=at(3);assert.equal(draftIssuePriority(f).signals[kind].reason,'FUTURE_KNOWN_INPUT');
});
test('P population 5 and sum50 exact boundary, zero distinct from missing',()=>{
 let f=signals(fixture(['a','b','c','d','e'].map(n=>issue(n))));let r=draftIssuePriority(f);assert.ok(r.signals.P.enabled);assert.equal(r.rows.find(r=>r.issueId==='e')!.components.P,0);f.signals!.P!.values[0].value=2;assert.equal(draftIssuePriority(f).signals.P.reason,'INSUFFICIENT_SAMPLE');f=signals(fixture(['a','b','c','d'].map(n=>issue(n))),.5,2,[20,20,20,20]);assert.equal(draftIssuePriority(f).signals.P.reason,'INSUFFICIENT_SAMPLE');
});
test('P missing watermark/window or one missing candidate is off, not zero UV',()=>{let f=signals(fixture(['a','b','c','d','e'].map(n=>issue(n))));f.signals!.P!.watermarkComplete=false;assert.equal(draftIssuePriority(f).signals.P.reason,'INCOMPLETE_WATERMARK');f.signals!.P!.watermarkComplete=true;f.signals!.P!.windowEndAt=at(-1);assert.equal(draftIssuePriority(f).signals.P.reason,'INCOMPLETE_WATERMARK');f.signals!.P!.windowEndAt=at(0);f.signals!.P!.values=f.signals!.P!.values.slice(1);assert.equal(draftIssuePriority(f).signals.P.reason,'INCOMPLETE');});
test('all eight T/M/P availability combinations have normalized weights and HIGH M=0',()=>{
 for(let bits=0;bits<8;bits++){let f=signals(fixture(['a','b','c','d','e'].map((n,j)=>issue(n,j===0?[4,4,4,4]:[3,3,3,3]))));(['T','M','P'] as const).forEach((k,n)=>{if(!(bits&(1<<n)))delete f.signals![k];});let r=draftIssuePriority(f);for(const row of r.rows){close(Object.values(row.weights).reduce((a,b)=>a+b,0),1);if(row.tier==='HIGH')assert.equal(row.weights.M,0);assert.ok(row.score>=0&&row.score<=100);}}
});
test('freshness six-hour half-life and revalidation does not reset materialChangeAt',()=>{let f=fixture();f.issues[0].materialChangeAt=at(-6);let before=draftIssuePriority(f).rows[0];close(before.components.F,.5);f.issues[0].lastVerifiedAt=at(0);assert.equal(draftIssuePriority(f).rows[0].score,before.score);});
test('Story is deduped after deterministic sort, signal population before dedup is explicit',()=>{let f=signals(fixture(['a','b','c','d','e'].map(n=>issue(n,[3,3,3,3]))));f.issues[1].storyId=f.issues[0].storyId;let r=draftIssuePriority(f);assert.ok(r.signals.P.enabled);assert.equal(r.rows.length,4);assert.equal(r.excluded[0].reason,'STORY_DUPLICATE');f.signals!.M!.values=f.signals!.M!.values.slice(1);assert.equal(draftIssuePriority(f).signals.M.reason,'INCOMPLETE');});
test('tie order is stable ID and input permutations are reproducible; no mutation',()=>{let f=fixture([issue('z'),issue('a'),issue('m')]),before=structuredClone(f),r=draftIssuePriority(f);assert.deepEqual(f,before);assert.deepEqual(r.rows.map(r=>r.issueId),['a','m','z']);f.issues.reverse();f.claims.reverse();assert.deepEqual(draftIssuePriority(f),r);});
test('tie comparator uses Unicode code points rather than locale or UTF16 units',()=>{let f=fixture([issue('😀'),issue('\uE000')]);assert.deepEqual(draftIssuePriority(f).rows.map(r=>r.issueId),['\uE000','😀']);});
for(const key of ['T','M','P'] as const)test('mixed signal failure diagnostics invariant under '+key+' input permutations',()=>{
 for(const badKind of ['expired','version'] as const){let f=signals(fixture(['a','b','c','d','e'].map(n=>issue(n,[3,3,3,3]))));f.signals![key]!.values=f.signals![key]!.values.slice(1);if(badKind==='expired')f.signals![key]!.values[0].validUntil=at(0);else f.signals![key]!.values[0].version='other';let r=draftIssuePriority(f);assert.equal(r.signals[key].reason,'INCOMPLETE');f.issues.reverse();f.signals![key]!.values=[...f.signals![key]!.values].reverse();assert.deepEqual(draftIssuePriority(f),r);}
});
test('known-at cutoff and complete invalid latest record cannot be hidden by duplicate IDs',()=>{let f=fixture();f.issues.push({...f.issues[0],version:'v2'});assert.equal(draftIssuePriority(f).status,'INVALID_INPUT');f=fixture();f.claims.push({...f.claims[0],status:'RETRACTED',version:'v2'});assert.equal(draftIssuePriority(f).status,'INVALID_INPUT');});
test('REAL mode and mixed real inputs are rejected even with permission flag',()=>{let f:any=fixture();f.mode='PERMITTED_REAL';f.permissionVerified=true;assert.equal(draftIssuePriority(f).status,'LIVE_NOT_ENABLED');f=fixture();f.claims[0].sampleKind='REAL';assert.equal(draftIssuePriority(f).status,'INVALID_INPUT');});
test('invalid integer grades/non-finite values/enums/ISO dates fail as whole input',()=>{
 for(const change of [(f:any)=>f.issues[0].assessment.magnitude.grade=5.1,(f:any)=>f.issues[0].assessment.magnitude.grade=6,(f:any)=>f.issues[0].assessment.magnitude.grade=NaN,(f:any)=>f.issues[0].impactState='UNKNOWN',(f:any)=>f.cutoff='2026-02-30T03:00:00Z',(f:any)=>f.issues[0].evidenceValidUntil=at(25),(f:any)=>f.policyVersion='other']){let f=fixture();change(f);assert.equal(draftIssuePriority(f).status,'INVALID_INPUT');}
 for(const bad of [NaN,Infinity,-Infinity]){let f=signals(fixture());f.signals!.M!.values[0].value=bad;assert.equal(draftIssuePriority(f).status,'INVALID_INPUT');}
});
