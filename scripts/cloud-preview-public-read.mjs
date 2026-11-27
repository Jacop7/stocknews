// Preview preparation only. Import performs no file I/O, network or listen.
import {createServer} from 'node:http';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readRoute} from './public-read-gateway.mjs';
import {catalogResponse,CatalogReadError} from './catalog/public-route.mjs';
import {searchResponse} from './catalog/search-route.mjs';
export const PROJECT='nxfpfvsdwbziowkxsxnh',UPSTREAM='https://'+PROJECT+'.supabase.co';
export const READ_RPCS=Object.freeze(['m1_public_identity','m1_public_article','catalog_public_tree','catalog_public_sector_page','catalog_public_articles','catalog_public_search_news','catalog_public_search_companies','catalog_public_saved','catalog_public_company_sectors','catalog_public_company'].sort());
// CLOUD10B: the exact probes that must be refused, and what counts as refused. A refusal is a permission error
// (42501) or "not exposed/not found" from the Data API (PGRST202 function, PGRST205 table), with 401/403/404.
// Validation errors (400), rate limits (429) and server errors (5xx) never count as proof of refusal.
export const DENIED_PROBES=Object.freeze(['rpc rls_auto_enable','rpc m1_prepare','rpc catalog_editor_tree','rpc m1_save_draft','rpc catalog_editor_company','table news_public']);
// One probe-specific exception, observed live on 2026-11-27: the managed event-trigger function rls_auto_enable is
// refused by PostgreSQL before its body runs (400, 0A000 "cannot display a value of type event_trigger").
export const deniedResponse=(status,code,name)=>[401,403,404].includes(status)&&['42501','PGRST202','PGRST205'].includes(code)||
 name==='rpc rls_auto_enable'&&status===400&&code==='0A000';
const root=fileURLToPath(new URL('../',import.meta.url));
const isolatedConfigs=new WeakSet();
class PreviewError extends Error{constructor(code,status=503){super(code);this.status=status;}}
const reject=(code,status)=>{throw new PreviewError(code,status);};
const sha=b=>createHash('sha256').update(b).digest('hex');
export function classifyPublicKey(key){
 if(typeof key!=='string'||key.length>2048)reject('PUBLIC_KEY_REQUIRED');
 if(/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key))return 'PUBLISHABLE';
 if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))reject('PUBLIC_KEY_REQUIRED');
 try{const [header,payload]=key.split('.').slice(0,2).map(x=>JSON.parse(Buffer.from(x,'base64url').toString('utf8')));if(header?.typ==='JWT'&&payload?.role==='anon')return 'LEGACY_ANON_JWT';}catch{}
 reject('PUBLIC_KEY_REQUIRED'); // Classification only; provider verifies JWT.
}
function validatedConfig(c){
 if(!c||c.productId!=='judoju-news'||c.environment!=='preview'||c.projectRef!==PROJECT||c.apiUrl!==UPSTREAM||c.mode!=='PREVIEW_SYNTHETIC'||!Array.isArray(c.webOrigins)||c.webOrigins.length>8||c.webOrigins.some(x=>!/^http:\/\/(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(x)||Number(new URL(x).port)>65535)||new Set(c.webOrigins).size!==c.webOrigins.length||['serviceKey','secretKey','accessToken','pat'].some(k=>Object.hasOwn(c,k)))reject('PREVIEW_CONFIG_REJECTED');
 const kind=classifyPublicKey(c.publicKey);return Object.freeze({...c,keyKind:kind,webOrigins:Object.freeze([...c.webOrigins])});
}
function readRegularPrivate(relative,privateRoot=root){
 const p=path.join(privateRoot,relative);let cursor=privateRoot;
 for(const part of relative.split('/')){cursor=path.join(cursor,part);const st=lstatSync(cursor);if(st.isSymbolicLink())reject('PREVIEW_CONFIG_REJECTED');}
 if(!realpathSync(p).startsWith(realpathSync(privateRoot)+path.sep)||!lstatSync(p).isFile())reject('PREVIEW_CONFIG_REJECTED');return readFileSync(p);
}
export function loadApprovedPreviewConfig(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='privateRoot'))reject('PREVIEW_CONFIG_REJECTED');
 const isolated=Object.hasOwn(options,'privateRoot');let privateRoot=root;
 if(isolated){
  privateRoot=options.privateRoot;
  if(typeof privateRoot!=='string'||!path.isAbsolute(privateRoot))reject('PREVIEW_CONFIG_REJECTED');
  try{
   privateRoot=path.resolve(privateRoot);let cursor=path.parse(privateRoot).root;
   for(const part of privateRoot.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);const st=lstatSync(cursor);if(st.isSymbolicLink()||!st.isDirectory())reject('PREVIEW_CONFIG_REJECTED');}
   if(realpathSync(privateRoot)!==privateRoot)reject('PREVIEW_CONFIG_REJECTED');
  }catch{reject('PREVIEW_CONFIG_REJECTED');}
 }

 // A has no B access proof. Reject before reading key configuration or fetching.
 let proofBytes,proof;
 try{proofBytes=readRegularPrivate('.local-data/cloud-preview/access-proof.json',privateRoot);proof=JSON.parse(proofBytes);}catch{reject('PREVIEW_READ_NOT_ACTIVATED');}
 const names=Array.isArray(proof.readRpcNames)?[...proof.readRpcNames].sort():[];
 if(proof.state!=='CLOUD10B_PUBLIC_READ_VERIFIED'||proof.productId!=='judoju-news'||proof.projectRef!==PROJECT||proof.environment!=='preview'||proof.dataApiEnabledObserved!==true||proof.writeGrants!==0||proof.M2!==false||proof.prodWrites!==0||JSON.stringify(names)!==JSON.stringify(READ_RPCS)||!(/^[a-f0-9]{64}$/).test(proof.userAuthorizationSha256??'')||!(/^[a-f0-9]{64}$/).test(proof.reviewedResultSha256??''))reject('PREVIEW_READ_NOT_ACTIVATED');
 // The proof binds files, not just hash-shaped strings (CLOUD10B review): the user's authorization text, the live
 // verification result and the tracked ACL inventory are re-read and re-hashed, and the live result must be a pass.
 try{
  const authorization=readRegularPrivate('.local-data/cloud-preview/user-authorization.txt',privateRoot),liveBytes=readRegularPrivate('.local-data/cloud-preview/live-result.json',privateRoot);
  const live=JSON.parse(liveBytes),inventory=readFileSync(path.join(root,'docs/cloud/cloud10b-acl-inventory.json'));
  if(sha(authorization)!==proof.userAuthorizationSha256||sha(liveBytes)!==proof.reviewedResultSha256||sha(inventory)!==proof.inventorySha256||authorization.length<10)throw 0;
  if(live.state!=='PASS'||live.projectRef!==PROJECT||JSON.stringify([...(live.allowed??[])].map(x=>x.name).sort())!==JSON.stringify(READ_RPCS)||live.allowed.some(x=>x.ok!==true||x.status!==200)||!Array.isArray(live.denied)||
   JSON.stringify(live.denied.map(x=>x.name))!==JSON.stringify(DENIED_PROBES)||live.denied.some(x=>!deniedResponse(x.status,x.code,x.name)))throw 0;
 }catch{reject('PREVIEW_READ_NOT_ACTIVATED');}
 let c;try{c=JSON.parse(readRegularPrivate('.local-data/cloud-preview/public-config.json',privateRoot));}catch{reject('PREVIEW_CONFIG_REJECTED');}
 if(c.proofSha256!==sha(proofBytes))reject('PREVIEW_CONFIG_REJECTED');const result=validatedConfig(c);if(isolated)isolatedConfigs.add(result);return result;
}
export function assertPreviewIdentity(value){
 if(!value||Object.keys(value).sort().join(',')!=='bootstrapId,contract,environment,productId,sampleKind'||value.productId!=='judoju-news'||value.environment!=='preview'||value.bootstrapId!==null||value.sampleKind!=='SYNTHETIC'||value.contract!=='M1')reject('PREVIEW_IDENTITY_MISMATCH');return value;
}
export function previewRoute(raw){
 let r;try{r=readRoute(raw);}catch(e){reject('INVALID_PUBLIC_ROUTE',[400,404,409].includes(e?.status)?e.status:400);}
 if(!READ_RPCS.includes(r.name))reject('ROUTE_NOT_ALLOWED',404);return r;
}
export async function previewUpstream(input,name,args,{fetchImpl=fetch}={}){
 if(isolatedConfigs.has(input)&&fetchImpl===fetch)reject('ISOLATED_CONFIG_REQUIRES_FIXTURE');
 const c=validatedConfig(input);if(!READ_RPCS.includes(name))reject('ROUTE_NOT_ALLOWED',404);
 const headers={apikey:c.publicKey,'Content-Type':'application/json'};if(c.keyKind==='LEGACY_ANON_JWT')headers.Authorization='Bearer '+c.publicKey;
 let response;try{response=await fetchImpl(c.apiUrl+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',cache:'no-store',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(7000)});}catch{reject('PREVIEW_READ_UNAVAILABLE');}
 const chunks=[];let size=0;
 try{for await(const chunk of response.body??[]){size+=chunk.length;if(size>262144){await response.body?.cancel().catch(()=>{});reject('PREVIEW_RESPONSE_TOO_LARGE',502);}chunks.push(chunk);}}catch(e){if(e instanceof PreviewError)throw e;reject('PREVIEW_READ_UNAVAILABLE');}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{reject('PREVIEW_RESPONSE_INVALID',502);}
 if(!response.ok){if(response.status===429)reject('RATE_LIMITED',429);if(value?.code==='P0001'&&['STALE_CATALOG','INVALID_CURSOR_CONTEXT','INVALID_SEARCH_CONTEXT'].includes(value.message))reject('STALE_PUBLIC_DATA',409);reject('PREVIEW_READ_UNAVAILABLE');}return value;
}
function previewResponse(route,raw){
 const value=route.search?searchResponse(route,raw):catalogResponse(route,raw);
 if(route.name==='catalog_public_tree'&&(!value||value.metadata_kind!=='USER_REFERENCE_UNVERIFIED'||!Array.isArray(value.parents)||value.parents.length>50||value.parents.some(x=>!Array.isArray(x.sectors))||value.parents.reduce((n,x)=>n+x.sectors.length,0)>200))reject('PREVIEW_RESPONSE_INVALID',502);
 if(route.name==='catalog_public_sector_page'){
  if(!value||!['AVAILABLE','NOT_FOUND'].includes(value.state)||route.args.p_expected!==null&&String(value.catalog_version)!==route.args.p_expected)reject('PREVIEW_RESPONSE_INVALID',502);
  if(value.state==='AVAILABLE'){
   if(value.metadata_kind!=='USER_REFERENCE_UNVERIFIED'||!Array.isArray(value.groups)||value.groups.length>100||value.groups.some(g=>!Array.isArray(g.members))||!Array.isArray(value.ungrouped_members))reject('PREVIEW_RESPONSE_INVALID',502);
   const members=[...value.ungrouped_members,...value.groups.flatMap(g=>g.members)];
   if(members.length>route.args.p_limit||members.some(x=>x.stock_identity_state!=='UNRESOLVED'||['stock_code','price','change_percent','stock_url'].some(k=>x[k]!==null)))reject('PREVIEW_RESPONSE_INVALID',502);
  }
 }
 if(route.name==='m1_public_article'&&(!value||!['PUBLISHED','NOT_FOUND','HIDDEN','WITHDRAWN','CORRECTION_PENDING'].includes(value.state)||value.state==='PUBLISHED'&&value.sample_kind!=='SYNTHETIC'))reject('PREVIEW_RESPONSE_INVALID',502);
 if(Buffer.byteLength(JSON.stringify(value))>262144)reject('PREVIEW_RESPONSE_TOO_LARGE',502);return value;
}
export async function createPreviewGateway(input,options={}){
 const {transport=previewUpstream,port=62331,now=Date.now,forwardedPeer=false}=options;
 // Hosted behind the local HTTPS proxy (Caddy on the same host): the proxy connects from 127.0.0.1 and overwrites
 // X-Forwarded-For with the client address, which then keys the per-client rate limit. Off by default.
 if(typeof forwardedPeer!=='boolean')reject('PREVIEW_CONFIG_REJECTED');
 if(Object.hasOwn(options,'privateRoot')||transport===previewUpstream&&isolatedConfigs.has(input))reject('ISOLATED_CONFIG_REQUIRES_FIXTURE');
 const c=validatedConfig(input);
 // Injected test transports are an instruction boundary, not an OS sandbox.
 if(transport===previewUpstream){const approved=loadApprovedPreviewConfig();if(JSON.stringify(approved)!==JSON.stringify(c))reject('PREVIEW_CONFIG_REJECTED');}
 if(!Number.isInteger(port)||port<0||port>65535)reject('PREVIEW_CONFIG_REJECTED');
 assertPreviewIdentity(await transport(c,'m1_public_identity',{}));
 let active=0,globalTimes=[];const peers=new Map();
 const server=createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',Vary:'Origin'};
  const send=(status,value,extra={})=>{if(res.destroyed)return;res.writeHead(status,{...headers,...extra});res.end(req.method==='HEAD'||status===204?undefined:JSON.stringify(value));};
  let bucket,acquired=false;
  try{
   const origin=req.headers.origin;if(origin!==undefined){if(!c.webOrigins.includes(origin))reject('ORIGIN_REJECTED',403);headers['Access-Control-Allow-Origin']=origin;}
   if(req.headers.host!=='127.0.0.1:'+server.address().port||req.socket.remoteAddress!=='127.0.0.1')reject('HOST_OR_PEER_REJECTED',403);
   if(req.headers.authorization||req.headers.cookie)reject('CLIENT_CREDENTIALS_REJECTED',403);
   if(req.headers['transfer-encoding']||req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')reject('REQUEST_BODY_REJECTED',400);
   if(req.method==='OPTIONS'){
    const method=req.headers['access-control-request-method'],requested=String(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
    if(!origin||!['GET','HEAD'].includes(method)||requested.some(x=>!['accept','cache-control','content-type'].includes(x)))reject('PREFLIGHT_REJECTED',403);
    send(204,null,{'Access-Control-Allow-Methods':'GET, HEAD','Access-Control-Allow-Headers':'Accept, Cache-Control, Content-Type'});return;
   }
   if(!['GET','HEAD'].includes(req.method))reject('METHOD_REJECTED',405);
   const forwarded=String(req.headers['x-forwarded-for']??'');
   if(forwardedPeer&&!/^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{2,39})$/i.test(forwarded))reject('HOST_OR_PEER_REJECTED',403);
   const route=previewRoute(req.url??''),at=now(),peer=forwardedPeer?forwarded:req.socket.remoteAddress;
   for(const [key,b]of peers)if(at-b.updated>60000&&b.active===0)peers.delete(key);
   if(!peers.has(peer)&&peers.size>=512)reject('RATE_LIMITED',429);
   bucket=peers.get(peer)??{times:[],tokens:12,updated:at,active:0};peers.set(peer,bucket);bucket.tokens=Math.min(12,bucket.tokens+(at-bucket.updated)/1000);bucket.updated=at;bucket.times=bucket.times.filter(t=>at-t<60000);globalTimes=globalTimes.filter(t=>at-t<60000);
   if(bucket.tokens<1||bucket.times.length>=60||globalTimes.length>=240||bucket.active>=3||active>=8)reject('RATE_LIMITED',429);
   bucket.tokens--;bucket.times.push(at);globalTimes.push(at);bucket.active++;active++;acquired=true;
   const raw=await transport(c,route.name,route.args),value=previewResponse(route,raw);send(200,{productId:'judoju-news',mode:'PREVIEW_SYNTHETIC',data:value});
  }catch(e){const known=e instanceof PreviewError||e instanceof CatalogReadError;send(known?e.status:503,{error:known?e.message:'PREVIEW_READ_UNAVAILABLE'},known&&e.status===429?{'Retry-After':'1'}:{});}
  finally{if(acquired){active--;bucket.active--;}}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;server.maxHeadersCount=30;
 await new Promise((resolve,rejectListen)=>{server.once('error',rejectListen);server.listen({host:'127.0.0.1',port,exclusive:true},resolve);});
 return {server,host:'127.0.0.1',port:server.address().port,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2)reject('UNSUPPORTED_ARGUMENT');const gateway=await createPreviewGateway(loadApprovedPreviewConfig());for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>gateway.close());console.log(JSON.stringify({component:'PREVIEW_PUBLIC_READ',productId:'judoju-news',mode:'PREVIEW_SYNTHETIC',host:gateway.host,port:gateway.port,privilegedKeyUsed:false}));
 }catch(e){console.error(e instanceof PreviewError?e.message:'PREVIEW_READ_UNAVAILABLE');process.exitCode=1;}
}
