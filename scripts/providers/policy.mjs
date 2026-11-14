import { createHash } from 'node:crypto';
export const POLICY_VERSION='source-policy-v1';
export const PURPOSES=['DISCOVERY','LINK_EXTRACTION','QUERY_TERMS','ORIGINAL_ACCESS','STORAGE','ANALYSIS','DISPLAY','MACHINE_ACCESS'];
export function instant(value){const n=new Date(value).getTime();if(!Number.isFinite(n))throw new TypeError('Invalid instant');return n;}
export function permissionDecision(profile,endpoint,purposes,now){
  const t=instant(now);
  if(!profile||profile.id!==endpoint.permission_profile_id||profile.version!==endpoint.permission_profile_version||profile.endpoint_id!==endpoint.endpoint_id)return 'PERMISSION_BINDING_MISMATCH';
  if(profile.status!=='VERIFIED'||!profile.evidence?.length||!profile.verified_at||!profile.expires_at||profile.revoked_at)return 'RIGHTS_UNVERIFIED';
  if(instant(profile.verified_at)>t||instant(profile.expires_at)<=t)return 'RIGHTS_EXPIRED';
  if(!purposes.length||purposes.some(x=>!PURPOSES.includes(x)||profile.purposes?.[x]!=='ALLOW'))return 'PURPOSE_NOT_ALLOWED';
  if(!['TECH_TEST','SHADOW','ACTIVE'].includes(endpoint.status))return 'SOURCE_NOT_RUNNABLE';
  return null;
}
export function normalizeArticleUrl(input){
  const u=new URL(input);
  if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw new Error('UNSAFE_URL');
  u.hash='';for(const key of [...u.searchParams.keys()])if(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid'].includes(key))u.searchParams.delete(key);
  return u.toString();
}
export const identityForUrl=url=>createHash('sha256').update(normalizeArticleUrl(url)).digest('hex');

// Inputs are link entities and minimal catalog terms from a separately permitted connector.
// This function neither reads Telegram messages nor calls a search provider.
export function discoveryPlan({endpoint,profile,now,links=[],catalogTerms=[],linksResolved=false,originalFound=false}){
  const denied=permissionDecision(profile,endpoint,['MACHINE_ACCESS','DISCOVERY','LINK_EXTRACTION'],now);
  if(denied)return {action:'RIGHTS_HOLD',reason:denied,requests:[],canPublish:false};
  const urls=[];for(const link of links){try{const normalized=normalizeArticleUrl(link);if(!urls.includes(normalized))urls.push(normalized);}catch{/* unsafe links do not become fetches */}}
  if(originalFound)return {action:'ORIGINAL_FOUND',requests:[],canPublish:false,reason:'ORIGINAL_REQUIRES_OWN_PERMISSION_AND_EVIDENCE'};
  if(urls.length&&!linksResolved)return {action:'RESOLVE_LINKS',requests:urls.map(url=>({url,kind:'ORIGINAL_CANDIDATE'})),canPublish:false};
  const queryDenied=permissionDecision(profile,endpoint,['MACHINE_ACCESS','DISCOVERY','QUERY_TERMS'],now);
  if(queryDenied)return {action:'RIGHTS_HOLD',reason:queryDenied,requests:[],canPublish:false};
  // Only explicit short catalog terms; full message bodies are never accepted as a query.
  if(!catalogTerms.length||catalogTerms.length>4||catalogTerms.some(x=>typeof x!=='string'||!x.trim()||x.length>40||/[\r\n]/.test(x)))return {action:'HOLD',reason:'NO_VALID_MINIMAL_QUERY',requests:[],canPublish:false};
  return {action:'SEARCH_ORIGINAL',query:[...new Set(catalogTerms.map(x=>x.trim()))].join(' '),queue:'SEARCH_QUERY',originRule:'PLATFORM_RESOLVE',requests:[],canPublish:false,reason:'SEARCH_PROVIDER_AND_ORIGINAL_PERMISSION_REQUIRED'};
}
export function listingResult({complete,atLimit,tabVerified,missingRange,previousCheckpoint,nextCheckpoint}){
  if(!tabVerified)return {status:'FAILED',checkpoint:previousCheckpoint,reason:'TAB_UNVERIFIED'};
  if(!complete||atLimit)return {status:'PARTIAL',checkpoint:previousCheckpoint,missingRange:missingRange??'UNKNOWN'};
  return {status:'COMPLETE',checkpoint:nextCheckpoint};
}
export function reportDecision(route,itemType){return route.effective_kind==='REPORT_BOT'?'BOT_ADAPTER_REQUIRED':route.content_filter==='COMPANY_ONLY'&&itemType!=='COMPANY'?'PASS':'COLLECT_IF_PERMITTED';}
export function configChangeDecision({status,newEndpoint,permissionChanged}){return newEndpoint||permissionChanged?{action:'REGISTER_DISABLED',nextState:'RIGHTS_HOLD'}:status==='ACTIVE'?{action:'NEXT_CYCLE',nextState:'ACTIVE'}:{action:'HOLD',nextState:status};}

export function shadowEligible(m){return ['tradingDays','successfulLists','permittedBodies','unresolvedCritical','attemptedLists'].every(k=>Number.isInteger(m[k])&&m[k]>=0)&&m.successfulLists<=m.attemptedLists&&m.tradingDays>=5&&m.successfulLists>=10&&m.permittedBodies>=1&&m.unresolvedCritical===0&&m.attemptedLists>0&&m.successfulLists/m.attemptedLists>=.95;}
export function recoveryDecision(s,now){
  const t=instant(now);
  if(s.state==='DISABLED')return {state:'DISABLED',action:'STOP'};
  if(s.explicitAuthOrPayment||s.rightsDenied||s.permissionExpired)return {state:s.rightsDenied||s.permissionExpired?'RIGHTS_HOLD':'PAUSED_ACCESS',action:'NO_AUTO_PROBE'};
  if(s.permanentlyClosed)return {state:'DISABLED',action:'STOP'};
  if(s.permissionValid!==true)return {state:'RIGHTS_HOLD',action:'NO_AUTO_PROBE'};
  if(s.qualityIssue)return {state:'SHADOW',action:'QUALITY_REVALIDATE'};
  if(s.versionsChanged)return {state:'TECH_TEST',action:'NEW_TECH_TEST'};
  if(s.isNew||s.state==='SHADOW'){
    if(s.state!=='SHADOW'||s.techVerified!==true)return {state:'TECH_TEST',action:'NEW_TECH_TEST'};
    return {state:shadowEligible(s.metrics??{})?'ACTIVE':'SHADOW',action:'SHADOW_QUALIFY'};
  }
  if(!['PAUSED_ERROR','PAUSED_ACCESS','PAUSED_RATE_LIMIT'].includes(s.state))return {state:s.state,action:'NO_RECOVERY_TRANSITION'};
  if(s.versionsUnchanged!==true)return {state:s.state,action:'NO_AUTO_PROBE',reason:'RESUME_VERSION_UNVERIFIED'};
  // Episode counters remain separate and never reset at midnight.
  const attempts=s.reprobeCount??0,fastRetries=s.fastRetryCount??0;
  if(![attempts,fastRetries].every(x=>Number.isInteger(x)&&x>=0))throw new Error('INVALID_RECOVERY_COUNTER');
  const lowSince=s.lowFrequencySince?instant(s.lowFrequencySince):attempts>=3?Math.max(instant(s.lastProbeAt??s.pausedAt)+86400_000,s.retryAfter?instant(s.retryAfter):0):null;
  if(lowSince!==null&&t>=lowSince+14*86400_000)return {state:'DISABLED',action:'STOP'};
  if(lowSince!==null&&!s.lowFrequencySince)return {state:s.state,action:'ENTER_LOW_FREQUENCY',since:new Date(lowSince).toISOString(),nextAt:new Date(lowSince).toISOString()};
  if(s.retryAfter&&t<instant(s.retryAfter))return {state:s.state,action:'WAIT',nextAt:new Date(instant(s.retryAfter)).toISOString()};
  const events=(s.healthyChecks??[]).map(instant).filter(x=>x<=t&&s.pausedAt&&x>=Math.max(instant(s.pausedAt),s.retryAfter?instant(s.retryAfter):0)).sort((a,b)=>a-b);
  if(['ACTIVE','SHADOW'].includes(s.resumeState)&&events.length>=2&&events.at(-1)-events.at(-2)>=300_000&&s.fieldsValid===true&&s.permissionValid===true)return {state:s.resumeState,action:'RESUME'};
  if(s.lowFrequencySince){
    const since=instant(s.lowFrequencySince);
    if(t>=since+14*86400_000)return {state:'DISABLED',action:'STOP'};
    const next=Math.max(s.lastProbeAt?instant(s.lastProbeAt)+86400_000:since,s.retryAfter?instant(s.retryAfter):0);
    return {state:s.state,action:t>=next?'PROBE_ONCE':'WAIT',nextAt:new Date(next).toISOString(),mode:'LOW_FREQUENCY'};
  }
  const delays=s.state==='PAUSED_ACCESS'?[60,360,1440]:s.state==='PAUSED_RATE_LIMIT'?[1,5,15]:fastRetries<3?[1,5,15]:[60,360,1440];
  const index=s.state==='PAUSED_ERROR'&&fastRetries<3?fastRetries:attempts;
  const next=Math.max(instant(s.lastProbeAt??s.pausedAt)+delays[Math.min(index,2)]*60_000,s.retryAfter?instant(s.retryAfter):0);
  return {state:s.state,action:t>=next?'PROBE_ONCE':'WAIT',nextAt:new Date(next).toISOString()};
}
function local(iso,timeZone){const p=new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(iso));return Number(p.find(x=>x.type==='hour').value)*60+Number(p.find(x=>x.type==='minute').value);}
export function intervalMinutes(kind,now,{koreanTradingDay,usSession,announcementAt,announcementAllowed=false}={}){
  const t=instant(now),minute=local(now,'Asia/Seoul');
  if(kind==='GLOBAL'){if(usSession==='UNKNOWN'||usSession===undefined)return null;return usSession&&t>=instant(usSession.opensAt)-3600_000&&t<instant(usSession.closesAt)+7200_000?5:10;}
  if(typeof koreanTradingDay!=='boolean')return null;
  switch(kind){
    case 'N_STOCK':return !koreanTradingDay?15:minute>=360&&minute<540?5:minute>=540&&minute<930?2:minute>=930&&minute<1200?5:15;
    case 'N_MACRO':return announcementAllowed&&announcementAt&&t>=instant(announcementAt)-600_000&&t<instant(announcementAt)+1200_000?1:koreanTradingDay?5:10;
    case 'N_DISCOVERY':return koreanTradingDay?10:30;
    case 'REPORT':case 'REPORT_BOT':return koreanTradingDay&&minute>=360&&minute<1200?10:30;
    case 'TELEGRAM_EVENT':return koreanTradingDay?10:30;
    case 'GLOBAL':if(usSession==='UNKNOWN'||usSession===undefined)return null;return usSession&&t>=instant(usSession.opensAt)-3600_000&&t<instant(usSession.closesAt)+7200_000?5:10;
    default:throw new Error('UNKNOWN_SCHEDULE_CLASS');
  }
}
export function systemicMacroDecision({officialOriginal=false,independentOrigins=[],koreaPathVerified,current,storyLockAcquired}){
  if(!current||!koreaPathVerified)return 'HOLD';
  if(officialOriginal)return storyLockAcquired?'COMPARE_EXISTING_ISSUE':'REQUIRES_MACRO_ALL_LOCK';
  if(independentOrigins.length>128)return 'HOLD';
  const identifiers=['originGroupId','newsroomId','ownerGroupId'];
  const resolved=independentOrigins.filter(x=>x.originVerified===true&&x.newsroomVerified===true&&x.ownerGroupVerified===true&&identifiers.every(k=>typeof x[k]==='string'&&x[k].trim()));
  // Unknown ownership/editorial provenance never counts. Seek a mutually independent
  // triple, rather than greedily treating each distinct URL or publisher ID as evidence.
  let independentThree=false;
  for(let i=0;i<resolved.length&&!independentThree;i++)for(let j=i+1;j<resolved.length&&!independentThree;j++)for(let k=j+1;k<resolved.length;k++){
    if(identifiers.every(id=>new Set([resolved[i][id],resolved[j][id],resolved[k][id]]).size===3)){independentThree=true;break;}
  }
  if(!independentThree)return 'HOLD';
  return storyLockAcquired?'COMPARE_EXISTING_ISSUE':'REQUIRES_MACRO_ALL_LOCK';
}
