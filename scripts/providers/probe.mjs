import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { permissionDecision,normalizeArticleUrl,instant } from './policy.mjs';
import { createProbeBudget } from './budget.mjs';

// Strict IPv6 acceptance: global-unicast 2000::/3 only, excluding documentation space.
// IPv4 mapped/tunnel/special ranges fail closed rather than relying on textual hostname checks.
export function publicAddress(address){
  if(isIP(address)===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^200[12]:/i.test(address);
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
async function abortable(promise,signal){
  if(signal.aborted)throw new Error('REQUEST_TIMEOUT');
  let abort;
  const stopped=new Promise((_,reject)=>{abort=()=>reject(new Error('REQUEST_TIMEOUT'));signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([promise,stopped]);}finally{signal.removeEventListener('abort',abort);}
}
export async function pinnedHttps(url,{timeoutMs,maxBytes,signal}){
  const host=new URL(url).hostname;
  const answers=isIP(host)?[{address:host,family:isIP(host)}]:await abortable(dns.lookup(host,{all:true}),signal);
  if(!answers.length||answers.some(x=>!publicAddress(x.address)))throw new Error('NON_PUBLIC_DNS');
  const selected=answers[0];
  return await new Promise((resolve,reject)=>{
    const req=https.request(url,{method:'GET',signal,headers:{'User-Agent':'JudojuNews-ProviderProbe/0.1'},lookup:(_host,options,cb)=>options.all?cb(null,[selected]):cb(null,selected.address,selected.family)},res=>{
      let bytes=0;const parts=[];
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){res.destroy(new Error('RESPONSE_TOO_LARGE'));return;}parts.push(chunk);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location??null,retryAfter:res.headers['retry-after']??null,contentType:res.headers['content-type']??null,body:Buffer.concat(parts)}));
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('REQUEST_TIMEOUT')));req.on('error',reject);req.end();
  });
}
export async function probe({endpoint,profile,purposes=['DISCOVERY','MACHINE_ACCESS'],execute=false,now=()=>new Date().toISOString(),transport=pinnedHttps,lookupHost=dns.lookup,budget=createProbeBudget(),limits={timeoutMs:5000,maxBytes:262144,maxHops:2}}){
  const started=instant(now());let requests=0,url;
  const result=(status,reason,extra={})=>({endpointId:endpoint.endpoint_id,status,reason,requests,observedAt:now(),latencyMs:requests?instant(now())-started:null,policyVersion:'source-policy-v1',...extra});
  if(!Array.isArray(purposes)||!purposes.some(x=>x==='DISCOVERY'||x==='ORIGINAL_ACCESS'))return result('BLOCKED','OPERATION_PURPOSE_REQUIRED');
  const requiredPurposes=[...new Set(['MACHINE_ACCESS',...purposes])];
  const denied=permissionDecision(profile,endpoint,requiredPurposes,now());if(denied)return result('BLOCKED',denied);
  try{url=normalizeArticleUrl(endpoint.url);}catch{return result('BLOCKED','UNSAFE_URL');}
  const timeoutMs=Math.min(limits.timeoutMs,profile.timeout_ms),maxBytes=Math.min(limits.maxBytes,profile.max_bytes);
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(maxBytes)||maxBytes<=0||!Number.isInteger(profile.max_requests)||profile.max_requests<=0||!profile.methods?.includes('GET'))return result('BLOCKED','BUDGET_UNVERIFIED');
  if(!execute)return result('DRY_RUN','NO_NETWORK');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    for(let hop=0;hop<=limits.maxHops;hop++){
      const gate=permissionDecision(profile,endpoint,requiredPurposes,now());if(gate)return result('BLOCKED',gate);
      const u=new URL(url),host=u.hostname.toLowerCase();
      if(!profile.allowed_hosts?.includes(host))return result('BLOCKED','HOST_NOT_ALLOWED');
      // Transport also pins a fresh resolution, closing DNS-rebinding between check and connect.
      const answers=isIP(host)?[{address:host}]:await abortable(lookupHost(host,{all:true}),controller.signal);
      if(!answers.length||answers.some(x=>!publicAddress(x.address)))return result('BLOCKED','NON_PUBLIC_DNS');
      if(requests>=profile.max_requests)return result('BLOCKED','REQUEST_BUDGET_EXHAUSTED');
      const release=budget.acquire(host);if(!release)return result('BLOCKED','CONCURRENCY_LIMIT');
      let response;
      try{
        if(!budget.consume(host))return result('BLOCKED','REQUEST_BUDGET_EXHAUSTED');
        requests++;response=await abortable(transport(url,{timeoutMs,maxBytes,signal:controller.signal}),controller.signal);
      }finally{release();}
      if(!Buffer.isBuffer(response.body)||response.body.length>maxBytes)return result('FAILED','RESPONSE_TOO_LARGE');
      if([301,302,303,307,308].includes(response.status)){
        if(hop===limits.maxHops)return result('FAILED','REDIRECT_LIMIT');
        if(!response.location)return result('FAILED','REDIRECT_LOCATION_MISSING');
        try{url=normalizeArticleUrl(new URL(response.location,url).toString());}catch{return result('BLOCKED','UNSAFE_REDIRECT');}
        continue;
      }
      // No raw body/URL credentials/API keys are returned or persisted by the probe.
      return result(response.status>=200&&response.status<300?'HTTP_OK_UNPARSED':'HTTP_FAILED','NOT_PARSER_OR_SUPPLY_APPROVAL',{httpStatus:response.status,bytes:response.body.length,bodySha256:createHash('sha256').update(response.body).digest('hex'),contentType:response.contentType??null,retryAfter:response.retryAfter??null});
    }
    return result('FAILED','REDIRECT_LIMIT');
  }catch(error){return result('FAILED',['NON_PUBLIC_DNS','RESPONSE_TOO_LARGE','REQUEST_TIMEOUT'].includes(error.message)?error.message:controller.signal.aborted?'REQUEST_TIMEOUT':'TRANSPORT_ERROR');}
  finally{clearTimeout(timer);}
}
