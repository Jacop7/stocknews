const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function catalogPending(raw){
 if(raw===null)return null;
 let value;try{value=JSON.parse(raw);}catch{throw new Error('PENDING_CATALOG_INVALID');}
 const args=value?.args;
 if(!value||!UUID.test(value.actor??'')||!args||Object.keys(args).sort().join(',')!=='p_entity,p_expected,p_kind,p_operation_key,p_payload'||!UUID.test(args.p_operation_key)||!Number.isSafeInteger(args.p_expected)||args.p_expected<1||typeof args.p_kind!=='string'||(args.p_entity!==null&&!/^[0-9a-f-]{36}$/.test(args.p_entity??''))||!args.p_payload||Array.isArray(args.p_payload)||typeof args.p_payload!=='object'||(value.recoveryOf!==undefined&&!UUID.test(value.recoveryOf))||(value.targetName!==undefined&&(typeof value.targetName!=='string'||value.targetName.length>200))||new TextEncoder().encode(JSON.stringify(value)).length>131072)throw new Error('PENDING_CATALOG_INVALID');
 return value;
}
export function catalogOutcome(pending,result,actor){
 if(!pending||pending.actor!==actor||result?.actor_id!==actor||result.operation_key!==pending.args.p_operation_key||!/^[0-9a-f]{64}$/.test(result.request_sha256??''))return 'UNCERTAIN';
 if(result.status==='APPLIED'&&typeof result.catalog_version==='string')return 'APPLIED';
 if(result.status==='REJECTED'&&result.not_applied===true&&typeof result.error==='string')return 'DEFINITELY_REJECTED';
 return 'UNCERTAIN';
}
export function catalogArchive(raw){
 if(raw===null)return null;
 let value;try{value=JSON.parse(raw);}catch{throw new Error('CATALOG_RECOVERY_INVALID');}
 if(!value||!value.intent||catalogPending(JSON.stringify(value.intent))===null||!/^[1-9]\d{0,14}$/.test(value.version??'')||!value.latest||Array.isArray(value.latest)||typeof value.latest!=='object'||new TextEncoder().encode(JSON.stringify(value)).length>524288)throw new Error('CATALOG_RECOVERY_INVALID');
 return value;
}
export function recoveryTarget(intent){
 const {p_kind:kind,p_entity:id,p_payload:payload}=intent.args;
 if(kind==='REORDER')return {type:'ORDER',id:payload.parent_id??null};
 if(kind.startsWith('COMPANY_'))return {type:'COMPANY',id};
 if(kind.startsWith('GROUP_'))return {type:'GROUP',id,owner:payload.sector_id??null};
 if(kind.startsWith('MEMBERSHIP_'))return {type:'MEMBERSHIP',id,owner:payload.sector_id??null};
 return {type:'SECTOR',id};
}
export function recoveryFieldPairs(intent,current){
 return Object.entries(intent.args.p_payload).filter(([key])=>key!=='impact_sha256').map(([field,requested])=>({field,requested,current:current[field]??null}));
}
export function rebaseCatalogOrder(requested,current){
 if(!Array.isArray(requested)||!Array.isArray(current)||requested.some(x=>typeof x!=='string')||current.some(x=>typeof x!=='string')||new Set(current).size!==current.length)throw new Error('INVALID_RECOVERY_ORDER');
 return [...new Set(requested.filter(x=>current.includes(x))),...current.filter(x=>!requested.includes(x))];
}
export function sameRecoveryScope(intent,kind,entity,payload){
 const a=intent.args;
 if(a.p_kind!==kind||a.p_entity!==entity)return false;
 const keys=kind==='REORDER'?['scope','parent_id','subgroup_id']:kind==='SECTOR_KEYWORDS'?['keyword_kind']:entity===null&&['GROUP_CREATE','MEMBERSHIP_CREATE'].includes(kind)?['sector_id']:[];
 return keys.every(key=>(a.p_payload[key]??null)===(payload[key]??null));
}
