import test from 'node:test';import assert from 'node:assert/strict';
import {auditRoleChanges,parallel4Readiness,PARALLEL4_EXECUTION_ENABLED} from '../scripts/parallel4-readiness.mjs';
test('disjoint worker change scopes reject shared files and path tricks',()=>{
  assert.equal(auditRoleChanges('COLLECTOR',['workers/collectors/parser.mjs']).status,'PROPOSED_SOURCE_SCOPE_MATCH');
  for(const p of ['package.json','workers/ai-processing/x.mjs','workers/collectors/../common/x','workers\\collectors\\x','/workers/collectors/x','workers/collectors/x:stream','workers/collectors//x'])assert.equal(auditRoleChanges('COLLECTOR',[p]).status,'REJECTED');
  assert.equal(auditRoleChanges('MAIN',['apps/admin/x']).status,'REJECTED');assert.equal(auditRoleChanges('AI',['workers/ai-processing/x','workers/ai-processing/x']).status,'REJECTED');
});
test('preparation cannot impersonate a verified sandbox, running forks or active routing',()=>{
  const r=parallel4Readiness({readIsolationVerified:true,executionEnabled:true});assert.equal(PARALLEL4_EXECUTION_ENABLED,false);assert.equal(r.executionEnabled,false);assert.equal(r.state,'HOLD_NOT_ACTIVATED');assert.equal(r.readIsolationVerified,false);assert.equal(r.messagesSent,0);assert.ok(r.blockers.includes('COMMAND_SANDBOX_DOES_NOT_COVER_MCP_BROWSER_TOOLS'));
  r.executionEnabled=true;assert.equal(parallel4Readiness().executionEnabled,false);
});
