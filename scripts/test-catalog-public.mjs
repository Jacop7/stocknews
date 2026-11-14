import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {localClient} from './m0-test-client.mjs';
import {root,writePrivate} from './local-runtime.mjs';
const f=localClient(),registry=JSON.parse(readFileSync(path.join(root,'tests/fixtures/catalog/registry-v1.json'))),checks=[];
async function test(name,fn){await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));}
const rpc=(name,args={})=>f.rpc(name,args,{role:'anon'});
const tree=await rpc('catalog_public_tree');assert.equal(tree.status,200);const data=tree.body;
await test('Anonymous reference tree exposes exactly11 parents and56 leaves with registry IDs and no raw/foreign data',()=>{
 assert.equal(data.parents.length,11);assert.equal(data.parents.flatMap(p=>p.sectors).length,56);
 assert.deepEqual(data.parents.map(p=>p.id),registry.parents.map(p=>p.id));
 assert.deepEqual(new Set(data.parents.flatMap(p=>p.sectors.map(s=>s.id))),new Set(registry.categories.map(c=>c.id)));
 const text=JSON.stringify(data);for(const field of ['rawSource','source_row','foreign_companies','keywords','actor_id'])assert.ok(!text.includes('"'+field+'"'));
 const entertainment=data.parents.find(p=>p.name==='통신 · 엔터 · 게임');assert.ok(entertainment.sectors.some(s=>s.name==='엔터'));assert.ok(!data.parents.find(p=>p.name==='소비재').sectors.some(s=>s.name==='엔터'||s.name==='편의점'));
});
await test('Sector detail keeps company role by subgroup and leaves all unverified stock fields null',async()=>{
 const sector=registry.categories.find(c=>c.name==='휴머노이드 액추에이터·핸드'),r=await rpc('catalog_public_sector',{p_sector:sector.id,p_expected:data.catalog_version});
 assert.equal(r.status,200);assert.equal(r.body.state,'AVAILABLE');
 const rows=r.body.groups.flatMap(g=>g.members.map(m=>({...m,group:g.name}))).concat(r.body.ungrouped_members);
 const robot=rows.filter(m=>m.name==='로보티즈');assert.equal(robot.length,2);assert.notEqual(robot[0].membership_id,robot[1].membership_id);assert.notEqual(robot[0].description,robot[1].description);
 assert.ok(rows.every(m=>m.stock_identity_state==='UNRESOLVED'&&m.stock_code===null&&m.price===null&&m.change_percent===null&&m.stock_url===null));
 assert.ok(!JSON.stringify(r.body).includes('foreign_companies'));
});
await test('Legacy sector IDs and parent IDs do not become v2 leaf pages',async()=>{
 for(const id of ['51000000-0000-4000-8000-000000000001',registry.parents[0].id]){
  const r=await rpc('catalog_public_sector',{p_sector:id});assert.equal(r.status,200);assert.equal(r.body.state,'NOT_FOUND');
 }
});
await test('Stale catalog version fails closed; anon cannot invoke editor RPC',async()=>{
 const stale=await rpc('catalog_public_tree',{p_expected:999999});assert.ok(stale.status>=400);assert.equal(stale.body.message,'STALE_CATALOG');
 const denied=await rpc('catalog_editor_tree');assert.ok(denied.status>=400);
});
await test('Inactive parent prevents direct leaf selection even if a malformed projection left the child active',()=>{
 const parent=registry.parents[0],child=registry.categories.find(c=>c.parentId===parent.id);
 const value=f.sql('begin;update private.sectors set active=false where id='+f.quote(parent.id)+';select private.catalog_sector_selectable('+f.quote(child.id)+','+Number(data.catalog_version)+",'SYNTHETIC');rollback;");assert.equal(value,'f');
});
const result={status:'PASS',phase:'6B_PUBLIC_REFERENCE_RPC',checks,catalogVersion:data.catalog_version,realRequestsExecuted:0,limitations:'Read-only SQL RPC only. HTTP v2 gateway, admin CRUD, frontend and native are not yet connected or certified.'};
writePrivate('catalog-public-tests.json',result);console.log(JSON.stringify(result));
