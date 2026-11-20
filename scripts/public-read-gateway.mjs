import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import {catalogRoute,catalogResponse,CatalogReadError} from './catalog/public-route.mjs';
import {searchRoute,searchResponse} from './catalog/search-route.mjs';
import {createHomePublicReader} from './home-public-read.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
class ReadError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export function publicConfig(){const c=JSON.parse(readFileSync(path.join(root,'.local-data/runtime/public-read.json'),'utf8'));if(c.productId!=='judoju-news'||c.environment!=='local'||c.sampleKind!=='SYNTHETIC'||c.apiUrl!=='http://127.0.0.1:62321'||typeof c.anonKey!=='string'||'serviceKey'in c)throw new ReadError('PUBLIC_CONFIG_REJECTED',503);return c;}
export function readRoute(raw){
  if(raw.length>(raw.startsWith('/v2/')?8192:2048)||!raw.startsWith('/')||raw.startsWith('//'))throw new ReadError('INVALID_URL');
  const u=new URL(raw,'http://127.0.0.1');
  if(u.hash||u.username||u.password||/%2f|%5c/i.test(u.pathname))throw new ReadError('INVALID_URL');
  const params=[...u.searchParams.keys()];if(new Set(params).size!==params.length)throw new ReadError('DUPLICATE_PARAMETER');
  if(u.pathname.startsWith('/v2/search/')||u.pathname==='/v2/saved'||u.pathname.startsWith('/v2/companies/')){const route=searchRoute(u);if(route)return route;throw new ReadError('ROUTE_NOT_FOUND',404);}
  if(u.pathname.startsWith('/v2/'))return catalogRoute(u);
  if(u.pathname==='/sectors'&&!params.length)return {name:'m1_public_catalog',args:{}};
  const match=u.pathname.match(/^\/articles\/([0-9a-f-]+)$/);
  if(match&&UUID.test(match[1])&&!params.length)return {name:'m1_public_article',args:{p_issue:match[1]}};
  if(u.pathname==='/articles'&&params.every(x=>['sector','limit','cursor'].includes(x))){
    const sector=u.searchParams.get('sector'),limit=u.searchParams.get('limit')??'20',cursor=u.searchParams.get('cursor');
    if(sector!==null&&!UUID.test(sector)||!/^\d{1,2}$/.test(limit)||Number(limit)<1||Number(limit)>50||cursor!==null&&(cursor.length>256||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(cursor)||!Number.isFinite(Date.parse(cursor))))throw new ReadError('INVALID_PARAMETER');
    return {name:'m1_public_articles',args:{p_sector:sector,p_limit:Number(limit),p_cursor:cursor}};
  }
  throw new ReadError('ROUTE_NOT_FOUND',404);
}
export async function upstream(c,name,args,signal){
  const timeout=AbortSignal.timeout(7000);
  const response=await fetch(c.apiUrl+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',cache:'no-store',headers:{apikey:c.anonKey,Authorization:'Bearer '+c.anonKey,'Content-Type':'application/json'},body:JSON.stringify(args),signal:signal?AbortSignal.any([signal,timeout]):timeout});
  const chunks=[];let total=0;
  for await(const chunk of response.body??[]){total+=chunk.length;if(total>262144)throw new ReadError('RESPONSE_TOO_LARGE',502);chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ReadError('INVALID_BACKEND_RESPONSE',502);}
  if(!response.ok){if(name.startsWith('catalog_public_')&&value.code==='P0001'&&['STALE_CATALOG','INVALID_CURSOR_CONTEXT'].includes(value.message))throw new ReadError(value.message,409);throw new ReadError('PUBLIC_READ_UNAVAILABLE',503);}
  return value;
}
const ipv4=x=>x.split('.').reduce((n,v)=>(n<<8)|Number(v),0)>>>0;
export function lanInterface(ip){
  if(ip!=='192.168.200.132')throw new ReadError('PREVIOUSLY_APPROVED_LAN_ONLY');
  const matches=Object.values(networkInterfaces()).flat().filter(x=>x?.family==='IPv4'&&!x.internal&&x.address===ip);
  if(matches.length!==1)throw new ReadError('APPROVED_INTERFACE_NOT_PRESENT');return matches[0];
}
export async function createPublicGateway(c,{lan=false,port=62330,transport=upstream,readHomeRanking}={}){
  if(readHomeRanking!==undefined&&(lan||typeof readHomeRanking!=='function'||c.apiUrl!=='http://127.0.0.1:62321'))throw new ReadError('HOME_ROUTE_REQUIRES_LOCAL_SOURCE',503);
  const identity=await transport(c,'m1_public_identity',{});
  if(identity?.productId!=='judoju-news'||identity.environment!=='local'||identity.sampleKind!=='SYNTHETIC'||identity.bootstrapId!==c.bootstrapId||identity.contract!=='M1')throw new ReadError('PRODUCT_FINGERPRINT_MISMATCH',503);
  const readHome=readHomeRanking===undefined?null:createHomePublicReader({
    readRanking:readHomeRanking,
    readArticle:(issueId,signal)=>transport(c,'m1_public_article',{p_issue:issueId},signal),
  });
  const iface=lan?lanInterface('192.168.200.132'):null,host=iface?.address??'127.0.0.1',peers=new Map();let active=0;let globalTimes=[];
  const server=createServer(async(req,res)=>{
    const now=Date.now(),peer=req.socket.remoteAddress??'',localPort=server.address()?.port;
    const headers={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    const send=(status,body,extra={})=>{if(res.destroyed)return;res.writeHead(status,{...headers,...extra});res.end(req.method==='HEAD'?undefined:JSON.stringify(body));};
    let bucket,acquired=false;
    try{
      if(req.headers.host!==host+':'+localPort)throw new ReadError('HOST_REJECTED',403);
      if(iface){const sameSubnet=(ipv4(peer)&ipv4(iface.netmask))===(ipv4(iface.address)&ipv4(iface.netmask));if(!/^\d+\.\d+\.\d+\.\d+$/.test(peer)||!sameSubnet)throw new ReadError('PEER_REJECTED',403);}
      const origin=req.headers.origin;if(origin!==undefined&&!c.webOrigins.includes(origin))throw new ReadError('ORIGIN_REJECTED',403);
      if(origin)headers['Access-Control-Allow-Origin']=origin;
      headers.Vary='Origin';
      if(req.headers.authorization||req.headers.cookie)throw new ReadError('CLIENT_CREDENTIALS_REJECTED',403);
      if(req.method==='OPTIONS'){send(204,null,{'Access-Control-Allow-Methods':'GET, HEAD','Access-Control-Allow-Headers':'Content-Type, Cache-Control'});return;}
      if(!['GET','HEAD'].includes(req.method))throw new ReadError('METHOD_REJECTED',405);
      const homeRoute=readHome!==null&&req.url==='/v2/home';
      const route=homeRoute?null:readRoute(req.url??'');
      for(const [key,b]of peers)if(now-b.updated>60000&&b.active===0)peers.delete(key);
      if(!peers.has(peer)&&peers.size>=512)throw new ReadError('RATE_LIMITED',429);
      bucket=peers.get(peer)??{times:[],tokens:12,updated:now,active:0};peers.set(peer,bucket);
      bucket.tokens=Math.min(12,bucket.tokens+(now-bucket.updated)/1000);bucket.updated=now;bucket.times=bucket.times.filter(t=>now-t<60000);globalTimes=globalTimes.filter(t=>now-t<60000);
      if(bucket.tokens<1||bucket.times.length>=60||globalTimes.length>=240||bucket.active>=3||active>=8)throw new ReadError('RATE_LIMITED',429);
      bucket.tokens--;bucket.times.push(now);globalTimes.push(now);bucket.active++;active++;acquired=true;
      let value;
      if(homeRoute){value=await readHome();}
      else{
        const raw=await transport(c,route.name,route.args);
        value=route.search?searchResponse(route,raw):catalogResponse(route,raw);
        if(route.name==='m1_public_catalog'&&(!Array.isArray(value)||value.length>100)||route.name==='m1_public_articles'&&(!Array.isArray(value)||value.length>50||value.some(x=>x.sample_kind!=='SYNTHETIC'))||route.name==='m1_public_article'&&value?.state==='PUBLISHED'&&value.sample_kind!=='SYNTHETIC')throw new ReadError('SYNTHETIC_DTO_REQUIRED',502);
      }
      if(Buffer.byteLength(JSON.stringify(value))>262144)throw new ReadError('RESPONSE_TOO_LARGE',502);
      send(200,{productId:'judoju-news',mode:'LOCAL_SYNTHETIC',data:value});
    }catch(e){const known=e instanceof ReadError||e instanceof CatalogReadError;send(known?e.status:503,{error:known?e.message:'PUBLIC_READ_UNAVAILABLE'},known&&e.status===429?{'Retry-After':'1'}:{});}
    finally{if(acquired){active--;bucket.active--;}}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;server.maxHeadersCount=30;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host,port,exclusive:true},resolve);});
  const timer=lan?setTimeout(()=>{server.close();server.closeAllConnections();},2*3600*1000):null;timer?.unref();
  return {server,host,port:server.address().port,close:()=>new Promise(resolve=>{if(timer)clearTimeout(timer);server.close(resolve);server.closeAllConnections();})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);if(args.some(x=>x!=='--lan'))throw new ReadError('UNSUPPORTED_ARGUMENT');
  const g=await createPublicGateway(publicConfig(),{lan:args.includes('--lan')});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>g.close());
  console.log(JSON.stringify({component:'M1_PUBLIC_READ',productId:'judoju-news',host:g.host,port:g.port,mode:'LOCAL_SYNTHETIC',serviceKeyUsed:false,lanTtlHours:args.includes('--lan')?2:null}));
}
