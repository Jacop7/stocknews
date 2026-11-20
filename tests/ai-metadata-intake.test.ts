import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PIPELINE_CONTRACT,PipelineError,pipelineCanonical,type PipelineSourceRevision} from '../packages/contracts/src/pipeline.ts';
import {METADATA_SCHEMA,prepareMetadataRequest,acceptMetadataProposal,type MetadataContext,type MetadataProposal} from '../workers/ai-processing/src/metadata-intake.ts';
const now='2026-11-17T00:00:00.000Z',later='2026-11-18T00:00:00.000Z',earlier='2026-11-16T23:00:00.000Z';
const hash=(v:unknown)=>createHash('sha256').update(pipelineCanonical(v)).digest('hex');
function ctx():MetadataContext {
  const versions={contractVersion:PIPELINE_CONTRACT,sampleKind:'SYNTHETIC' as const,policyVersion:'policy-v1',catalogVersion:'catalog-v1',sourcePolicyVersion:'source-v1'};
  const r:PipelineSourceRevision={...versions,sourceDocumentId:'doc',revisionId:'rev',sourceId:'media',endpointId:'list',publisherId:'publisher',nativeId:'article',originId:'origin',independenceGroupId:'group',canonicalUrl:'https://news.invalid/article',collectedAt:now,publishedAt:earlier,updatedAt:null,timeQuality:'KNOWN',contentHash:hash('fixture'),title:'SYNTHETIC 미국 전력망 투자 정책 발표',lead:'국내 전력 장비 수요에 미치는 영향은 공식 자료 확인이 필요하다.',bodyRef:'fixture:/secret-body',permissionVersion:'permission-v1'};
  return {versions,revisions:[r],revisionId:'rev',asOf:now,sectorIds:['kr-power','kr-semiconductor'],eligibility:{revisionId:'rev',permissionVersion:'permission-v1',sourcePolicyVersion:'source-v1',analysisAllowed:true,expiresAt:later},promptVersion:'prompt-v1',generatorVersion:'model-fixture-v1'};
}
function prop(c=ctx()):MetadataProposal {const p=prepareMetadataRequest(c);assert.equal(p.state,'READY_FOR_METADATA_MODEL');if(p.state!=='READY_FOR_METADATA_MODEL')throw Error('fixture');return {requestDigest:p.requestDigest,classification:'RELEVANT_EVENT',newCatalyst:'YES',koreanImpact:'SECTOR',sectorIds:['kr-power'],confidence:'CLEAR',reasonSpans:[{field:'title',start:0,end:c.revisions[0].title.length,quote:c.revisions[0].title}]};}
const bad=(e:unknown)=>e instanceof PipelineError;
test('ready metadata has real canonical SHA and only title/lead source payload, deterministic and detached',()=>{
  const c=ctx(),before=structuredClone(c),a=prepareMetadataRequest(c),b=prepareMetadataRequest(c);assert.deepEqual(a,b);assert.deepEqual(c,before);assert.equal(a.state,'READY_FOR_METADATA_MODEL');if(a.state!=='READY_FOR_METADATA_MODEL')return;
  assert.equal(a.requestDigest,hash(a.request));assert.deepEqual(Object.keys(a.request.source).sort(),['sourceDocumentId','revisionId','contentHash','title','lead'].sort());assert.ok(!JSON.stringify(a).includes('secret-body'));
  a.request.source.title='changed';assert.deepEqual(c,before);assert.deepEqual(prepareMetadataRequest(c),b);
});
for(const classification of ['PURE_PROMOTION','PRICE_RECAP_ONLY','UNRELATED'] as const)test(classification+' is metadata-only exclusion, never K1 decision',()=>{
  const c=ctx(),p={...prop(c),classification,newCatalyst:'NO' as const,koreanImpact:'NONE' as const,sectorIds:[]};const r=acceptMetadataProposal(c,p);assert.equal(r.disposition,'PASS');assert.equal(r.reason,'METADATA_EXCLUSION_ONLY');assert.equal(r.schema,METADATA_SCHEMA);assert.equal(r.deadlineAt,null);assert.deepEqual(r.wakeOn,[]);assert.ok(!('decisionId'in r));
});
test('promotional format with a new policy/catalyst cannot silently drop the issue',()=>{const c=ctx(),p=prop(c);p.classification='PURE_PROMOTION';assert.equal(acceptMetadataProposal(c,p).disposition,'HOLD');});
test('market-wide or sector-specific catalyst only requests evidence, including possible damage',()=>{
  const c=ctx();for(const sectors of [[],['kr-power']]){const p={...prop(c),koreanImpact:'MARKET_WIDE' as const,sectorIds:sectors};assert.equal(acceptMetadataProposal(c,p).disposition,'REQUEST_EVIDENCE');}
  c.revisions[0].title='SYNTHETIC 해외 정책으로 국내 전력 장비 수요 위축 우려';const r=acceptMetadataProposal(c,prop(c));assert.equal(r.disposition,'REQUEST_EVIDENCE');assert.equal(r.reason,'KOREAN_IMPACT_NEEDS_EVIDENCE');assert.ok(!('evidence'in r));assert.ok(!('body'in r));
});
test('all ambiguous or contradictory relevance proposals hold for bounded review',()=>{
  const c=ctx();for(const patch of [{confidence:'UNCLEAR'},{newCatalyst:'UNKNOWN'},{newCatalyst:'NO'},{koreanImpact:'NONE'},{koreanImpact:'UNCLEAR'},{sectorIds:[]},{classification:'UNCLEAR'},{classification:'UNRELATED'}]){
    const r=acceptMetadataProposal(c,{...prop(c),...patch});assert.equal(r.disposition,'HOLD');assert.equal(r.deadlineAt,later);assert.deepEqual(r.wakeOn,['METADATA_REVIEW']);}
});
test('stale digest binds title, policy, catalog, permission, prompt, model and evaluation time',()=>{
  for(const mutate of [(c:MetadataContext)=>{c.revisions[0].title+=' revised';},(c:MetadataContext)=>{c.versions.policyVersion='p2';c.revisions[0].policyVersion='p2';},(c:MetadataContext)=>{c.versions.catalogVersion='c2';c.revisions[0].catalogVersion='c2';},(c:MetadataContext)=>{c.eligibility.expiresAt='2026-11-18T01:00:00.000Z';},(c:MetadataContext)=>{c.promptVersion='p2';},(c:MetadataContext)=>{c.generatorVersion='m2';},(c:MetadataContext)=>{c.asOf='2026-11-17T00:01:00.000Z';}]){const c=ctx(),p=prop(c);mutate(c);assert.equal(acceptMetadataProposal(c,p).reason,'REQUEST_MISMATCH');}
});
test('unknown/duplicate sectors and absent/extra keys fail closed',()=>{
  const c=ctx(),p=prop(c);for(const patch of [{sectorIds:['outside']},{sectorIds:['kr-power','kr-power']},{extra:'injection'},{requestDigest:'not-hash'},{classification:'PUBLISH'},{reasonSpans:[]}])assert.equal(acceptMetadataProposal(c,{...p,...patch}).reason,'MALFORMED_PROPOSAL');
  const missing:any={...p};delete missing.newCatalyst;assert.equal(acceptMetadataProposal(c,missing).reason,'MALFORMED_PROPOSAL');
});
test('exact UTF16 slices reject hallucination, wrong offset, surrogate splitting and duplicates',()=>{
  const c=ctx();c.revisions[0].title='😀 abc abc';const p=prop(c),s=p.reasonSpans[0];
  for(const span of [{...s,quote:'invented'},{...s,start:-1},{...s,start:0.5},{...s,end:999},{...s,start:2,end:5,quote:'abc'},{...s,start:0,end:1,quote:'\ud83d'},{...s,start:1,end:2,quote:'\ude00'},{...s,field:'body'}])assert.equal(acceptMetadataProposal(c,{...p,reasonSpans:[span]}).reason,'MALFORMED_PROPOSAL');
  assert.equal(acceptMetadataProposal(c,{...p,reasonSpans:[s,s]}).reason,'MALFORMED_PROPOSAL');
  assert.equal(acceptMetadataProposal(c,{...p,reasonSpans:[{field:'title',start:7,end:10,quote:'abc'}]}).disposition,'REQUEST_EVIDENCE');
});
test('empty lead has no valid citation, while title can still support an evidence request',()=>{const c=ctx();c.revisions[0].lead='';const p=prop(c);assert.equal(acceptMetadataProposal(c,p).disposition,'REQUEST_EVIDENCE');assert.equal(acceptMetadataProposal(c,{...p,reasonSpans:[{field:'lead',start:0,end:1,quote:'x'}]}).disposition,'HOLD');});
test('permission denied, exact expiry and bindings fail before proposals are read',()=>{
  for(const patch of [{analysisAllowed:false},{expiresAt:now},{expiresAt:earlier},{revisionId:'wrong'},{permissionVersion:'wrong'},{sourcePolicyVersion:'wrong'}]){const c=ctx();Object.assign(c.eligibility,patch);let touched=false;const p=Object.defineProperty({},'requestDigest',{get(){touched=true;throw Error('not read');}});const r=acceptMetadataProposal(c,p);assert.equal(r.reason,'ANALYSIS_NOT_ELIGIBLE');assert.deepEqual(r.wakeOn,['POLICY_OR_PERMISSION']);assert.equal(touched,false);}
});
test('absent, future arrival and obsolete sources hold; new current source changes acceptance',()=>{
  const c=ctx(),p=prop(c);c.revisionId='absent';assert.equal(acceptMetadataProposal(c,p).reason,'CURRENT_SOURCE_REQUIRED');
  const f=ctx();f.revisions[0].collectedAt=later;assert.equal(acceptMetadataProposal(f,p).reason,'CURRENT_SOURCE_REQUIRED');
  const old=ctx(),r={...old.revisions[0],revisionId:'new',updatedAt:now,title:'SYNTHETIC updated'};old.revisions.push(r);assert.equal(acceptMetadataProposal(old,p).reason,'CURRENT_SOURCE_REQUIRED');
});
test('missing time, conflicts and representative tie remain fail-closed K1 semantics',()=>{
  const c=ctx();c.revisions[0].publishedAt=null;c.revisions[0].timeQuality='PENDING_TIME';const a=prepareMetadataRequest(c);assert.equal(a.state,'HOLD');if(a.state==='HOLD')assert.equal(a.result.reason,'SOURCE_TIME_REQUIRED');
  const d=ctx();d.revisions.push({...d.revisions[0],revisionId:'other',title:'SYNTHETIC conflict'});const b=prepareMetadataRequest(d);assert.equal(b.state,'HOLD');if(b.state==='HOLD')assert.equal(b.result.reason,'SOURCE_CONFLICT');
  const e=ctx(),p=prop(e);e.revisions.push({...e.revisions[0],revisionId:'aaa'});assert.equal(acceptMetadataProposal(e,p).reason,'CURRENT_SOURCE_REQUIRED');
});
test('invalid trusted context rejects getters, extra fields, oversize, wrong versions and LIVE',()=>{
  const c=ctx();let called=false;const getter=Object.defineProperty({...c},'asOf',{get(){called=true;return now;},enumerable:true});assert.throws(()=>prepareMetadataRequest(getter),bad);assert.equal(called,false);
  for(const x of [{...c,extra:1},{...c,sectorIds:[]},{...c,sectorIds:Array(101).fill('a')},{...c,asOf:'2026-11-17'},{...c,versions:{...c.versions,sampleKind:'LIVE'}},{...c,revisions:[{...c.revisions[0],lead:'x'.repeat(4001)}]},{...c,revisions:[{...c.revisions[0],policyVersion:'wrong'}]},{...c,asOf:'9999-12-31T23:59:59.000Z'}])assert.throws(()=>prepareMetadataRequest(x));
});
test('untrusted getters/cycles/nonfinite/oversize cannot escape as raw error or mutate input',()=>{
  const c=ctx(),p=prop(c),before=structuredClone(c);let calls=0;const getter=Object.defineProperty({...p},'requestDigest',{get(){calls++;throw Error('unsafe');},enumerable:true});const cycle:any={};cycle.x=cycle;
  const hostile=new Proxy({},{getPrototypeOf(){throw Error('untrusted private detail');}});
  for(const value of [getter,cycle,hostile,null,Infinity,'x'.repeat(65537),{...p,reasonSpans:Array(9).fill(p.reasonSpans[0])}])assert.equal(acceptMetadataProposal(c,value).reason,'MALFORMED_PROPOSAL');assert.equal(calls,0);assert.deepEqual(c,before);
});
