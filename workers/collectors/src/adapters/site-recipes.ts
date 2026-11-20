/** Node-only declaration descriptor. No approved adapter or executable recipe exists in P1. */
import {PipelineError,pipelineData,pipelineId} from '../../../../packages/contracts/src/pipeline.ts';

export const BLOCKED_SITE_RECIPE_P1='BLOCKED_SITE_RECIPE_P1' as const;
export const DECLARED_PURPOSES=['DISCOVERY','LINK_EXTRACTION','QUERY_TERMS','ORIGINAL_ACCESS','STORAGE','ANALYSIS','DISPLAY','MACHINE_ACCESS'] as const;
export const DECLARED_ENDPOINT_STATES=['RIGHTS_HOLD','TECH_TEST','SHADOW','ACTIVE','PAUSED_ERROR','PAUSED_ACCESS','PAUSED_RATE_LIMIT','DISABLED'] as const;
export const DECLARED_PERMISSION_STATES=['UNVERIFIED','VERIFIED','EXPIRED','REVOKED','DENIED'] as const;
export interface BlockedRecipeInput {
  endpointId:string;permissionProfileId:string;permissionStatus:string;endpointStatus:string;
  adapterVersion:string|null;navigationPath:unknown;tabRecipe:unknown;purposes:Record<string,string>;
}
export interface BlockedSiteRecipe {
  schema:typeof BLOCKED_SITE_RECIPE_P1;dataKind:'DECLARED_CONFIG_ONLY';endpointId:string;
  permissionProfileId:string;status:'BLOCKED';executionEnabled:false;reasons:string[];
}
const bad=():never=>{throw new PipelineError('INVALID_INPUT');};
/** Always blocked, including VERIFIED declarations. Strings and objects are never evaluated. */
export function resolveBlockedSiteRecipe(raw:unknown):BlockedSiteRecipe {
  const input=pipelineData(raw);
  if(!input||typeof input!=='object'||Array.isArray(input))bad();
  const v=input as Record<string,unknown>;
  const fields=['endpointId','permissionProfileId','permissionStatus','endpointStatus','adapterVersion','navigationPath','tabRecipe','purposes'];
  if(Object.keys(v).length!==fields.length||fields.some(k=>!Object.hasOwn(v,k))||!pipelineId(v.endpointId)||!pipelineId(v.permissionProfileId)
    ||!DECLARED_PERMISSION_STATES.includes(v.permissionStatus as typeof DECLARED_PERMISSION_STATES[number])
    ||!DECLARED_ENDPOINT_STATES.includes(v.endpointStatus as typeof DECLARED_ENDPOINT_STATES[number])
    ||v.adapterVersion!==null&&!pipelineId(v.adapterVersion))bad();
  for(const field of ['navigationPath','tabRecipe'])if(v[field]!==null&&typeof v[field]!=='string'&&typeof v[field]!=='object')bad();
  if(!v.purposes||typeof v.purposes!=='object'||Array.isArray(v.purposes))bad();
  const purposes=v.purposes as Record<string,unknown>;
  if(Object.keys(purposes).length!==DECLARED_PURPOSES.length||DECLARED_PURPOSES.some(k=>!['ALLOW','DENY','UNKNOWN'].includes(purposes[k] as string)))bad();
  const reasons=['NO_SEPARATELY_REVIEWED_ADAPTER','SELECTOR_RECIPE_UNAPPROVED','RIGHTS_VALIDITY_NOT_EVALUATED'];
  if(v.permissionStatus!=='VERIFIED')reasons.push('RIGHTS_UNVERIFIED');
  if(!['TECH_TEST','SHADOW','ACTIVE'].includes(v.endpointStatus as string))reasons.push('SOURCE_NOT_RUNNABLE');
  reasons.push(v.adapterVersion===null?'ADAPTER_VERSION_UNCONFIRMED':'ADAPTER_VERSION_UNAPPROVED');
  reasons.push(v.navigationPath===null?'NAVIGATION_RECIPE_MISSING':'NAVIGATION_RECIPE_UNAPPROVED');
  reasons.push(v.tabRecipe===null?'TAB_RECIPE_MISSING':'TAB_RECIPE_UNAPPROVED');
  for(const purpose of DECLARED_PURPOSES)if(purposes[purpose]!=='ALLOW')reasons.push('PURPOSE_NOT_ALLOWED:'+purpose);
  return {schema:BLOCKED_SITE_RECIPE_P1,dataKind:'DECLARED_CONFIG_ONLY',endpointId:v.endpointId as string,
    permissionProfileId:v.permissionProfileId as string,status:'BLOCKED',executionEnabled:false,reasons:reasons.sort()};
}
