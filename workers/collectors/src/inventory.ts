/** Node-only bounded declaration compiler. Does not acquire, authorize, read files or run recipes. */
import {PipelineError,pipelineData,pipelineId,pipelineInstant} from '../../../packages/contracts/src/pipeline.ts';
import {DECLARED_PURPOSES,DECLARED_ENDPOINT_STATES,DECLARED_PERMISSION_STATES,resolveBlockedSiteRecipe,type BlockedSiteRecipe} from './adapters/site-recipes.ts';

export const SYNTHETIC_COLLECTOR_INVENTORY_P1='SYNTHETIC_COLLECTOR_INVENTORY_P1' as const;
export const INVENTORY_SOURCE_POLICY_VERSION='source-policy-v1' as const;
type RecordData=Record<string,unknown>;
export interface InventoryEndpoint {endpoint:RecordData;permissionProfile:RecordData;recipe:BlockedSiteRecipe;}
export interface InventorySource {sourceId:string;source:RecordData;route:RecordData;endpoints:InventoryEndpoint[];}
export interface CollectorInventory {
  schema:typeof SYNTHETIC_COLLECTOR_INVENTORY_P1;schemaVersion:1;sourcePolicyVersion:typeof INVENTORY_SOURCE_POLICY_VERSION;
  dataKind:'DECLARED_CONFIG_ONLY';executionEnabled:false;registryProvenance:RecordData;
  sourceCount:number;endpointCount:number;profileCount:number;sources:InventorySource[];
}
function bad():never {throw new PipelineError('INVALID_INPUT');}
const record=(v:unknown):RecordData=>{if(!v||typeof v!=='object'||Array.isArray(v))bad();return v as RecordData;};
const exact=(v:RecordData,keys:string[]):void=>{if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))bad();};
const text=(v:unknown,max=2048):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&v.trim()===v;
const label=(v:unknown):boolean=>typeof v==='string'&&v.trim().length>0&&v.length<=2048;
const integer=(v:unknown,min=0):boolean=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const oneOf=(v:unknown,values:readonly string[]):void=>{if(typeof v!=='string'||!values.includes(v))bad();};
const list=(v:unknown,max:number,nonempty=false):unknown[]=>{if(!Array.isArray(v)||v.length>max||nonempty&&!v.length)bad();return v as unknown[];};
const strings=(v:unknown,max=1000):string[]=>{const a=list(v,max);if(!a.every(x=>text(x))||new Set(a).size!==a.length)bad();return a as string[];};
const ids=(v:unknown,max=1000):string[]=>{const a=strings(v,max);if(!a.every(pipelineId))bad();return a;};
const nullableId=(v:unknown):void=>{if(v!==null&&!pipelineId(v))bad();};
const recipeDeclaration=(v:unknown):void=>{if(v!==null&&typeof v!=='string'&&typeof v!=='object')bad();};
const url=(v:unknown):void=>{
  if(!text(v))bad();let parsed:URL;try{parsed=new URL(v as string);}catch{bad();}
  // Existing rows 58/59 declare HTTP. Preserve that fact; this is never a request URL policy.
  if(!['http:','https:'].includes(parsed!.protocol)||parsed!.username||parsed!.password||parsed!.port)bad();
};
const uniqueMap=(rows:RecordData[],key:string):Map<unknown,RecordData>=>{
  const map=new Map<unknown,RecordData>();for(const row of rows){if(map.has(row[key]))bad();map.set(row[key],row);}return map;
};
const markets=['한국주식','미국주식','중국주식','해외주식'];
const sourceTypes=['뉴스','리포트','텔레그램'];

function validateEndpoint(v:RecordData):void {
  exact(v,['endpoint_id','url','source_ids','publisher_id','owner_group_id','origin_group_id','navigation_path','tab_recipe','adapter_version','enabled_scopes','checkpoint','overlap_window_minutes','correction_watch','max_rps','timeout_ms','concurrency','health_state','permission_profile_id','permission_profile_version','status','blocked_reasons','config_version']);
  if(!pipelineId(v.endpoint_id)||!pipelineId(v.permission_profile_id)||!pipelineId(v.permission_profile_version)||!pipelineId(v.config_version))bad();
  url(v.url);if(ids(v.source_ids).length!==1)bad();
  for(const k of ['publisher_id','owner_group_id','origin_group_id','adapter_version'])nullableId(v[k]);
  recipeDeclaration(v.navigation_path);recipeDeclaration(v.tab_recipe);recipeDeclaration(v.checkpoint);
  const scopes=strings(v.enabled_scopes);if(scopes.some(x=>!DECLARED_PURPOSES.includes(x as typeof DECLARED_PURPOSES[number])))bad();
  if(!integer(v.overlap_window_minutes))bad();
  for(const k of ['max_rps','timeout_ms','concurrency'])if(v[k]!==null&&(typeof v[k]!=='number'||!Number.isFinite(v[k])||Number(v[k])<=0))bad();
  const watch=record(v.correction_watch);exact(watch,['status','reason']);oneOf(watch.status,['PENDING','VERIFIED','DISABLED']);if(!text(watch.reason))bad();
  oneOf(v.health_state,['NOT_TESTED','HEALTHY','DEGRADED','FAILED']);oneOf(v.status,DECLARED_ENDPOINT_STATES);strings(v.blocked_reasons);
}
function validateProfile(v:RecordData):void {
  exact(v,['id','version','endpoint_id','status','subject','evidence','verified_at','expires_at','revoked_at','purposes','allowed_hosts','methods','max_requests','max_bytes','timeout_ms','retention_days','contract_id','credential_status']);
  if(!pipelineId(v.id)||!pipelineId(v.endpoint_id)||!pipelineId(v.version))bad();oneOf(v.status,DECLARED_PERMISSION_STATES);
  if(v.subject!==null&&!text(v.subject))bad();list(v.evidence,300);
  for(const k of ['verified_at','expires_at','revoked_at'])if(v[k]!==null&&!Number.isFinite(pipelineInstant(v[k])))bad();
  const purposes=record(v.purposes);exact(purposes,[...DECLARED_PURPOSES]);for(const k of DECLARED_PURPOSES)oneOf(purposes[k],['ALLOW','DENY','UNKNOWN']);
  strings(v.allowed_hosts);for(const method of strings(v.methods))oneOf(method,['GET','HEAD','POST']);
  for(const k of ['max_requests','max_bytes','timeout_ms'])if(!integer(v[k]))bad();
  if(v.retention_days!==null&&!integer(v.retention_days))bad();nullableId(v.contract_id);
  oneOf(v.credential_status,['NOT_CONFIGURED','CONFIGURED','NOT_REQUIRED','EXPIRED','REVOKED']);
}

/**
 * Inputs are three separate schema-v1 documents. Each keeps pipelineData's original
 * depth/node/JSON limits; combining their 112 profiles/endpoints before cloning
 * would wrongly reject the current complete registry. No limits are widened.
 * URL matching is exact and positional, without normalization or silent removal.
 * A successful compilation attests consistency of declarations, not permission.
 */
export function compileCollectorInventory(rawRegistry:unknown,rawRoutes:unknown,rawProfiles:unknown):CollectorInventory {
  const registry=record(pipelineData(rawRegistry)),routesDoc=record(pipelineData(rawRoutes)),profilesDoc=record(pipelineData(rawProfiles));
  exact(registry,['schema_version','product_id','source_locator','original_sha256','original_bytes','rows_canonical_sha256','sources']);
  exact(routesDoc,['schema_version','policy_version','routes','endpoints']);exact(profilesDoc,['schema_version','profiles']);
  if(registry.schema_version!==1||routesDoc.schema_version!==1||profilesDoc.schema_version!==1||registry.product_id!=='judoju-news'||routesDoc.policy_version!==INVENTORY_SOURCE_POLICY_VERSION)bad();
  if(!text(registry.source_locator)||!integer(registry.original_bytes,1)||![registry.original_sha256,registry.rows_canonical_sha256].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)))bad();
  const sources=list(registry.sources,300,true).map(record),routes=list(routesDoc.routes,300,true).map(record),endpoints=list(routesDoc.endpoints,1000,true).map(record),profiles=list(profilesDoc.profiles,1000,true).map(record);
  for(const source of sources){
    // Registry labels are original display data (row 69 includes a leading category space).
    exact(source,['row','market','name','type','category','urls']);if(!integer(source.row,1)||!label(source.name)||!label(source.category))bad();
    oneOf(source.market,markets);oneOf(source.type,sourceTypes);const urls=strings(source.urls);if(!urls.length)bad();for(const u of urls)url(u);
  }
  for(const route of routes){
    exact(route,['source_id','original_row','endpoint_ids','schedule_class','origin_resolution_rule','effective_kind','content_filter','independence_status','source_type','market']);
    if(!pipelineId(route.source_id)||!integer(route.original_row,1)||!ids(route.endpoint_ids).length)bad();
    oneOf(route.market,markets);oneOf(route.source_type,sourceTypes);oneOf(route.schedule_class,['GLOBAL','N_DISCOVERY','N_MACRO','N_STOCK','REPORT','REPORT_BOT','TELEGRAM_EVENT']);
    oneOf(route.origin_resolution_rule,['BOT_REPORT','NEWSROOM_VERIFY','PLATFORM_RESOLVE','RESEARCH_ORIGIN','SYNDICATION_RESOLVE']);
    oneOf(route.effective_kind,['NEWS','REPORT','REPORT_BOT','TELEGRAM']);oneOf(route.content_filter,['AS_REGISTERED','COMPANY_AND_INDUSTRY','COMPANY_ONLY']);oneOf(route.independence_status,['UNRESOLVED','VERIFIED']);
  }
  for(const endpoint of endpoints)validateEndpoint(endpoint);for(const profile of profiles)validateProfile(profile);
  uniqueMap(sources,'row');uniqueMap(routes,'source_id');const routeByRow=uniqueMap(routes,'original_row'),endpointById=uniqueMap(endpoints,'endpoint_id'),profileById=uniqueMap(profiles,'id'),profileByEndpoint=uniqueMap(profiles,'endpoint_id');
  if(routes.length!==sources.length||profiles.length!==endpoints.length)bad();
  const usedEndpoints=new Set<string>(),usedProfiles=new Set<string>();
  const inventorySources=sources.map(source=>{
    const route=routeByRow.get(source.row);if(!route||route.source_type!==source.type||route.market!==source.market)bad();
    const sourceId=route.source_id as string,endpointIds=route.endpoint_ids as string[],urls=source.urls as string[];
    if(sourceId!=='S'+String(source.row).padStart(3,'0')||endpointIds.length!==urls.length)bad();
    const joined=endpointIds.map((endpointId,index)=>{
      const endpoint=endpointById.get(endpointId);if(!endpoint||usedEndpoints.has(endpointId)||endpoint.url!==urls[index]||(endpoint.source_ids as string[])[0]!==sourceId)bad();
      usedEndpoints.add(endpointId);const profile=profileById.get(endpoint.permission_profile_id);
      if(!profile||usedProfiles.has(profile.id as string)||profile.endpoint_id!==endpointId||profileByEndpoint.get(endpointId)!==profile||profile.version!==endpoint.permission_profile_version)bad();
      usedProfiles.add(profile.id as string);
      const recipe=resolveBlockedSiteRecipe({endpointId,permissionProfileId:profile.id,permissionStatus:profile.status,endpointStatus:endpoint.status,
        adapterVersion:endpoint.adapter_version,navigationPath:endpoint.navigation_path,tabRecipe:endpoint.tab_recipe,purposes:profile.purposes});
      return {endpoint,permissionProfile:profile,recipe};
    });
    return {sourceId,source,route,endpoints:joined};
  });
  if(usedEndpoints.size!==endpoints.length||usedProfiles.size!==profiles.length)bad();
  const {sources:_sources,...registryProvenance}=registry;
  return {schema:SYNTHETIC_COLLECTOR_INVENTORY_P1,schemaVersion:1,sourcePolicyVersion:INVENTORY_SOURCE_POLICY_VERSION,dataKind:'DECLARED_CONFIG_ONLY',executionEnabled:false,
    registryProvenance,sourceCount:sources.length,endpointCount:endpoints.length,profileCount:profiles.length,sources:inventorySources};
}
