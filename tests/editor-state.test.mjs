import test from 'node:test';
import assert from 'node:assert/strict';
import { alignedScenarios,confirmedSqlRejection,currentPublicationBinding,EditorApiError,matchesSavedDraft,observePendingEditorOperation,pendingResolution,parsePendingIntent,publicationBinding,saveFailureNeedsDraftReload } from '../apps/admin/lib/editor-state.mjs';
const pos={direction:'POSITIVE',title:'Written positive',expected_result:'Existing text',checks:['Check'],path_ids:['benefit']},neg={...pos,direction:'NEGATIVE',title:'Written negative',path_ids:['damage']};
const benefit={path_id:'benefit',direction:'BENEFIT',conditional_direction:'NONE'},damage={path_id:'damage',direction:'DAMAGE',conditional_direction:'NONE'};
test('Removing the final negative impact removes the hidden negative scenario and stale references',()=>{
 const original=[pos,neg],next=alignedScenarios(original,[{...benefit,path_id:'retained-positive'}]);
 assert.deepEqual(next,[{...pos,path_ids:['retained-positive']}]);assert.deepEqual(original,[pos,neg]);
});
test('No positive path means no scenarios; adding a path never invents scenario text',()=>{
 assert.deepEqual(alignedScenarios([pos,neg],[damage]),[]);
 assert.deepEqual(alignedScenarios([],[benefit,damage]),[]);
 assert.deepEqual(alignedScenarios([pos],[benefit,damage]),[pos]);
 const related={...damage,direction:'RELATED',conditional_direction:'NEGATIVE'};
 assert.deepEqual(alignedScenarios([pos,neg],[benefit,related]),[pos,neg]);assert.deepEqual(alignedScenarios([pos,neg],[benefit]),[pos]);
});
test('Unknown outcomes retain the same intent; confirmed rejection requires a fresh state read',()=>{
 for(const outcome of ['UNKNOWN',undefined])assert.equal(pendingResolution(outcome,false,true),'UNCERTAIN');
 assert.equal(pendingResolution('UNKNOWN',true,false),'UNCERTAIN');assert.equal(pendingResolution('UNKNOWN',true,true),'REJECTED');
 assert.equal(pendingResolution('APPLIED',false,true),'APPLIED');assert.equal(pendingResolution('APPLIED',true,false),'UNCERTAIN');
 for(const code of ['P0001','40001','40P01','42501','22P02','23514'])assert.equal(confirmedSqlRejection({code}),true);
 for(const body of [{message:'UPSTREAM_UNAVAILABLE'},{code:'57P01'},{code:'ECONNRESET'},{code:'PGRST001'},null])assert.equal(confirmedSqlRejection(body),false);
});

test('A confirmed payload conflict never adopts a different write under the same key',async()=>{
 const conflicting=new EditorApiError('EFFECT_PAYLOAD_CONFLICT',409,true);
 const unexpected=()=>assert.fail('A conflicting key cannot prove application');
 assert.deepEqual(await observePendingEditorOperation(unexpected,unexpected,conflicting),{resolution:'CONFLICT'});
});

test('An uncertain write reads the draft only after observing APPLIED',async()=>{
 let state='PUBLISHED';
 const receipt=await observePendingEditorOperation(
  async()=>{await Promise.resolve();state='HIDDEN';return {state:'APPLIED'};},
  async()=>({state}),new TypeError('response lost'),
 );
 assert.deepEqual(receipt,{resolution:'APPLIED',latest:{state:'HIDDEN'}});
 const unexpected=()=>assert.fail('Unknown write should retain the pending intent');
 assert.deepEqual(await observePendingEditorOperation(async()=>({state:'UNKNOWN'}),unexpected),
  {resolution:'UNCERTAIN'});
 await assert.rejects(observePendingEditorOperation(async()=>({state:'APPLIED'}),
  async()=>{throw new Error('draft read failed');}),/draft read failed/);
});
test('Persisted intent contains only non-secret request identifiers and survives a retry',()=>{
 const args={p_issue:'51000000-0000-4000-8000-000000000001',p_expected_revision:2,p_issue_revision:1,p_policy:2,p_catalog:1,p_effect_key:'unchanged-key',access_token:'must-not-retain',p_content:{private:'must-not-retain'}};
 const restored=parsePendingIntent(JSON.stringify({action:'publish',args}));assert.equal(restored.args.p_effect_key,'unchanged-key');assert.ok(!JSON.stringify(restored).includes('must-not-retain'));
 assert.deepEqual(parsePendingIntent(JSON.stringify(restored)),restored);
 assert.equal(parsePendingIntent(JSON.stringify({action:'publish',args:{...args,p_expected_revision:null}})),null);assert.equal(parsePendingIntent('bad JSON'),null);
});

test('A state result never attaches another editor revision to old content',async()=>{
 const {stateRecoveryDraft}=await import('../apps/admin/lib/editor-state.mjs');
 const old={issue_id:'same',draft_revision:1,issue_revision:2,state:'PUBLISHED',content:{title:'A unsaved'}},latest={...old,draft_revision:2,issue_revision:3,state:'HIDDEN',content:{title:'B saved'}};
 const result=stateRecoveryDraft(old,latest);assert.equal(result.needsReload,true);assert.equal(result.draft.draft_revision,1);assert.equal(result.draft.content.title,'A unsaved');assert.equal(result.draft.issue_revision,3);assert.equal(result.draft.state,'HIDDEN');
 const unchanged=stateRecoveryDraft(old,{...latest,draft_revision:1});assert.equal(unchanged.needsReload,false);assert.equal(unchanged.draft.draft_revision,1);assert.equal(unchanged.draft.content,old.content);
 assert.deepEqual(stateRecoveryDraft(null,latest),{draft:latest,needsReload:false});assert.deepEqual(old.content,{title:'A unsaved'});
});

const editorDraft={
 issue_id:'51000000-0000-4000-8000-000000000001',draft_revision:4,issue_revision:9,
 policy_version:2,catalog_version:5,content:{title:'검토할 기사'},
};

test('A save receipt authorizes preview only for its own next draft revision',()=>{
 const receipt={draft_revision:5},saved={...editorDraft,draft_revision:5};
 assert.equal(matchesSavedDraft(editorDraft,receipt,saved),true);
 for(const invalid of [null,{}, {draft_revision:'5'},{draft_revision:4},{draft_revision:6}]){
  assert.equal(matchesSavedDraft(editorDraft,invalid,saved),false);
 }
 assert.equal(matchesSavedDraft(editorDraft,receipt,{...saved,draft_revision:6,content:{title:'다른 편집자의 초안'}}),false);
 assert.equal(editorDraft.content.title,'검토할 기사');
 assert.equal(editorDraft.draft_revision,4);
});

test('Confirmed stale catalog keeps edits available for a catalog-only refresh',()=>{
 assert.equal(saveFailureNeedsDraftReload(new EditorApiError('STALE_CATALOG',409,true)),false);
 assert.equal(saveFailureNeedsDraftReload(new EditorApiError('DRAFT_SHAPE_INVALID',400,true)),false);
 assert.equal(saveFailureNeedsDraftReload(new EditorApiError('REVISION_CONFLICT',409,true)),true);
 assert.equal(saveFailureNeedsDraftReload(new EditorApiError('STALE_CATALOG',409,false)),true);
 assert.equal(saveFailureNeedsDraftReload(new TypeError('connection lost')),true);
});

test('Save and preview bindings both reject another issue, issue revision, policy or catalog',()=>{
 const saved={...editorDraft,draft_revision:5},receipt={draft_revision:5},binding=publicationBinding(saved);
 for(const changed of [
  {issue_id:'51000000-0000-4000-8000-000000000002'},{issue_revision:10},{policy_version:3},{catalog_version:6},
 ]){
  const current={...saved,...changed};
  assert.equal(matchesSavedDraft(editorDraft,receipt,current),false);
  assert.equal(currentPublicationBinding(current,binding),null);
 }
 assert.equal(currentPublicationBinding({...saved,draft_revision:6},binding),null);
 assert.equal(currentPublicationBinding(saved,null),null);
 assert.equal(currentPublicationBinding(null,binding),null);
 assert.deepEqual(currentPublicationBinding(saved,binding),{
  p_issue:saved.issue_id,p_expected_revision:5,p_issue_revision:9,p_policy:2,p_catalog:5,
 });
});

test('An uncertain publish keeps the previewed version and effect key after a newer preview',()=>{
 const binding=publicationBinding(editorDraft);
 const stored=parsePendingIntent(JSON.stringify({action:'publish',args:{...binding,p_effect_key:'original-key'}}));
 const newer={...editorDraft,draft_revision:5,issue_revision:10};
 assert.equal(currentPublicationBinding(newer,binding),null);
 assert.deepEqual(parsePendingIntent(JSON.stringify(stored)),{action:'publish',args:{...binding,p_effect_key:'original-key'}});
 assert.equal(currentPublicationBinding(newer,publicationBinding(newer)).p_expected_revision,5);
});
