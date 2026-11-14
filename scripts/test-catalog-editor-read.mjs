import assert from 'node:assert/strict';
import {m1FixtureClient,fixtureSectors} from './m1-fixtures.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=await m1FixtureClient(),checks=[];let failure;
async function test(name,fn){await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));}
try{
const tree=await f.editor('catalog_editor_tree',{}),head=tree.catalog_version,sector=fixtureSectors[0].id;
await test('Actual Auth admin gets current-reference editor leaves instead of legacy aliases',async()=>{
 const leaves=await f.editor('catalog_editor_sectors',{});assert.equal(leaves.catalog_version,head);assert.equal(leaves.sectors.length,56);assert.equal(tree.actor_id,f.adminSession.userId);
 assert.ok(leaves.sectors.every(x=>!x.id.startsWith('51000000-')));
});
await test('Selected-sector/company metadata is paginated and does not include raw source rows',async()=>{
 const data=await f.editor('catalog_editor_sector',{p_sector:sector,p_expected:head,p_offset:0,p_limit:1});assert.equal(data.catalog_version,head);assert.equal(data.memberships.length,1);assert.ok(data.total_memberships>=1);assert.ok(!Object.hasOwn(data.keyword_settings,'source_row'));
 const page=await f.editor('catalog_editor_companies',{p_offset:0,p_limit:2,p_query:''});assert.equal(page.items.length,2);assert.equal(page.total,339);
 const company=await f.editor('catalog_editor_company',{p_company:page.items[0].id,p_expected:head});assert.ok(!Object.hasOwn(company.company,'source_row'));assert.equal(company.company.stock_identity_state,'UNRESOLVED');
});
await test('Delete impact preview is deterministic and binds current catalog/entity/revisions',async()=>{
 const a=await f.editor('catalog_editor_impact',{p_sector:sector,p_expected:head}),b=await f.editor('catalog_editor_impact',{p_sector:sector,p_expected:head});
 assert.equal(a.catalog_version,head);assert.match(a.impact_sha256,/^[0-9a-f]{64}$/);assert.equal(a.impact_sha256,b.impact_sha256);assert.equal(a.sector_count,1);assert.ok(a.published_count>0);assert.ok(a.examples.length<=20);
});
await test('Stale editor reads, malformed pagination and anonymous access are rejected',async()=>{
 await assert.rejects(f.editor('catalog_editor_sector',{p_sector:sector,p_expected:999999}),/STALE_CATALOG/);
 await assert.rejects(f.editor('catalog_editor_companies',{p_offset:-1,p_limit:50}),/INVALID_PAGE_SIZE/);
 const denied=await f.rpc('catalog_editor_impact',{p_sector:sector,p_expected:head},{role:'anon'});assert.ok(denied.status>=400);
});
await test('NFC outer trim, invalid keyword shapes and forbidden fields are handled at the SQL boundary',()=>{
 assert.equal(f.sql('select private.catalog_label('+f.quote('\u3000한글'.normalize('NFD')+'\u00a0')+');'),'한글');
 const words=JSON.parse(f.sql('select private.catalog_terms('+f.quote(JSON.stringify(['HBM','한글'.normalize('NFD')]))+'::jsonb);'));assert.equal(words[1].comparisonKey,'한글');assert.equal(words[1].raw,'한글'.normalize('NFD'));
 f.sql(`do $$begin
 begin perform private.catalog_assert_payload('{"stock_code":"000000"}',array['name']);raise exception 'EXPECTED_FIELD_REJECTION';exception when raise_exception then if sqlerrm<>'CATALOG_FIELD_NOT_ALLOWED' then raise;end if;end;
 begin perform private.catalog_terms('{}');raise exception 'EXPECTED_KEYWORD_REJECTION';exception when raise_exception then if sqlerrm<>'INVALID_CATALOG_KEYWORDS' then raise;end if;end;
 end$$;`);
});
}catch(e){failure=e;}finally{
 await logout(f.capability,f.adminSession);
 writePrivate('catalog-editor-read-tests.json',{status:failure?'FAIL':'PASS',phase:'6B_AUTH_EDITOR_READ',checks,realRequestsExecuted:0,limitations:'Read-side Auth and impact preview only; mutation/concurrency/HTTP/frontend/full6B review remain.'});
}
if(failure)throw failure;
