import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {m1FixtureClient,fixtureContent} from './m1-fixtures.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=await m1FixtureClient(),checks=[];let failure,restoreCompany,restoreGroup;
const head=()=>Number(f.sql('select version from private.catalog_head;'));
const apply=async(kind,id,payload)=>{const result=await f.editor('catalog_apply',{p_expected:head(),p_operation_key:randomUUID(),p_kind:kind,p_entity:id,p_payload:payload});assert.equal(result.status,'APPLIED',result.error);return result;};
async function test(name,fn){await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));}
const compact=value=>Array.isArray(value)?value.map(compact):value&&typeof value==='object'?(Object.hasOwn(value,'comparisonKey')&&Object.hasOwn(value,'raw')?value.raw:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,compact(v)]))):value;
const before=compact(JSON.parse(f.sql('select private.catalog_document();')));
try{
 const c=JSON.parse(f.sql("select jsonb_build_object('id',id,'name',name,'search_description',search_description,'direct_terms',private.catalog_compact_terms(direct_keywords),'industry_terms',private.catalog_compact_terms(industry_keywords)) from private.catalog_source_companies where active order by id limit 1;"));
 const d=await f.create(),content=fixtureContent(d,{title:'SYNTHETIC R2 · 카탈로그 저장 충돌 검증'}),baseline=head();
 restoreCompany=c;
 await test('Latest company detail includes concurrent direct and industry terms; stale reads fail closed',async()=>{
  await apply('COMPANY_UPDATE',c.id,{direct_terms:[...c.direct_terms,'SYNTHETIC R2 직접 검색어'],industry_terms:[...c.industry_terms,'SYNTHETIC R2 산업 검색어']});
  await assert.rejects(f.editor('catalog_editor_company',{p_company:c.id,p_expected:baseline}),/STALE_CATALOG/);
  const latest=await f.editor('catalog_editor_company',{p_company:c.id,p_expected:head()});assert.equal(latest.company.name,c.name);assert.ok(latest.company.direct_terms.includes('SYNTHETIC R2 직접 검색어'));assert.ok(latest.company.industry_terms.includes('SYNTHETIC R2 산업 검색어'));
  // Importing only the intended description leaves other-admin keywords intact.
  await apply('COMPANY_UPDATE',c.id,{name:latest.company.name,search_description:c.search_description+'\nSYNTHETIC R2 선택 복구',direct_terms:latest.company.direct_terms,industry_terms:latest.company.industry_terms});
  const recovered=await f.editor('catalog_editor_company',{p_company:c.id,p_expected:head()});assert.deepEqual(recovered.company.direct_terms,latest.company.direct_terms);assert.deepEqual(recovered.company.industry_terms,latest.company.industry_terms);
 });
 await test('Strict manual save rejects a stale catalog without changing content or revision, then accepts an explicit current head',async()=>{
  const beforeDraft=await f.editor('m1_get_draft',{p_issue:d.issue_id});
  await assert.rejects(f.editor('catalog_save_draft',{p_issue:d.issue_id,p_expected_revision:beforeDraft.draft_revision,p_content:content,p_catalog:baseline}),/STALE_CATALOG/);
  const unchanged=await f.editor('m1_get_draft',{p_issue:d.issue_id});assert.equal(unchanged.draft_revision,beforeDraft.draft_revision);assert.deepEqual(unchanged.content,beforeDraft.content);
  await f.editor('catalog_save_draft',{p_issue:d.issue_id,p_expected_revision:unchanged.draft_revision,p_content:content,p_catalog:head()});
  const saved=await f.editor('m1_get_draft',{p_issue:d.issue_id});assert.equal(saved.draft_revision,unchanged.draft_revision+1);assert.equal(saved.content.title,content.title);
  await assert.rejects(f.editor('catalog_save_draft',{p_issue:d.issue_id,p_expected_revision:saved.draft_revision,p_content:{...content,key_issues:{bad:true}},p_catalog:head()}),/DRAFT_SHAPE_INVALID/);
 });
 await test('Legacy draft IDs retain their old names and explicit nonselectable status',async()=>{
  const legacy='51000000-0000-4000-8000-000000000001',saved=await f.editor('m1_get_draft',{p_issue:d.issue_id});
  const old={...saved.content,primary_sector_id:legacy,impacts:saved.content.impacts.map(x=>({...x,sector_id:legacy}))};
  await f.editor('catalog_save_draft',{p_issue:d.issue_id,p_expected_revision:saved.draft_revision,p_content:old,p_catalog:head()});
  const read=await f.editor('m1_get_draft',{p_issue:d.issue_id}),label=read.sector_labels.find(x=>x.id===legacy);assert.equal(label.name,'반도체 후공정/패키징');assert.equal(label.selectable,false);assert.equal(label.metadata_kind,'SYNTHETIC_FIXTURE');
  await assert.rejects(f.editor('m1_preview_draft',{p_issue:d.issue_id,p_expected_revision:read.draft_revision,p_policy:read.policy_version,p_catalog:read.catalog_version}),/SECTOR|CATALOG/);
 });
 const group=JSON.parse(f.sql("select jsonb_build_object('id',g.id,'sector_id',g.sector_id,'name',g.name,'member_id',m.id) from private.subgroups g join private.catalog_memberships m on m.subgroup_id=g.id where g.active and m.active and g.metadata_kind='USER_REFERENCE_UNVERIFIED' order by g.id,m.id limit 1;"));
 const destination=f.sql("select id from private.sectors where active and catalog_kind='LEAF' and metadata_kind='USER_REFERENCE_UNVERIFIED' and id<>"+f.quote(group.sector_id)+" and not exists(select 1 from private.subgroups g where g.sector_id=private.sectors.id and g.name="+f.quote(group.name)+') order by id limit 1;');
 restoreGroup=group;
 await test('Moved group and membership recovery reads the target by stable ID, outside its old sector page',async()=>{
  await apply('GROUP_UPDATE',group.id,{sector_id:destination});
  const moved=await f.editor('catalog_editor_group',{p_group:group.id,p_expected:head()}),member=await f.editor('catalog_editor_membership',{p_membership:group.member_id,p_expected:head()});assert.equal(moved.group.sector_id,destination);assert.equal(member.membership.sector_id,destination);assert.equal(member.membership.subgroup_id,group.id);assert.ok(member.membership.name);
  await assert.rejects(f.editor('catalog_editor_group',{p_group:group.id,p_expected:head()-1}),/STALE_CATALOG/);
 });
 await apply('GROUP_UPDATE',group.id,{sector_id:group.sector_id});restoreGroup=null;
 await apply('COMPANY_UPDATE',c.id,{name:c.name,search_description:c.search_description,direct_terms:c.direct_terms,industry_terms:c.industry_terms});restoreCompany=null;
 await test('All effective reference values are restored; anonymous recovery and strict writes remain denied',async()=>{
  assert.deepEqual(compact(JSON.parse(f.sql('select private.catalog_document();'))),before);
  for(const [name,args] of [['catalog_editor_group',{p_group:group.id,p_expected:head()}],['catalog_editor_membership',{p_membership:group.member_id,p_expected:head()}],['catalog_save_draft',{p_issue:d.issue_id,p_expected_revision:1,p_content:content,p_catalog:head()}]])assert.ok((await f.rpc(name,args,{role:'anon'})).status>=400);
 });
}catch(e){failure=e;}finally{
 try{if(restoreGroup)await apply('GROUP_UPDATE',restoreGroup.id,{sector_id:restoreGroup.sector_id});if(restoreCompany){const {id,...payload}=restoreCompany;await apply('COMPANY_UPDATE',id,payload);}}catch(e){failure??=e;}
 await logout(f.capability,f.adminSession);
 writePrivate('catalog-recovery-tests.json',{status:failure?'FAIL':'PASS',checks,actualAuth:true,realRequestsExecuted:0,sourceSheetWrites:0,remote:false,limitations:'SQL/Auth target reads and catalog-CAS saves; visual recovery and legacy-option behavior require separate browser evidence. Keyword restoration is an audited ADMIN edit; immutable source archive and snapshots retain original provenance.'});
}
if(failure)throw failure;
