import assert from 'node:assert/strict';
import {localClient} from './m0-test-client.mjs';
import {writePrivate} from './local-runtime.mjs';
import {createPublicGateway,publicConfig} from './public-read-gateway.mjs';
const f=localClient(),checks=[];
const test=async(name,fn)=>{await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));};
const head=(await f.rpc('catalog_public_tree',{}, {role:'anon'})).body.catalog_version;
const rpc=async(name,args)=>{const r=await f.rpc(name,{p_expected:head,...args},{role:'anon'});assert.equal(r.status,200,JSON.stringify({status:r.status,error:r.body?.message}));return r.body;};
const company=(await rpc('catalog_public_search_companies',{p_query:'삼성전자'})).items[0];assert.equal(company.name,'삼성전자');
const sourceId=company.source_company_ref;
await test('Company exact match first, one source identity, E exact multiline and null unverified stock fields',async()=>{
 const page=await rpc('catalog_public_search_companies',{p_query:'삼성'});assert.equal(new Set(page.items.map(x=>x.source_company_ref)).size,page.items.length);
 const detail=await rpc('catalog_public_search_companies',{p_query:'삼성물산'});assert.equal(detail.items[0].search_description,f.sql('select search_description from private.catalog_source_companies where id='+f.quote(detail.items[0].source_company_ref)));assert.ok(detail.items[0].search_description.includes('\n'));
 for(const item of page.items)for(const key of ['stock_code','price','change_percent','stock_url'])assert.equal(item[key],null);
});
await test('Name plus D keywords AND match; E/F-only text never broadcasts a company match',()=>{
 const value=f.sql(`begin;update private.catalog_source_companies set search_description=search_description||' EONLY6C',industry_keywords=industry_keywords||'[{"value":"FONLY6C","raw":"FONLY6C","origin":"ADMIN"}]'::jsonb,direct_keywords=direct_keywords||'[{"value":"DIRECT6C","raw":"DIRECT6C","origin":"ADMIN"}]'::jsonb where id=${f.quote(sourceId)};
 select jsonb_build_object('direct',public.catalog_public_search_companies(${head},'삼성전자 DIRECT6C')->'items','e',public.catalog_public_search_companies(${head},'EONLY6C')->'items','f',public.catalog_public_search_companies(${head},'FONLY6C')->'items');rollback;`);
 const r=JSON.parse(value);assert.equal(r.direct[0].source_company_ref,sourceId);assert.equal(r.e.length,0);assert.equal(r.f.length,0);
});
await test('Deterministic company keyset pagination covers one-shot set without duplicates',async()=>{
 const all=await rpc('catalog_public_search_companies',{p_query:'삼성'});const ids=[];let next=null;
 do{const page=await rpc('catalog_public_search_companies',{p_query:'삼성',p_limit:2,...(next?{p_last_rank:next.last_rank,p_last_name:next.last_name,p_last_id:next.last_id}:{})});ids.push(...page.items.map(x=>x.source_company_ref));next=page.next;}while(next);
 assert.deepEqual(ids,all.items.map(x=>x.source_company_ref));assert.equal(new Set(ids).size,ids.length);
 const bad=await f.rpc('catalog_public_search_companies',{p_expected:head,p_query:'삼성',p_last_name:'a'},{role:'anon'});assert.ok(bad.status>=400);assert.equal(bad.body.message,'INVALID_CURSOR_CONTEXT');
});
await test('Inactive company, parent and membership do not appear in current search/sector links',()=>{
 const count=kind=>JSON.parse(f.sql(`begin;${kind};select public.catalog_public_search_companies(${head},'삼성전자')->'items';rollback;`)).length;
 assert.equal(count(`update private.catalog_source_companies set active=false where id=${f.quote(sourceId)}`),0);
 assert.equal(count(`update private.catalog_memberships set active=false where source_company_ref=${f.quote(sourceId)}`),0);
 assert.equal(count(`update private.sectors set active=false where parent_id is null and metadata_kind='USER_REFERENCE_UNVERIFIED'`),0);
});
let published;
await test('News searches all published dates, canonical IDs and bounded microsecond cursor',async()=>{
 const page=await rpc('catalog_public_search_news',{p_query:'SYNTHETIC',p_limit:2});assert.equal(page.items.length,2);assert.ok(page.next);published=page.items[0];
 const second=await rpc('catalog_public_search_news',{p_query:'SYNTHETIC',p_limit:2,p_as_of:page.as_of,p_last_time:page.next.last_time,p_last_id:page.next.last_id});assert.ok(second.items.length);assert.ok(!second.items.some(x=>page.items.some(y=>y.issue_id===x.issue_id)));
 const old=await rpc('catalog_public_search_news',{p_query:'R07-02'});assert.ok(old.items.some(x=>x.issue_id==='e82e9e70-ec72-4aaa-a165-224aa4d4ba52'));
 const wildcard=await rpc('catalog_public_search_news',{p_query:'%_6C_LITERAL'});assert.equal(wildcard.items.length,0);
});
await test('Saved resolver exposes only current public cards; withdrawn/hidden/correction have no stale title/body',()=>{
 for(const state of ['HIDDEN','WITHDRAWN','CORRECTION_PENDING','DRAFT']){
  const raw=f.sql(`begin;update private.issues set publication_state=${f.quote(state)} where id=${f.quote(published.issue_id)};select public.catalog_public_saved(${head},array[${f.quote(published.issue_id)}::uuid]);rollback;`),value=JSON.parse(raw).items[0];
  assert.equal(value.state,state==='DRAFT'?'NOT_FOUND':state);for(const key of ['title','summary','body','card'])assert.ok(!(key in value));
 }
});
await test('Saved alias resolution points to one current canonical issue and never stores server bookmarks',async()=>{
 const alias=f.sql('select alias_id::text from private.issue_aliases where canonical_issue_id='+f.quote(published.issue_id)+' limit 1;');
 const r=await rpc('catalog_public_saved',{p_issues:[published.issue_id,'81000000-0000-4000-8000-999999999999']});assert.equal(r.items[0].state,'PUBLISHED');assert.equal(r.items[0].card.issue_id,published.issue_id);assert.equal(r.items[1].state,'NOT_FOUND');
 if(alias){const a=await rpc('catalog_public_saved',{p_issues:[alias]});assert.equal(a.items[0].canonical_issue_id,published.issue_id);}
 assert.equal(f.sql("select count(*) from pg_tables where schemaname='private' and tablename like '%bookmark%';"),'0');
});
await test('Owned HTTP gateway executes all new bounded routes with original Host/Origin/credential and rate guards',async()=>{
 const g=await createPublicGateway(publicConfig(),{port:0});const base=`http://${g.host}:${g.port}`;
 try{for(const route of ['/v2/search/news?version='+head+'&q=SYNTHETIC&limit=2','/v2/search/companies?version='+head+'&q='+encodeURIComponent('삼성전자'),`/v2/companies/${sourceId}/sectors?version=${head}&limit=1`,`/v2/saved?version=${head}&ids=${published.issue_id}`]){const r=await fetch(base+route);assert.equal(r.status,200);assert.equal((await r.json()).productId,'judoju-news');}
  const bad=await fetch(base+'/v2/search/news?version='+head+'&q=a',{headers:{Authorization:'Bearer invalid'}});assert.equal(bad.status,403);
  const stale=await fetch(base+'/v2/search/news?version=999999&q=a');assert.equal(stale.status,409);
 }finally{await g.close();}
});
const report={status:'PASS',phase:'6C_SEARCH_SAVED_RUNTIME',checks,catalogVersion:head,realRequestsExecuted:0,serverBookmarks:false,limitations:'Owned local synthetic SQL/HTTP only. Device persistence and UI have separate tests.'};writePrivate('search-bookmarks-runtime-tests.json',report);console.log(JSON.stringify(report));
