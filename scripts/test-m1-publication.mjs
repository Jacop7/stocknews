import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { m1FixtureClient,fixtureContent,fixtureSectors } from './m1-fixtures.mjs';
import { writePrivate } from './local-runtime.mjs';
import { logout } from '../apps/admin/lib/runtime.mjs';
const f=await m1FixtureClient(),run=randomUUID(),cases=[],published=[];
async function test(name,fn){await fn();cases.push({name,status:'PASS'});console.log(JSON.stringify(cases.at(-1)));}
const save=(d,c)=>f.editor('m1_save_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:c});
const args=d=>({p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_policy:d.policy_version,p_catalog:d.catalog_version,p_effect_key:run+':'+d.issue_id});
const reload=d=>f.editor('m1_get_draft',{p_issue:d.issue_id});
let failure;
try{
await test('R07: eight evidence-path profiles use the same preview/published DTO',async()=>{
 for(const kind of ['POSITIVE','BOTH','DAMAGE','RELATED','NO_POSITIVE','CONDITIONAL_NEGATIVE','CONDITIONAL_POSITIVE','CONDITIONAL_BOTH']){
  let d=await f.create();const c=fixtureContent(d,{kind,title:'SYNTHETIC '+kind});await save(d,c);d=await reload(d);
  const preview=await f.editor('m1_preview_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_policy:d.policy_version,p_catalog:d.catalog_version});
  const a=args(d),r=await f.editor('m1_publish_draft',a);assert.equal(r.status,'APPLIED');published.push(d.issue_id);
  const pub=await f.rpc('get_public_article',{p_issue:d.issue_id},{role:'anon'});assert.equal(pub.status,200,pub.body?.message);assert.deepEqual(pub.body.body,preview.body);
  assert.equal(Object.hasOwn(pub.body.body,'scenarios'),['POSITIVE','BOTH','CONDITIONAL_POSITIVE','CONDITIONAL_BOTH'].includes(kind));
  assert.equal(pub.body.body.analysis_perspective,'KR_EQUITY');assert.ok(!JSON.stringify(pub.body).includes('evidence_ids'));
  assert.equal((await f.editor('m1_publish_draft',a)).status,'ALREADY_APPLIED');
  await assert.rejects(f.editor('m1_publish_draft',{...a,p_catalog:999}),/EFFECT_PAYLOAD_CONFLICT/);
 }
});
await test('R08: verified exact/period only; expired/cancelled/unverified/superseded omitted',async()=>{
 let d=await f.create();const evidence={evidence_ids:[d.claim_id],evidence_as_of:new Date(Date.now()-1000).toISOString(),timezone:'Asia/Seoul'};
 const exact={...evidence,kind:'EXACT',status:'VERIFIED',title:'합성 미래 일정',event_at:'2099-01-01T00:00:00Z'};
 const schedule=[exact,{...exact,title:'지난 일정',event_at:'2000-01-01T00:00:00Z'},{...evidence,kind:'PERIOD',status:'VERIFIED',title:'합성 예정 기간',period_start:'2099-01-01T00:00:00Z',period_end:'2099-04-01T00:00:00Z',period_label:'2099년 1분기',precision:'QUARTER'},...['CANCELLED','UNVERIFIED','SUPERSEDED'].map(status=>({...exact,status,title:status}))];
 await save(d,fixtureContent(d,{schedule}));d=await reload(d);const p=await f.editor('m1_preview_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_policy:d.policy_version,p_catalog:d.catalog_version});
 assert.equal(p.body.schedule.length,2);assert.equal(p.body.schedule[1].period_label,'2099년 1분기');assert.equal(p.body.schedule[1].date_note,'정확한 날짜 미정');assert.ok(!Object.hasOwn(p.body.schedule[1],'event_at'));assert.ok(!Object.hasOwn(p.body.schedule[1],'period_start'));
 await f.editor('m1_publish_draft',args(d));const pub=await f.rpc('get_public_article',{p_issue:d.issue_id},{role:'anon'});assert.deepEqual(pub.body.body,p.body);
});
await test('CAS, active sector, invalid evidence, reservation and invented scenario fail closed',async()=>{
 let d=await f.create(),c=fixtureContent(d);
 await assert.rejects(save(d,{title:'malformed draft'}),/DRAFT_SHAPE_INVALID/);assert.equal((await reload(d)).draft_revision,0);
 await assert.rejects(save({...d,draft_revision:null},c),/REVISION_CONFLICT/);
 await assert.rejects(save(d,{...c,scheduled_publish_at:'2099-01-01T00:00:00Z'}),/INVALID_DRAFT_OR_RESERVATION/);
 await save(d,c);await assert.rejects(save(d,c),/REVISION_CONFLICT/);d=await reload(d);
 const preview=()=>f.editor('m1_preview_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_policy:d.policy_version,p_catalog:d.catalog_version});
 await save(d,{...c,impacts:[{...c.impacts[0],evidence_ids:[randomUUID()]}]});d=await reload(d);await assert.rejects(preview(),/PATH_EVIDENCE_NOT_VERIFIED/);
 c=fixtureContent(d,{kind:'CONDITIONAL_NEGATIVE'});c.scenarios=fixtureContent(d).scenarios;await save(d,c);d=await reload(d);await assert.rejects(preview(),/NO_POSITIVE_PATH_NO_SCENARIOS/);
 c=fixtureContent(d);await save(d,c);d=await reload(d);
 f.sql('update private.sectors set active=false where id='+f.quote(fixtureSectors[0].id)+';');try{await assert.rejects(preview(),/PRIMARY_SECTOR_INACTIVE/);}finally{f.sql('update private.sectors set active=true where id='+f.quote(fixtureSectors[0].id)+';');}
});
await test('Different verified paths in the same sector are preserved without triple listing',async()=>{
 let d=await f.create(),c=fixtureContent(d);c.impacts.push({...c.impacts[0],path_id:'another_path'});c.scenarios[0].path_ids.push('another_path');
 await save(d,c);d=await reload(d);await f.editor('m1_publish_draft',args(d));
 const pub=await f.rpc('get_public_article',{p_issue:d.issue_id},{role:'anon'});assert.equal(pub.body.body.impacts.length,2);
});
await test('Edit preserves first publication; hidden body disappears immediately, outbox created',async()=>{
 let d=await f.create();await save(d,fixtureContent(d));d=await reload(d);await f.editor('m1_publish_draft',args(d));let before=(await f.rpc('get_public_article',{p_issue:d.issue_id},{role:'anon'})).body;
 d=await reload(d);await save(d,fixtureContent(d,{title:'SYNTHETIC 수정본'}));d=await reload(d);await f.editor('m1_publish_draft',{...args(d),p_effect_key:run+':edit:'+d.issue_id});
 const edited=(await f.rpc('get_public_article',{p_issue:d.issue_id},{role:'anon'})).body;assert.equal(edited.title,'SYNTHETIC 수정본');assert.equal(edited.first_published_at,before.first_published_at);assert.notEqual(edited.version_id,before.version_id);
 d=await reload(d);const a={p_issue:d.issue_id,p_expected_revision:d.issue_revision,p_state:'HIDDEN',p_effect_key:run+':hide:'+d.issue_id};await f.editor('m1_set_state',a);assert.equal((await f.editor('m1_set_state',a)).status,'ALREADY_APPLIED');
 const hidden=(await f.rpc('get_public_article',{p_issue:d.issue_id},{role:'anon'})).body;assert.equal(hidden.state,'HIDDEN');assert.ok(!Object.hasOwn(hidden,'body'));
 const list=await f.rpc('m1_public_articles',{}, {role:'anon'});assert.ok(!list.body.some(x=>x.issue_id===d.issue_id));assert.equal(f.sql('select count(*) from private.outbox where issue_id='+f.quote(d.issue_id)+';'),'3');
});
await test('Same draft request cannot duplicate an issue; macro may omit primary with verified Korean paths',async()=>{
 const request=randomUUID(),created=await Promise.all([f.editor('m1_create_draft',{p_request:request}),f.editor('m1_create_draft',{p_request:request})]);assert.equal(created[0].issue_id,created[1].issue_id);
 let d=await f.editor('m1_get_draft',{p_issue:created[0].issue_id}),c={...fixtureContent(d,{kind:'RELATED',title:'SYNTHETIC 매크로 연결 검증'}),article_kind:'MACRO',primary_sector_id:null};
 await save(d,c);d=await reload(d);await f.editor('m1_publish_draft',args(d));
 const pub=await f.rpc('m1_public_article',{p_issue:d.issue_id},{role:'anon'});assert.equal(pub.body.body.article_kind,'MACRO');assert.equal(pub.body.body.analysis_perspective,'KR_EQUITY');assert.ok(!Object.hasOwn(pub.body.body,'scenarios'));
 assert.equal(f.sql('select claim_type from private.claims where issue_id='+f.quote(d.issue_id)+';'),'ORDINARY_FACT');
});
await test('S5I-C01: preview and direct publish preserve sensitive/macro classifications and enforce macro requirements',async()=>{
 for(const type of ['SENSITIVE_UNCONFIRMED','SYSTEMIC_MACRO','ORDINARY_FACT']){
  let d=await f.create(),c=fixtureContent(d,{kind:'RELATED'});if(type==='ORDINARY_FACT')c.article_kind='MACRO';
  await save(d,c);d=await reload(d);f.sql('update private.claims set claim_type='+f.quote(type)+',official_original=false where id='+f.quote(d.claim_id)+';');
  const preview=()=>f.editor('m1_preview_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_policy:d.policy_version,p_catalog:d.catalog_version});
  await assert.rejects(preview(),/CLAIM_NOT_VERIFIED/);await assert.rejects(f.editor('m1_publish_draft',args(d)),/CLAIM_NOT_VERIFIED/);
  assert.equal(f.sql('select claim_type from private.claims where id='+f.quote(d.claim_id)+';'),type);
  assert.equal(f.sql('select count(*) from private.article_versions where issue_id='+f.quote(d.issue_id)+';'),'0');
  if(type==='SENSITIVE_UNCONFIRMED')continue;
  const rows=[1,2,3].map(n=>'('+f.quote(d.claim_id)+','+f.quote(run+':origin:'+n)+','+f.quote(run+':room:'+n)+','+f.quote(run+':owner:'+n)+',true,true,true,true)').join(',');
  f.sql('insert into private.evidence_edges(claim_id,origin_group_id,newsroom_id,owner_group_id,origin_verified,newsroom_verified,owner_group_verified,independent_fact_verified) values '+rows+';');
  await preview();await f.editor('m1_publish_draft',args(d));assert.equal(f.sql('select claim_type from private.claims where id='+f.quote(d.claim_id)+';'),type);
  f.sql('update private.evidence_edges set independent_fact_verified=false where claim_id='+f.quote(d.claim_id)+';');
  for(const endpoint of ['m1_public_article','get_public_article']){const r=await f.rpc(endpoint,{p_issue:d.issue_id},{role:'anon'});assert.equal(r.body.state,'CORRECTION_PENDING');assert.ok(!Object.hasOwn(r.body,'body'));}
  assert.ok(!(await f.rpc('m1_public_articles',{p_limit:50},{role:'anon'})).body.some(x=>x.issue_id===d.issue_id));
  assert.equal((await f.request('news_list?issue_id=eq.'+d.issue_id,{role:'anon'})).body.length,0);
 }
});
await test('S5I-C02: schedule evidence revocation/deletion/ownership rechecked on both public endpoints; core remains visible',async()=>{
 for(const change of ['revoke','delete','move']){
  let d=await f.create(),claim=randomUUID();
  f.sql('insert into private.claims(id,issue_id,claim_type,korea_path_verified,fact_current,official_original,verified,sample_kind) values ('+f.quote(claim)+','+f.quote(d.issue_id)+",'ORDINARY_FACT',true,true,true,true,'SYNTHETIC');");
  const schedule=[{kind:'EXACT',status:'VERIFIED',title:'합성 공식 미래 일정',event_at:'2099-01-01T00:00:00Z',timezone:'Asia/Seoul',evidence_ids:[claim],evidence_as_of:new Date(Date.now()-1000).toISOString()}];
  await save(d,fixtureContent(d,{schedule}));d=await reload(d);await f.editor('m1_publish_draft',args(d));
  assert.equal((await f.rpc('m1_public_article',{p_issue:d.issue_id},{role:'anon'})).body.body.schedule.length,1);
  if(change==='revoke')f.sql('update private.claims set official_original=false where id='+f.quote(claim)+';');
  if(change==='delete')f.sql('delete from private.claims where id='+f.quote(claim)+';');
  if(change==='move'){const other=await f.create();f.sql('update private.claims set issue_id='+f.quote(other.issue_id)+' where id='+f.quote(claim)+';');}
  for(const endpoint of ['m1_public_article','get_public_article']){const r=(await f.rpc(endpoint,{p_issue:d.issue_id},{role:'anon'})).body;assert.equal(r.state,'PUBLISHED');assert.ok(!Object.hasOwn(r.body,'schedule'));assert.ok(!r.body.visible_sections.includes('SCHEDULE'));}
  assert.ok((await f.rpc('m1_public_articles',{p_limit:50},{role:'anon'})).body.some(x=>x.issue_id===d.issue_id));
 }
});
await test('S5I-03: confirmed DATE_RANGE does not claim unknown dates in preview or publication',async()=>{
 let d=await f.create();const schedule=[{kind:'PERIOD',status:'VERIFIED',title:'합성 공식 날짜 범위',period_label:'2099.01.01~01.03',period_start:'2099-01-01T00:00:00Z',period_end:'2099-01-04T00:00:00Z',precision:'DATE_RANGE',timezone:'Asia/Seoul',evidence_ids:[d.claim_id],evidence_as_of:new Date(Date.now()-1000).toISOString()}];
 await save(d,fixtureContent(d,{schedule}));d=await reload(d);const p=await f.editor('m1_preview_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_policy:d.policy_version,p_catalog:d.catalog_version});assert.ok(!Object.hasOwn(p.body.schedule[0],'date_note'));
 await f.editor('m1_publish_draft',args(d));assert.deepEqual((await f.rpc('m1_public_article',{p_issue:d.issue_id},{role:'anon'})).body.body,p.body);
});
}catch(e){failure=e;}finally{await logout(f.capability,f.adminSession);writePrivate('m1-publication-'+run+'.json',{productId:'judoju-news',sample_kind:'SYNTHETIC',status:failure?'FAIL':'PASS',cases,createdAt:new Date().toISOString(),actualSourceRequests:0,nativeObservation:'PENDING'});}
if(failure)throw failure;
