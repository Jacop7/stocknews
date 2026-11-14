import test from 'node:test';
import assert from 'node:assert/strict';
import { alignedScenarios,confirmedSqlRejection,pendingResolution,parsePendingIntent } from '../apps/admin/lib/editor-state.mjs';
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
