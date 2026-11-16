// Planning/ownership diagnostics only. Never a credential, worktree or dispatch executor.
const prefixes=Object.freeze({COLLECTOR:'workers/collectors/',AI:'workers/ai-processing/',RANKING:'workers/home-ranking/'});
export const PARALLEL4_EXECUTION_ENABLED=false;
export function auditRoleChanges(role,paths){
  if(!Object.hasOwn(prefixes,role)||!Array.isArray(paths)||paths.length>1000||new Set(paths).size!==paths.length)return {status:'REJECTED',reason:'INVALID_ROLE_OR_PATH_LIST'};
  for(const p of paths)if(typeof p!=='string'||p!==p.normalize('NFC')||p.includes('\\')||p.includes(':')||p.startsWith('/')||p.split('/').some(x=>!x||x==='.'||x==='..')||!p.startsWith(prefixes[role]))return {status:'REJECTED',reason:'OUTSIDE_OWNED_PATHS'};
  return {status:'PROPOSED_SOURCE_SCOPE_MATCH',role,files:paths.length,readIsolationProven:false,executionEnabled:false};
}
export function parallel4Readiness(){
  return {state:'HOLD_NOT_ACTIVATED',executionEnabled:PARALLEL4_EXECUTION_ENABLED,forksCreated:0,worktreesCreated:0,messagesSent:0,readIsolationVerified:false,
    blockers:['HOST_FORK_PERMISSION_PROFILE_NOT_BOUND','COMMAND_SANDBOX_DOES_NOT_COVER_MCP_BROWSER_TOOLS','ACTUAL_CANARY_DENIAL_AND_ENV_CONTROL_ISOLATION_UNVERIFIED','WORKTREE_STAGE_GUARD_TRANSITION_UNACTIVATED','FOUR_AUTHOR_MODEL_PLAN_AND_ROUTING_DECISION_UNSEALED','TASK_SCOPED_REVIEW_DELEGATION_UNVERIFIED'],
    limitations:'Source diagnostic, not a security boundary or live worker. No option can change this module to READY.'};
}
