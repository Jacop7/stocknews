import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {m1FixtureClient} from './m1-fixtures.mjs';
import {login,session,editorRpc,logout} from '../apps/admin/lib/runtime.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=await m1FixtureClient(),checks=[];let other,failure,restore;
async function test(name,fn){await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));}
const call=(s,args)=>editorRpc('catalog_apply',args,s);
const intent=(head,kind,entity,payload)=>({p_expected:head,p_operation_key:randomUUID(),p_kind:kind,p_entity:entity,p_payload:payload});
try{
 await test('Groups, contextual memberships, company descriptions, typed keywords and reordering work atomically in a rolled-back fixture',()=>{
  f.sql(`begin;do $$declare h bigint;parent uuid;leaf uuid;leaf2 uuid;g uuid;g2 uuid;c uuid;m uuid;m2 uuid;label text;k jsonb;begin
   select version into h from private.catalog_head;label:='SYNTHETIC '||gen_random_uuid();
   parent:=private.catalog_edit_sector('SECTOR_CREATE',null,jsonb_build_object('name',label,'catalog_kind','PARENT'),h);
   leaf:=private.catalog_edit_sector('SECTOR_CREATE',null,jsonb_build_object('name',label||' A','catalog_kind','LEAF','parent_id',parent),h);
   leaf2:=private.catalog_edit_sector('SECTOR_CREATE',null,jsonb_build_object('name',label||' B','catalog_kind','LEAF','parent_id',parent),h);
   h:=private.catalog_finish_version(h);
   g:=private.catalog_edit_group('GROUP_CREATE',null,jsonb_build_object('sector_id',leaf,'name','액추에이터'));
   g2:=private.catalog_edit_group('GROUP_CREATE',null,jsonb_build_object('sector_id',leaf,'name','핸드'));
   c:=private.catalog_edit_company('COMPANY_CREATE',null,jsonb_build_object('name',label||' 기업','search_description',E'기업 설명\n둘째 줄','direct_terms',jsonb_build_array('HBM'),'industry_terms',jsonb_build_array('반도체')));
   m:=private.catalog_edit_membership('MEMBERSHIP_CREATE',null,jsonb_build_object('sector_id',leaf,'subgroup_id',g,'source_company_ref',c,'role','액추에이터'));
   m2:=private.catalog_edit_membership('MEMBERSHIP_CREATE',null,jsonb_build_object('sector_id',leaf,'subgroup_id',g2,'source_company_ref',c,'role','핸드'));
   if (select count(*) from private.catalog_memberships where source_company_ref=c)<>2 then raise exception 'CONTEXTS_COLLAPSED';end if;
   perform private.catalog_edit_group('GROUP_UPDATE',g,jsonb_build_object('sector_id',leaf2));
   if not exists(select 1 from private.catalog_memberships where id=m and sector_id=leaf2 and subgroup_id=g and role='액추에이터') then raise exception 'MOVE_LOST_MEMBERSHIP';end if;
   perform private.catalog_edit_keywords(leaf,jsonb_build_object('keyword_kind','CORE','terms',jsonb_build_array('HBM','CXL')));
   perform private.catalog_edit_keywords(leaf,jsonb_build_object('keyword_kind','INDUSTRY','terms',jsonb_build_array('HBM')));
   select keywords into k from private.catalog_sector_data where sector_id=leaf;
   if jsonb_array_length(k)<>3 then raise exception 'CROSS_KIND_KEYWORD_LOSS';end if;
   perform private.catalog_reorder(jsonb_build_object('scope','SECTORS','parent_id',parent,'ids',jsonb_build_array(leaf2,leaf)));
   if (select display_order from private.sectors where id=leaf2)<>1 then raise exception 'REORDER_FAILED';end if;
   perform private.catalog_edit_group('GROUP_DEACTIVATE',g,'{}');perform private.catalog_edit_group('GROUP_RESTORE',g,'{}');
   if (select active from private.catalog_memberships where id=m) then raise exception 'IMPLICIT_MEMBERSHIP_RESTORE';end if;
   perform private.catalog_edit_membership('MEMBERSHIP_RESTORE',m,'{}');
   perform private.catalog_edit_company('COMPANY_DEACTIVATE',c,'{}');perform private.catalog_edit_company('COMPANY_RESTORE',c,'{}');
   if exists(select 1 from private.catalog_memberships where source_company_ref=c and active) then raise exception 'IMPLICIT_COMPANY_MEMBERSHIP_RESTORE';end if;
   if (select search_description from private.catalog_source_companies where id=c)<>E'기업 설명\n둘째 줄' then raise exception 'SEARCH_DESCRIPTION_LOSS';end if;
   begin perform private.catalog_edit_membership('MEMBERSHIP_CREATE',null,jsonb_build_object('sector_id',leaf,'subgroup_id',g2,'source_company_ref',c,'role','핸드'));raise exception 'EXPECTED_MEMBERSHIP_COLLISION';exception when raise_exception then if sqlerrm<>'CATALOG_MEMBERSHIP_EXISTS' then raise;end if;end;
  end$$;rollback;`);
 });
 const credentials=f.state.users.admin,r=await login(credentials.email,credentials.password);other={capability:r.capability,s:await session(r.capability)};
 assert.notEqual(other.s.sessionId,f.adminSession.sessionId);
 const beforeDoc=f.sql('select private.catalog_document();'),h=Number(f.sql('select version from private.catalog_head;'));
 const parent=JSON.parse(f.sql("select jsonb_build_object('id',id,'description',description) from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED' and catalog_kind='PARENT' and active order by display_order,id limit 1;"));
 restore={id:parent.id,description:parent.description};
 const a=intent(h,'SECTOR_UPDATE',parent.id,{description:parent.description+'\nSYNTHETIC concurrent save A'});
 const b=intent(h,'SECTOR_UPDATE',parent.id,{description:parent.description+'\nSYNTHETIC concurrent save B'});
 let applied,rejected;
 await test('Two actual Auth sessions race at one head: one applies, one receives a durable stale rejection',async()=>{
  const results=await Promise.all([call(f.adminSession,a),call(other.s,b)]);
  assert.equal(results.filter(x=>x.status==='APPLIED').length,1);assert.equal(results.filter(x=>x.status==='REJECTED'&&x.error==='STALE_CATALOG'&&x.not_applied===true).length,1);
  applied={args:results[0].status==='APPLIED'?a:b,s:results[0].status==='APPLIED'?f.adminSession:other.s,result:results.find(x=>x.status==='APPLIED')};
  rejected={args:results[0].status==='REJECTED'?a:b,s:results[0].status==='REJECTED'?f.adminSession:other.s,result:results.find(x=>x.status==='REJECTED')};
  assert.equal(Number(f.sql('select version from private.catalog_head;')),h+1);
 });
 await test('Lost-response retry and journal lookup return identical results without a second version/audit/outbox',async()=>{
  assert.deepEqual(await call(applied.s,applied.args),applied.result);
  assert.deepEqual(await editorRpc('catalog_operation_status',applied.args,applied.s),applied.result);
  const key=f.quote(applied.args.p_operation_key);
  assert.equal(f.sql('select count(*) from private.outbox where effect_key='+f.quote('catalog:operation:'+applied.args.p_operation_key)+';'),'1');
  assert.equal(f.sql("select count(*) from private.audits where details->>'operation_key'="+key+';'),'1');
  assert.equal(Number(f.sql('select version from private.catalog_head;')),h+1);
 });
 await test('Definitively rejected stale intent stays rejected even after retry; absent operation stays UNKNOWN',async()=>{
  assert.deepEqual(await call(rejected.s,rejected.args),rejected.result);
  assert.deepEqual(await editorRpc('catalog_operation_status',rejected.args,rejected.s),rejected.result);
  const unknown=await editorRpc('catalog_operation_status',{...a,p_operation_key:randomUUID()},f.adminSession);assert.equal(unknown.status,'UNKNOWN');assert.ok(!Object.hasOwn(unknown,'not_applied'));
  await assert.rejects(call(applied.s,{...applied.args,p_payload:{description:'different'}}),/EFFECT_PAYLOAD_CONFLICT/);
 });
 await test('Explicit latest load and new intent permit re-edit; malformed stock fields are durably rejected',async()=>{
  const loaded=await editorRpc('catalog_editor_tree',{},rejected.s);assert.equal(Number(loaded.catalog_version),h+1);
  const next=intent(Number(loaded.catalog_version),'SECTOR_UPDATE',parent.id,{description:parent.description+'\nSYNTHETIC explicitly re-edited'});
  const result=await call(rejected.s,next);assert.equal(result.status,'APPLIED');assert.equal(Number(result.catalog_version),h+2);
  const invalid=intent(h+2,'COMPANY_CREATE',null,{name:'SYNTHETIC INVALID',stock_code:'000000'});
  const denied=await call(f.adminSession,invalid);assert.equal(denied.status,'REJECTED');assert.equal(denied.error,'CATALOG_FIELD_NOT_ALLOWED');assert.equal(denied.not_applied,true);
  assert.equal(Number(f.sql('select version from private.catalog_head;')),h+2);
 });
 await test('Original metadata is restored through the same audited API while immutable snapshots remain',async()=>{
  const result=await call(f.adminSession,intent(Number(f.sql('select version from private.catalog_head;')),'SECTOR_UPDATE',restore.id,{description:restore.description}));assert.equal(result.status,'APPLIED');restore=null;
  assert.equal(f.sql('select private.catalog_document();'),beforeDoc);
  const denied=await f.rpc('catalog_apply',a,{role:'anon'});assert.ok(denied.status>=400);
 });
}catch(e){failure=e;}finally{
 if(restore){try{const current=f.sql('select description from private.sectors where id='+f.quote(restore.id)+';');if(current!==restore.description)await call(f.adminSession,intent(Number(f.sql('select version from private.catalog_head;')),'SECTOR_UPDATE',restore.id,{description:restore.description}));}catch(e){failure??=e;}}
 if(other)await logout(other.capability,other.s);
 await logout(f.capability,f.adminSession);
 writePrivate('catalog-operation-tests.json',{status:failure?'FAIL':'PASS',checks,twoActualAuthSessions:!!other,realRequestsExecuted:0,sourceSheetWrites:0,remote:false,limitations:'Actual SQL/Auth CAS and operation journal; HTTP browser recovery still needs verification.'});
}
if(failure)throw failure;
