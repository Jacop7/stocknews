import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readRoute} from '../scripts/public-read-gateway.mjs';
import {catalogResponse} from '../scripts/catalog/public-route.mjs';
import {catalogPending,catalogOutcome,catalogArchive,recoveryTarget,recoveryFieldPairs,rebaseCatalogOrder,sameRecoveryScope} from '../apps/admin/lib/catalog-state.mjs';
import {toggleParent,toggleSector,selectionLabels,validSelection,periodRange} from '../apps/mobile/src/data/catalog-filter.mjs';
const sector='11000000-0000-4000-8000-000000000001';
test('v2 composite cursor binds version, period, sector set, limit and preserves microseconds',()=>{
 const route=readRoute('/v2/articles?version=2&limit=1&sectors='+sector),data={catalog_version:'2',as_of:'2026-11-14T14:00:00.123456+00:00',items:[{sample_kind:'SYNTHETIC'}],next:{last_time:'2026-11-14T13:00:00.654321+00:00',last_id:sector}};
 const result=catalogResponse(route,data,'SYNTHETIC'),path='/v2/articles?version=2&limit=1&sectors='+sector+'&cursor='+result.next_cursor;
 const next=readRoute(path);assert.equal(next.args.p_last_time,data.next.last_time);assert.equal(next.args.p_as_of,data.as_of);assert.equal(next.args.p_last_id,sector);
 for(const altered of [path.replace('version=2','version=3'),path.replace('limit=1','limit=2'),path+'&period=YESTERDAY',path.replace('&sectors='+sector,'')])assert.throws(()=>readRoute(altered),/INVALID_CURSOR_CONTEXT/);
 assert.throws(()=>catalogResponse(route,{...data,items:[{sample_kind:'PERMITTED_REAL'}]},'SYNTHETIC'),/SYNTHETIC_DTO_REQUIRED/);
});
test('v1 routes keep timestamp meaning, v2 rejects arbitrary routes, duplicate fields and malformed cursor context',()=>{
 assert.equal(readRoute('/articles?cursor=2026-11-14T13:00:00Z').name,'m1_public_articles');
 for(const path of ['/v2/articles','/v2/articles?version=2&version=2','/v2/articles?version=2&sectors='+sector+','+sector,'/v2/articles?version=2&cursor=garbage','/v2/catalog?rpc=write','/v2/sectors/'+sector+'?offset=-1'])assert.throws(()=>readRoute(path));
 assert.equal(readRoute('/v2/sectors/'+sector+'?offset=50').args.p_offset,50);
});
test('Parent select-all, chips, child toggles and stale selection retain independent choices',()=>{
 const parent={id:'p',name:'AI·반도체',sectors:[{id:'a',name:'HBM'},{id:'b',name:'파운드리'}]},other={id:'q',name:'전력',sectors:[{id:'c',name:'전력'}]},catalog={parents:[parent,other]};
 const chosen=toggleParent(['c'],parent);assert.deepEqual(chosen,['c','a','b']);assert.equal(selectionLabels(chosen,catalog)[0].name,'AI·반도체 전체');
 assert.deepEqual(toggleParent(chosen,parent),['c']);assert.deepEqual(toggleSector(chosen,'a'),['c','b']);assert.deepEqual(validSelection(['a','a','deleted'],catalog),['a']);
 // The popup receives a copy. Cancelling it does not mutate applied selections.
 const applied=['c'];toggleParent(applied,parent);assert.deepEqual(applied,['c']);
});
test('Korean calendar periods handle Monday, year/month boundaries, leap day and single-day labels',()=>{
 const d=new Date('2026-11-15T15:01:00Z');assert.equal(periodRange('TODAY',d),'2026.11.16');assert.equal(periodRange('YESTERDAY',d),'2026.11.15');assert.equal(periodRange('THIS_WEEK',d),'2026.11.16~11.22');assert.equal(periodRange('LAST_WEEK',d),'2026.11.09~11.15');
 assert.equal(periodRange('LAST_MONTH',new Date('2026-01-01T00:00:00Z')),'2025.12.01~12.31');assert.equal(periodRange('THIS_MONTH',new Date('2024-02-01T00:00:00Z')),'2024.02.01~02.29');assert.throws(()=>periodRange('ROLLING_7D'),/INVALID_PERIOD/);
});
test('Pending catalog intent survives transport uncertainty and requires a matching journal and actor',()=>{
 const pending={actor:sector,args:{p_expected:2,p_operation_key:randomUUID(),p_kind:'SECTOR_UPDATE',p_entity:sector,p_payload:{description:'메타데이터'}}};
 assert.deepEqual(catalogPending(JSON.stringify(pending)),pending);assert.equal(catalogOutcome(pending,{status:'UNKNOWN'},sector),'UNCERTAIN');
 const result={status:'REJECTED',actor_id:sector,operation_key:pending.args.p_operation_key,request_sha256:'a'.repeat(64),not_applied:true,error:'STALE_CATALOG'};
 assert.equal(catalogOutcome(pending,result,sector),'DEFINITELY_REJECTED');assert.equal(catalogOutcome(pending,{...result,not_applied:false},sector),'UNCERTAIN');assert.equal(catalogOutcome(pending,result,'other'),'UNCERTAIN');assert.equal(catalogOutcome(pending,{...result,status:'APPLIED',catalog_version:'3'},sector),'APPLIED');
 assert.throws(()=>catalogPending('{'),/PENDING_CATALOG_INVALID/);
});

test('Rejected recovery retains the actor, original target and requested fields independently of current values across reloads',()=>{
 const intent={actor:sector,targetName:'기업 A',args:{p_expected:2,p_operation_key:randomUUID(),p_kind:'COMPANY_UPDATE',p_entity:sector,p_payload:{name:'기업 A',search_description:'내가 편집한 설명',direct_terms:['이전 검색어'],industry_terms:['반도체']}}};
 const latest={name:'기업 A',search_description:'현재 설명',direct_terms:['다른 관리자가 추가한 검색어'],industry_terms:['반도체','HBM']};
 const saved=catalogArchive(JSON.stringify({intent,version:'3',latest}));assert.deepEqual(saved.intent,intent);assert.deepEqual(saved.latest,latest);assert.deepEqual(recoveryTarget(saved.intent),{type:'COMPANY',id:sector});
 const pairs=recoveryFieldPairs(saved.intent,saved.latest);assert.equal(pairs.find(x=>x.field==='search_description').requested,'내가 편집한 설명');assert.deepEqual(pairs.find(x=>x.field==='direct_terms').current,['다른 관리자가 추가한 검색어']);assert.deepEqual(saved.latest,latest);
 for(const [kind,type] of [['GROUP_UPDATE','GROUP'],['MEMBERSHIP_UPDATE','MEMBERSHIP'],['SECTOR_KEYWORDS','SECTOR']])assert.equal(recoveryTarget({...intent,args:{...intent.args,p_kind:kind}}).type,type);
 assert.throws(()=>catalogArchive(JSON.stringify({...saved,version:'0'})),/CATALOG_RECOVERY_INVALID/);assert.throws(()=>catalogPending(JSON.stringify({...intent,recoveryOf:'bad'})),/PENDING_CATALOG_INVALID/);
});
test('Reorder recovery keeps newly added current IDs and omits removed IDs; deactivation digest is never imported',()=>{
 assert.deepEqual(rebaseCatalogOrder(['b','a','removed'],['a','b','new']),['b','a','new']);assert.deepEqual(rebaseCatalogOrder(['b','b'],['a','b']),['b','a']);assert.throws(()=>rebaseCatalogOrder(['b'],['a','a']),/INVALID_RECOVERY_ORDER/);
 const intent={args:{p_kind:'SECTOR_DEACTIVATE',p_entity:sector,p_payload:{impact_sha256:'old'}}};assert.deepEqual(recoveryFieldPairs(intent,{}),[]);
});

test('Recovery replacement is bound to keyword kind and creation/order owner, not just a null entity ID',()=>{
 const intent=(kind,payload)=>({args:{p_kind:kind,p_entity:null,p_payload:payload}});
 assert.equal(sameRecoveryScope(intent('GROUP_CREATE',{sector_id:'A'}),'GROUP_CREATE',null,{sector_id:'B'}),false);
 assert.equal(sameRecoveryScope(intent('MEMBERSHIP_CREATE',{sector_id:'A'}),'MEMBERSHIP_CREATE',null,{sector_id:'A'}),true);
 assert.equal(sameRecoveryScope(intent('SECTOR_KEYWORDS',{keyword_kind:'CORE'}),'SECTOR_KEYWORDS',null,{keyword_kind:'INDUSTRY'}),false);
 assert.equal(sameRecoveryScope(intent('REORDER',{scope:'GROUPS',parent_id:'A'}),'REORDER',null,{scope:'GROUPS',parent_id:'B'}),false);
});
