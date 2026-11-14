// Browser-safe editorial state. These values confer no authority; SQL rechecks every request.
export function alignedScenarios(scenarios,impacts){
  const positive=impacts.filter(x=>x.direction==='BENEFIT'||x.conditional_direction==='POSITIVE').map(x=>x.path_id);
  const negative=impacts.filter(x=>x.direction==='DAMAGE'||x.conditional_direction==='NEGATIVE').map(x=>x.path_id);
  if(!positive.length)return [];
  return scenarios.filter(x=>x.direction==='POSITIVE'||x.direction==='NEGATIVE'&&negative.length)
    .map(x=>({...x,path_ids:[...new Set(x.direction==='POSITIVE'?positive:negative)]}));
}
export function confirmedSqlRejection(body){
  // A lost response, gateway failure, timeout, or absent outbox row is NOT proof
  // that the operation did not commit. Only explicit rollback-class SQL errors qualify.
  return typeof body?.code==='string'&&/^(P0001|40001|40P01|42501|22[A-Z0-9]{3}|23[A-Z0-9]{3}|42[A-Z0-9]{3})$/.test(body.code);
}
export class EditorApiError extends Error{constructor(code,status,notApplied=false){super(code);this.status=status;this.notApplied=notApplied===true;}}
export function pendingResolution(outcome,notApplied,latestRead){
  if(!latestRead)return 'UNCERTAIN';
  if(outcome==='APPLIED')return 'APPLIED';
  return outcome==='UNKNOWN'&&notApplied===true?'REJECTED':'UNCERTAIN';
}
export function parsePendingIntent(text){
  try{
    const value=JSON.parse(text),a=value.args,uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x);
    const integer=x=>Number.isSafeInteger(x)&&x>=0;
    if(value.action==='create'&&uuid(a?.p_request))return {action:'create',args:{p_request:a.p_request}};
    if(!a||!uuid(a.p_issue)||!integer(a.p_expected_revision)||typeof a.p_effect_key!=='string'||a.p_effect_key.length<1||a.p_effect_key.length>200)return null;
    if(value.action==='state'&&['HIDDEN','WITHDRAWN','CORRECTION_PENDING'].includes(a.p_state))return {action:'state',args:{p_issue:a.p_issue,p_expected_revision:a.p_expected_revision,p_state:a.p_state,p_effect_key:a.p_effect_key}};
    if(value.action==='publish'&&integer(a.p_issue_revision)&&integer(a.p_policy)&&a.p_policy>0&&integer(a.p_catalog)&&a.p_catalog>0)return {action:'publish',args:{p_issue:a.p_issue,p_expected_revision:a.p_expected_revision,p_issue_revision:a.p_issue_revision,p_policy:a.p_policy,p_catalog:a.p_catalog,p_effect_key:a.p_effect_key}};
    return null;
  }catch{return null;}
}

export function stateRecoveryDraft(current,latest){
  if(!current||current.issue_id!==latest.issue_id)return {draft:latest,needsReload:false};
  // Content always travels with its original draft revision. A state operation
  // may advance issue revision, but cannot authorize overwriting another edit.
  return {draft:{...latest,content:current.content,draft_revision:current.draft_revision},needsReload:current.draft_revision!==latest.draft_revision};
}
