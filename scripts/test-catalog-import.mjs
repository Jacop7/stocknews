import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {localClient} from './m0-test-client.mjs';
import {root,writePrivate,command} from './local-runtime.mjs';
import {parseCatalog,cellHash} from './catalog/parse-catalog.mjs';
const f=localClient(),checks=[];
const source=readFileSync(path.join(root,'tests/fixtures/catalog/source-20261114.json'));
const registry=JSON.parse(readFileSync(path.join(root,'tests/fixtures/catalog/registry-v1.json')));
const preview=parseCatalog(JSON.parse(source),registry,{sourceSha256:cellHash(source)});
const imported=JSON.parse(f.sql("select jsonb_build_object('version',initial_version,'source_sha256',source_sha256,'registry_sha256',registry_sha256,'preview_sha256',preview_sha256) from private.catalog_raw_imports;"));
const snapshot=JSON.parse(f.sql('select document from private.catalog_snapshots where version='+Number(imported.version)+';'));
async function test(name,fn){await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));}
await test('Initial snapshot preserves 11 parents,56 categories,339 source companies,81 groups,364 membership contexts',()=>{
 assert.equal(snapshot.sectors.filter(x=>x.catalog_kind==='PARENT').length,11);
 assert.equal(snapshot.sectors.filter(x=>x.catalog_kind==='LEAF').length,56);
 assert.equal(snapshot.companies.length,339);assert.equal(snapshot.subgroups.length,81);assert.equal(snapshot.memberships.length,364);
 for(const c of preview.categories){const s=snapshot.sectors.find(s=>s.id===c.id);assert.equal(s.name,c.name);assert.equal(s.description,c.detailDescription??'');assert.equal(s.parent_id,c.parentId);}
 for(const c of preview.companies){const saved=snapshot.companies.find(x=>x.id===c.sourceCompanyRef);assert.equal(saved.name,c.name);assert.equal(saved.search_description,c.searchDescription??'');assert.deepEqual(saved.direct_keywords,c.directSearchKeywords.entries);assert.deepEqual(saved.industry_keywords,c.industrySearchKeywords.entries);assert.equal(saved.stock_identity_state,'UNRESOLVED');}
 const key=x=>JSON.stringify([x.sector_id,x.subgroup_id,x.source_company_ref,x.role]);
 assert.deepEqual(snapshot.memberships.map(key).sort(),preview.categories.flatMap(c=>c.memberships.map(m=>key({sector_id:c.id,subgroup_id:m.subgroupId,source_company_ref:m.sourceCompanyRef,role:m.role}))).sort());
});
await test('All raw texts retain exact reviewed hashes; foreign metadata and source order survive privately',()=>{
 const raw=JSON.parse(f.sql('select jsonb_build_object(\'source\',source_text,\'registry\',registry_text,\'preview\',preview_text) from private.catalog_raw_imports;'));
 assert.equal(cellHash(raw.source),cellHash(source));assert.equal(cellHash(raw.registry),imported.registry_sha256);assert.equal(cellHash(raw.preview),imported.preview_sha256);
 for(const c of preview.categories){const saved=snapshot.sector_data.find(x=>x.sector_id===c.id);assert.deepEqual(saved.foreign_companies,c.foreignCompanies);assert.deepEqual(saved.keywords,c.keywords);assert.equal(saved.search_mapping,c.categorySearchMapping);assert.equal(saved.search_suffix_instruction,c.categorySearchSuffixInstruction);}
 assert.equal(cellHash(readFileSync(path.join(root,'tests/fixtures/catalog/source-20261114.json'))),cellHash(source));
});
await test('339 unresolved identities and both structural holds remain; lower-only roles are never fabricated',()=>{
 const holds=JSON.parse(f.sql('select jsonb_agg(details order by source_cell,code) from private.catalog_holds;'));
 assert.equal(holds.length,341);assert.equal(holds.filter(x=>x.code==='STOCK_IDENTITY_UNVERIFIED').length,339);
 assert.deepEqual(holds.filter(x=>x.code==='LOWER_UPPER_MEMBERSHIP_DIFFERENCE').map(x=>[x.cell,x.company]),[['B333','현대건설'],['B360','HB테크놀러지']]);
 assert.equal(f.sql('select count(*) from private.catalog_source_companies where stock_code is not null or market is not null;'),'0');
 for(const hold of holds.filter(x=>x.code==='LOWER_UPPER_MEMBERSHIP_DIFFERENCE')){
  const company=preview.companies.find(c=>c.name===hold.company);assert.ok(!snapshot.memberships.some(m=>m.sector_id===hold.categoryId&&m.source_company_ref===company.sourceCompanyRef));
 }
});
await test('Reference metadata is not labelled synthetic or permitted-real article mode',()=>{
 const grades=JSON.parse(f.sql("select jsonb_build_object('reference_count',count(*),'bad_sample_count',count(*) filter(where sample_kind is not null)) from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED';"));
 assert.equal(grades.reference_count,67);assert.equal(grades.bad_sample_count,0);
 assert.ok(snapshot.sectors.every(x=>x.metadata_kind==='USER_REFERENCE_UNVERIFIED'));
});
await test('Private raw import/source-company tables are not readable by anon',()=>{
 f.sql(`begin;set local role anon;do $$begin
   begin perform 1 from private.catalog_raw_imports;raise exception 'EXPECTED_PERMISSION_REJECTION';exception when insufficient_privilege then null;end;
   begin perform 1 from private.catalog_source_companies;raise exception 'EXPECTED_PERMISSION_REJECTION';exception when insufficient_privilege then null;end;
 end$$;rollback;`);
});
await test('Tampered initial registration is rejected without a new catalog version',()=>{
 const before=f.sql('select version from private.catalog_head;');
 f.sql(`do $$begin begin perform private.catalog_seed_reference('{}','{}','{}');raise exception 'EXPECTED_HASH_REJECTION';exception when raise_exception then if sqlerrm<>'UNREVIEWED_CATALOG_INPUT' then raise;end if;end;end$$;`);
 assert.equal(f.sql('select version from private.catalog_head;'),before);
});
await test('Repeated exact registration is idempotent and keeps existing R07 first publication/version readable',async()=>{
 const issue='e82e9e70-ec72-4aaa-a165-224aa4d4ba52',before=await f.rpc('m1_public_article',{p_issue:issue},{role:'anon'}),head=f.sql('select version from private.catalog_head;');
 assert.equal(before.status,200);assert.equal(before.body.state,'PUBLISHED');assert.equal(before.body.body.impact_profile,'POSITIVE_NEGATIVE');
 const run=command(process.execPath,['scripts/catalog/seed-reference-local.mjs'],{timeout:30000});assert.equal(run.code,0,run.stderr);assert.equal(JSON.parse(run.stdout).status,'ALREADY_APPLIED');
 const after=await f.rpc('m1_public_article',{p_issue:issue},{role:'anon'});assert.deepEqual(after.body,before.body);assert.equal(f.sql('select version from private.catalog_head;'),head);
 const legacy=await f.rpc('m1_public_catalog',{}, {role:'anon'});assert.equal(legacy.status,200);assert.equal(legacy.body.length,3);assert.ok(legacy.body.every(x=>x.id.startsWith('51000000-')));
});
const result={status:'PASS',phase:'6B_EXACT_REFERENCE_IMPORT',checks,initialVersion:imported.version,sourceCompanyRecords:339,stockIdentitiesVerified:0,structuralHolds:2,sourceSheetWrites:0,remote:false,limitations:'Initial reference snapshot and legacy read preserved; CRUD/public v2/frontend/complete6B/native review not yet covered.'};
writePrivate('catalog-import-tests.json',result);console.log(JSON.stringify(result));
