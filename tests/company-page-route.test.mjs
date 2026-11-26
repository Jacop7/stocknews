import test from 'node:test';
import assert from 'node:assert/strict';
import {readRoute} from '../scripts/public-read-gateway.mjs';
import {searchResponse} from '../scripts/catalog/search-route.mjs';
const company='c5bad818-3671-4bb3-a1ab-6a5d28a5d671',issue='cf6ac51b-4eea-48f1-b305-a90b1f86711c';
const card=(role='PRIMARY',kind='COMPANY')=>({issue_id:issue,version_id:issue,title:'t',summary:'s',first_published_at:'2026-11-14T21:38:16.335272+00:00',material_change_at:'2026-11-14T21:38:16.335272+00:00',sample_kind:'SYNTHETIC',article_kind:kind,sector_id:null,sector_name:null,legacy_sector:false,company_role:role});
const body=(items=[card()],next=null)=>({catalog_version:'54',state:'AVAILABLE',as_of:'2026-11-27T00:00:00.123456+00:00',
 company:{source_company_ref:company,name:'HD현대중공업',search_description:'대형선 건조',metadata_kind:'USER_REFERENCE_UNVERIFIED',stock_identity_state:'UNRESOLVED',stock_code:null,price:null,change_percent:null,stock_url:null,related_sectors:[],has_more_sectors:false},items,next});

test('company page route binds version, company and limit, and its cursor cannot move to another company',()=>{
 const route=readRoute(`/v2/companies/${company}?version=54&limit=1`);
 assert.equal(route.name,'catalog_public_company');assert.equal(route.args.p_company,company);assert.equal(route.args.p_limit,1);
 const result=searchResponse(route,body([card()],{last_time:'2026-11-14T21:38:16.335272+00:00',last_id:issue}));
 assert.ok(result.next_cursor);assert.ok(!('next' in result));
 const path=`/v2/companies/${company}?version=54&limit=1&cursor=${result.next_cursor}`;
 const next=readRoute(path);assert.equal(next.args.p_last_id,issue);assert.equal(next.args.p_as_of,'2026-11-27T00:00:00.123456+00:00');
 for(const altered of [path.replace(company,issue),path.replace('version=54','version=55'),path.replace('limit=1','limit=2')])assert.throws(()=>readRoute(altered),/INVALID_CURSOR_CONTEXT/);
 for(const bad of [`/v2/companies/${company}`,`/v2/companies/${company}?version=54&q=x`,`/v2/companies/${company}?version=54&limit=21`,`/v2/companies/not-a-uuid?version=54`])assert.throws(()=>readRoute(bad));
 assert.equal(readRoute(`/v2/companies/${company}/sectors?version=54`).name,'catalog_public_company_sectors');
});

test('company page response keeps unverified stock fields null and only known roles and scopes',()=>{
 const route=readRoute(`/v2/companies/${company}?version=54`);
 assert.equal(searchResponse(route,body([card('MENTIONED','SECTOR')])).items[0].company_role,'MENTIONED');
 assert.deepEqual(searchResponse(route,{catalog_version:'54',state:'NOT_FOUND'}),{catalog_version:'54',state:'NOT_FOUND'});
 const priced=body();priced.company.price=1000;
 for(const value of [priced,body([card('OWNER')]),body([{...card(),sample_kind:'PERMITTED_REAL'}]),{...body(),catalog_version:'53'},{...body(),company:{...body().company,source_company_ref:issue}},
  {catalog_version:'54',state:'NOT_FOUND',company:body().company}])assert.throws(()=>searchResponse(route,value),/INVALID_SEARCH_DTO/);
});
