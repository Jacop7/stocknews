import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localClient} from './m0-test-client.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=localClient(),q=f.quote,checks=[];
const head=Number(f.sql('select version from private.catalog_head;'));
const before=f.sql('select (select count(*) from private.sectors),(select count(*) from private.subgroups),(select count(*) from private.catalog_source_companies),(select count(*) from private.catalog_memberships),(select count(*) from private.catalog_snapshots),(select count(*) from private.catalog_operations);');
async function test(name,fn){await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));}
const fixture=(id,name='SYNTHETIC S6B constraint fixture')=>'insert into private.sectors(id,name,catalog_version,sample_kind) values('+q(id)+','+q(name)+','+head+",'SYNTHETIC');";
await test('Legacy synthetic fixture INSERT inherits explicit metadata grade without changing article mode',()=>{
 const id=randomUUID();assert.equal(f.sql('begin;'+fixture(id)+'select metadata_kind from private.sectors where id='+q(id)+';rollback;'),'SYNTHETIC_FIXTURE');
});
await test('NULL cannot bypass metadata CHECK and reference metadata cannot masquerade as synthetic/real article mode',()=>{
 const id=randomUUID();
 f.sql(`begin;do $$begin
   begin insert into private.sectors(id,name,catalog_version,sample_kind) values(${q(id)},'SYNTHETIC invalid null',${head},null);raise exception 'EXPECTED_CHECK_FAILURE';exception when check_violation then null;end;
   begin insert into private.sectors(id,name,catalog_version,sample_kind,metadata_kind) values(${q(id)},'invalid reference',${head},'SYNTHETIC','USER_REFERENCE_UNVERIFIED');raise exception 'EXPECTED_CHECK_FAILURE';exception when check_violation then null;end;
   begin insert into private.sectors(id,name,catalog_version,sample_kind,metadata_kind) values(${q(id)},'invalid real',${head},'PERMITTED_REAL','USER_REFERENCE_UNVERIFIED');raise exception 'EXPECTED_CHECK_FAILURE';exception when check_violation then null;end;
 end$$;rollback;`);
});
await test('Catalog snapshot UPDATE/DELETE and post-seal membership INSERT are rejected',()=>{
 const id=randomUUID();
 f.sql(`begin;${fixture(id)}do $$begin
   begin update private.catalog_snapshots set sha256=sha256 where version=${head};raise exception 'EXPECTED_IMMUTABLE_FAILURE';exception when raise_exception then if sqlerrm<>'IMMUTABLE_CATALOG_RECORD' then raise;end if;end;
   begin delete from private.catalog_snapshots where version=${head};raise exception 'EXPECTED_IMMUTABLE_FAILURE';exception when raise_exception then if sqlerrm<>'IMMUTABLE_CATALOG_RECORD' then raise;end if;end;
   begin insert into private.catalog_version_sectors(version,sector_id,active,catalog_kind,metadata_kind) values(${head},${q(id)},true,'LEAF','SYNTHETIC_FIXTURE');raise exception 'EXPECTED_IMMUTABLE_FAILURE';exception when raise_exception then if sqlerrm<>'IMMUTABLE_CATALOG_RECORD' then raise;end if;end;
 end$$;rollback;`);
});
await test('Cross-sector subgroup membership and inactive source company are rejected',()=>{
 const a=randomUUID(),b=randomUUID(),g=randomUUID(),c=randomUUID();
 f.sql(`begin;
 insert into private.sectors(id,name,catalog_version,sample_kind,metadata_kind) values(${q(a)},'SYNTHETIC reference A',${head},null,'USER_REFERENCE_UNVERIFIED'),(${q(b)},'SYNTHETIC reference B',${head},null,'USER_REFERENCE_UNVERIFIED');
 insert into private.subgroups(id,sector_id,name,metadata_kind) values(${q(g)},${q(a)},'SYNTHETIC group','USER_REFERENCE_UNVERIFIED');
 insert into private.catalog_source_companies(id,name) values(${q(c)},'SYNTHETIC company');
 do $$begin
   begin insert into private.catalog_memberships(sector_id,subgroup_id,source_company_ref) values(${q(b)},${q(g)},${q(c)});raise exception 'EXPECTED_MEMBERSHIP_FAILURE';exception when raise_exception then if sqlerrm<>'INVALID_CATALOG_MEMBERSHIP' then raise;end if;end;
 end$$;
 insert into private.catalog_memberships(sector_id,subgroup_id,source_company_ref) values(${q(a)},${q(g)},${q(c)});
 do $$begin
   begin insert into private.catalog_memberships(sector_id,subgroup_id,source_company_ref) values(${q(a)},${q(g)},${q(c)});raise exception 'EXPECTED_UNIQUE_FAILURE';exception when unique_violation then null;end;
 end$$;
 update private.catalog_source_companies set active=false where id=${q(c)};
 do $$begin
   begin insert into private.catalog_memberships(sector_id,source_company_ref) values(${q(b)},${q(c)});raise exception 'EXPECTED_INACTIVE_FAILURE';exception when raise_exception then if sqlerrm<>'INACTIVE_CATALOG_MEMBERSHIP' then raise;end if;end;
 end$$;rollback;`);
});
await test('Unresolved source-company records reject fabricated market or stock code',()=>{
 const id=randomUUID();
 f.sql(`begin;do $$begin
   begin insert into private.catalog_source_companies(id,name,market) values(${q(id)},'SYNTHETIC company','KRX');raise exception 'EXPECTED_CHECK_FAILURE';exception when check_violation then null;end;
   begin insert into private.catalog_source_companies(id,name,stock_code) values(${q(id)},'SYNTHETIC company','000000');raise exception 'EXPECTED_CHECK_FAILURE';exception when check_violation then null;end;
 end$$;rollback;`);
});
await test('V1 catalog retains the three legacy IDs in order',async()=>{
 const r=await f.rpc('m1_public_catalog',{}, {role:'anon'});assert.equal(r.status,200);
 assert.deepEqual(r.body.map(x=>x.id),[1,2,3].map(n=>'51000000-0000-4000-8000-'+String(n).padStart(12,'0')));
 assert.ok(r.body.every(x=>Object.keys(x).sort().join(',')==='description,id,name'));
});
assert.equal(f.sql('select (select count(*) from private.sectors),(select count(*) from private.subgroups),(select count(*) from private.catalog_source_companies),(select count(*) from private.catalog_memberships),(select count(*) from private.catalog_snapshots),(select count(*) from private.catalog_operations);'),before);
const result={status:'PASS',phase:'6B_REFERENCE_SCHEMA',checks,head,fixtureTransactionsRolledBack:true,realRequestsExecuted:0,limitations:'Only reference foundation constraints and v1 catalog observed. CRUD/public v2/import/frontend/native gates are not covered yet.'};
writePrivate('catalog-runtime-tests.json',result);console.log(JSON.stringify(result));
