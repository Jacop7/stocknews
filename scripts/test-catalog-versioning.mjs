import assert from 'node:assert/strict';
import {m1FixtureClient} from './m1-fixtures.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=await m1FixtureClient(),checks=[];let failure;
async function test(name,fn){await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));}
try{
await test('Settings index includes inactive entities without exposing a whole raw document',async()=>{
 const data=await f.editor('catalog_editor_index',{p_offset:0,p_limit:100});assert.equal(data.items.length,67);assert.equal(data.total,67);
 assert.ok(data.items.every(x=>typeof x.active==='boolean'&&!Object.hasOwn(x,'source_row')&&!Object.hasOwn(x,'foreign_companies')));
});
await test('Canonical audit diff records only changed entities with before and after',()=>{
 const a={sectors:[{id:'a',name:'before'},{id:'b',name:'same'}]},b={sectors:[{id:'b',name:'same'},{id:'a',name:'after'}]};
 const delta=JSON.parse(f.sql('select private.catalog_diff('+f.quote(JSON.stringify(a))+'::jsonb,'+f.quote(JSON.stringify(b))+'::jsonb);'));
 assert.equal(delta.sectors.length,1);assert.equal(delta.sectors[0].id,'a');assert.equal(delta.sectors[0].before.name,'before');assert.equal(delta.sectors[0].after.name,'after');
});
await test('Metadata-only head advance keeps historical and current-reference published articles visible and dates unchanged',()=>{
 const current=Number(f.sql('select version from private.catalog_head;'));
 const query="select jsonb_build_object('visible',count(*) filter(where private.m1_current_evidence(id)),'dates',md5(coalesce(string_agg(id::text||coalesce(current_version_id::text,'')||coalesce(first_published_at::text,'')||coalesce(material_change_at::text,''),',' order by id),''))) from private.issues;";
 const before=JSON.parse(f.sql(query));assert.ok(before.visible>0);
 const observed=JSON.parse(f.sql('begin;select private.catalog_finish_version('+current+');'+query+'rollback;').split('\n').at(-1));
 assert.deepEqual(observed,before);assert.equal(Number(f.sql('select version from private.catalog_head;')),current);
 f.sql(`begin;do $$begin begin perform private.catalog_finish_version(999999);raise exception 'EXPECTED_STALE_REJECTION';exception when raise_exception then if sqlerrm<>'STALE_CATALOG' then raise;end if;end;end$$;rollback;`);
});
await test('Description validation preserves line breaks but rejects oversized data',()=>{
 assert.equal(f.sql('select private.catalog_description('+f.quote('첫 줄\n둘째 줄')+');'),'첫 줄\n둘째 줄');
 f.sql(`do $$begin begin perform private.catalog_description(repeat('x',6001));raise exception 'EXPECTED_TEXT_REJECTION';exception when raise_exception then if sqlerrm<>'INVALID_CATALOG_TEXT' then raise;end if;end;end$$;`);
});
}catch(e){failure=e;}finally{
 await logout(f.capability,f.adminSession);
 writePrivate('catalog-versioning-tests.json',{status:failure?'FAIL':'PASS',phase:'6B_REFERENCE_VERSIONING',checks,fixtureTransactionRolledBack:true,realRequestsExecuted:0,limitations:'Versioning helpers and actual admin reads only; public mutation/state recovery/browser validation remain.'});
}
if(failure)throw failure;
