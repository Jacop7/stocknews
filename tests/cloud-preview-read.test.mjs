import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,lstatSync,realpathSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {request} from 'node:http';
import {classifyPublicKey,loadApprovedPreviewConfig,assertPreviewIdentity,previewRoute,previewUpstream,createPreviewGateway,PROJECT,UPSTREAM,READ_RPCS,DENIED_PROBES,deniedResponse} from '../scripts/cloud-preview-public-read.mjs';
import {resolveReadTarget} from '../apps/mobile/src/data/read-target.ts';
const id='00000000-0000-4000-8000-000000000001',when='2026-11-16T00:00:00Z';
const identity={productId:'judoju-news',environment:'preview',bootstrapId:null,sampleKind:'SYNTHETIC',contract:'M1'};
const config={productId:'judoju-news',environment:'preview',mode:'PREVIEW_SYNTHETIC',projectRef:PROJECT,apiUrl:UPSTREAM,publicKey:'sb_publishable_SYNTHETIC_ONLY_1234567890',webOrigins:['http://127.0.0.1:8084']};
const card={issue_id:id,title:'SYNTHETIC',summary:'fixture',sample_kind:'SYNTHETIC',first_published_at:when};
const company={source_company_ref:id,name:'fixture',search_description:'fixture',metadata_kind:'USER_REFERENCE_UNVERIFIED',stock_identity_state:'UNRESOLVED',stock_code:null,price:null,change_percent:null,stock_url:null};
function fixture(name,args){
 if(name==='m1_public_identity')return structuredClone(identity);
 if(name==='m1_public_article')return {state:'PUBLISHED',sample_kind:'SYNTHETIC',body:{fixture:true}};
 if(name==='catalog_public_tree')return {catalog_version:'2',metadata_kind:'USER_REFERENCE_UNVERIFIED',parents:[]};
 if(name==='catalog_public_sector_page')return {state:'AVAILABLE',catalog_version:'2',metadata_kind:'USER_REFERENCE_UNVERIFIED',groups:[],ungrouped_members:[{...company,membership_id:id,description:'fixture'}]};
 if(name==='catalog_public_saved')return {catalog_version:'2',items:args.p_issues.map(requested_issue_id=>({requested_issue_id,canonical_issue_id:requested_issue_id,state:'PUBLISHED',card}))};
 if(name==='catalog_public_search_companies')return {catalog_version:'2',items:[company],next:null};
 if(name==='catalog_public_company_sectors')return {catalog_version:'2',items:[],state:'AVAILABLE',next_offset:null};
 return {catalog_version:'2',as_of:when,items:[card],next:null};
}
const routes=['/articles/'+id,'/v2/catalog?version=2','/v2/sectors/'+id+'?version=2','/v2/articles?version=2','/v2/search/news?version=2&q=AI','/v2/search/companies?version=2&q=AI','/v2/saved?version=2&ids='+id,'/v2/companies/'+id+'/sectors?version=2'];
function http(g,path,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{const r=request({hostname:'127.0.0.1',port:g.port,path,method,headers},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});r.setTimeout(10000,()=>r.destroy(new Error('FIXTURE_TIMEOUT')));r.once('error',reject);r.end(body);});
}
test('pure target chooses existing local default and only explicit development preview',()=>{
 assert.deepEqual(resolveReadTarget({}),{url:'http://127.0.0.1:62330',mode:'LOCAL_SYNTHETIC'});
 assert.equal(resolveReadTarget({base:'http://192.168.200.132:62330'}).mode,'LOCAL_SYNTHETIC');
 for(const environment of ['development','preview'])assert.equal(resolveReadTarget({base:'http://127.0.0.1:62331',mode:'PREVIEW_SYNTHETIC',environment}).mode,'PREVIEW_SYNTHETIC');
 for(const base of [UPSTREAM,'http://127.0.0.1:62331/','http://localhost:62331','http://user@127.0.0.1:62331','http://127.0.0.1:62331?x=1','http://127.0.0.1:62331#x','http://192.168.200.132:62331'])assert.throws(()=>resolveReadTarget({base,mode:'PREVIEW_SYNTHETIC',environment:'preview'}));
 for(const environment of [undefined,'local','production',''])assert.throws(()=>resolveReadTarget({base:'http://127.0.0.1:62331',mode:'PREVIEW_SYNTHETIC',environment}));
 assert.throws(()=>resolveReadTarget({mode:'UNKNOWN'}));assert.throws(()=>resolveReadTarget({base:'http://127.0.0.1:62331'}));
});
test('identity null is exact preview contract, never a relaxation of local identity',()=>{
 assert.deepEqual(assertPreviewIdentity(identity),identity);
 for(const change of [{environment:'local'},{environment:'production'},{bootstrapId:id},{sampleKind:'REAL'},{contract:'M2'},{productId:'food'},{extra:true},{bootstrapId:undefined}])assert.throws(()=>assertPreviewIdentity({...identity,...change}));
});
test('nine RPCs include handshake and eight bounded public routes; legacy and arbitrary calls denied',()=>{
 assert.deepEqual([...new Set(['m1_public_identity',...routes.map(x=>previewRoute(x).name)])].sort(),READ_RPCS);
 for(const url of ['/sectors','/articles','/v2/catalog?version=2&version=3','/rest/v1/rpc/install','//evil/x','/v2/search/news?version=2&q=x&limit=21','/v2/sectors/'+id+'?limit=51','/v2/catalog#x','/articles/%2f'+id,'/v2/saved?version=2&ids='+id+','+id,'/v2/search/news?version=2&q=x&cursor=garbage','/v2/catalog?version=0'])assert.throws(()=>previewRoute(url));
});
test('publishable versus legacy anon headers, fixed URL, timeout and no redirects or privileged keys',async()=>{
 const jwt=role=>Buffer.from(JSON.stringify({typ:'JWT',alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.SYNTHETIC';
 for(const [publicKey,kind]of [[config.publicKey,'PUBLISHABLE'],[jwt('anon'),'LEGACY_ANON_JWT']]){
  assert.equal(classifyPublicKey(publicKey),kind);let calls=0;
  const value=await previewUpstream({...config,publicKey},'catalog_public_tree',{p_expected:'2'},{fetchImpl:async(url,options)=>{calls++;assert.equal(url,UPSTREAM+'/rest/v1/rpc/catalog_public_tree');assert.equal(options.headers.apikey,publicKey);assert.equal(options.headers.Authorization,kind==='PUBLISHABLE'?undefined:'Bearer '+publicKey);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.body,'{"p_expected":"2"}');return Response.json(fixture('catalog_public_tree',{}));}});assert.equal(calls,1);assert.equal(value.catalog_version,'2');
 }
 for(const publicKey of [jwt('service_role'),'sb_secret_SYNTHETIC','sbp_SYNTHETIC','unknown','a'.repeat(2049),null])await assert.rejects(previewUpstream({...config,publicKey},'catalog_public_tree',{}, {fetchImpl:()=>assert.fail('must not fetch')}));
 for(const change of [{projectRef:'other'},{apiUrl:'https://example.invalid'},{environment:'production'},{serviceKey:'fixture'},{webOrigins:['https://evil.invalid']}])await assert.rejects(previewUpstream({...config,...change},'catalog_public_tree',{}, {fetchImpl:()=>assert.fail('must not fetch')}));
 await assert.rejects(previewUpstream(config,'private_write',{}, {fetchImpl:()=>assert.fail('must not fetch')}));
});
test('upstream failures are bounded, generic and never echo SQL/key material',async()=>{
 const call=fetchImpl=>previewUpstream(config,'catalog_public_tree',{}, {fetchImpl});
 await assert.rejects(call(async()=>{throw new DOMException('fixture secret','TimeoutError');}),/PREVIEW_READ_UNAVAILABLE/);
 await assert.rejects(call(async()=>new Response('not-json')),/PREVIEW_RESPONSE_INVALID/);
 await assert.rejects(call(async()=>new Response('x'.repeat(262145))),/PREVIEW_RESPONSE_TOO_LARGE/);
 await assert.rejects(call(async()=>Response.json({code:'XX',message:'secret SQL'},{status:500})),e=>e.status===503&&!e.message.includes('SQL'));
 await assert.rejects(call(async()=>Response.json({},{status:429})),e=>e.status===429);
 await assert.rejects(call(async()=>Response.json({code:'P0001',message:'STALE_CATALOG'},{status:400})),e=>e.status===409);
 await assert.rejects(call(async()=>new Response('',{status:302,headers:{Location:'https://example.invalid'}})),/PREVIEW_RESPONSE_INVALID/);
});
test('isolated missing proof does not read product settings or use network',async()=>{
 const dir=ownDir();let calls=0;const original=globalThis.fetch;globalThis.fetch=()=>{calls++;throw new Error('NO_NETWORK');};
 try{
  assert.throws(()=>loadApprovedPreviewConfig({privateRoot:dir}),/PREVIEW_READ_NOT_ACTIVATED/);
  const entry=new URL('../scripts/cloud-preview-public-read.mjs',import.meta.url).href;
  const source='import {loadApprovedPreviewConfig} from '+JSON.stringify(entry)+';globalThis.fetch=()=>{throw new Error("NO_NETWORK")};try{loadApprovedPreviewConfig({privateRoot:'+JSON.stringify(dir)+'})}catch(e){console.error(e.message);process.exitCode=1}';
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('SUPABASE_')));
  const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',windowsHide:true,env});assert.equal(child.status,1);assert.equal(child.stdout,'');assert.equal(child.stderr.trim(),'PREVIEW_READ_NOT_ACTIVATED');assert.equal(calls,0);
 }finally{globalThis.fetch=original;cleanDir(dir);}
});
test('loopback HTTP fixture covers all read DTOs, HEAD, CORS preflight without upstream and sanitized errors',async()=>{
 const calls=[];let bad=null;
 const g=await createPreviewGateway(config,{port:0,transport:async(c,name,args)=>{calls.push(name);if(name==='m1_public_identity')return identity;if(bad==='throw')throw new Error('SECRET SQL');if(bad==='real')return {state:'PUBLISHED',sample_kind:'REAL'};if(bad==='price')return {...fixture(name,args),items:[{...company,price:100}]};if(bad==='huge')return {state:'PUBLISHED',sample_kind:'SYNTHETIC',text:'x'.repeat(262145)};return fixture(name,args);},now:()=>10000});
 try{
  assert.equal(g.host,'127.0.0.1');
  for(const url of routes){const r=await http(g,url,{headers:{Origin:config.webOrigins[0]}});assert.equal(r.status,200,r.text);const v=JSON.parse(r.text);assert.equal(v.mode,'PREVIEW_SYNTHETIC');assert.equal(v.productId,'judoju-news');}
  const head=await http(g,'/v2/catalog',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.text,'');
  const before=calls.length,pre=await http(g,'/v2/catalog',{method:'OPTIONS',headers:{Origin:config.webOrigins[0],'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Cache-Control'}});assert.equal(pre.status,204);assert.equal(pre.headers['access-control-allow-origin'],config.webOrigins[0]);assert.match(pre.headers['access-control-allow-headers'],/Cache-Control/);assert.equal(calls.length,before);
  for(const headers of [{Origin:'http://evil.invalid','Access-Control-Request-Method':'GET'},{Origin:config.webOrigins[0],'Access-Control-Request-Method':'POST'},{Origin:config.webOrigins[0],'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization'},{}])assert.equal((await http(g,'/v2/catalog',{method:'OPTIONS',headers})).status,403);
  for(const headers of [{Host:'evil.invalid'},{Authorization:'Bearer fixture'},{Cookie:'x=fixture'},{Origin:'http://evil.invalid'}]){const r=await http(g,'/v2/catalog',{headers});assert.equal(r.status,403);assert.equal(r.headers['access-control-allow-origin'],undefined);}
  assert.equal((await http(g,'/v2/catalog',{method:'POST'})).status,405);
  const malformed=await http(g,'/v2/catalog?version=0',{headers:{Origin:config.webOrigins[0]}});assert.equal(malformed.status,400);assert.equal(malformed.headers['access-control-allow-origin'],config.webOrigins[0]);
  bad='real';assert.equal((await http(g,'/articles/'+id)).status,502);
  bad='throw';const unavailable=await http(g,'/articles/'+id);assert.equal(unavailable.status,503);assert.ok(!unavailable.text.includes('SECRET'));
  bad=null;assert.equal((await http(g,'/v2/catalog')).status,200);assert.equal((await http(g,'/v2/catalog')).status,429);
 }finally{await g.close();}assert.equal(g.server.listening,false);
});
test('DTO corruption and oversize reject without stale fallback; rate bucket recovers on clock advance',async()=>{
 let at=0,bad='price';const g=await createPreviewGateway(config,{port:0,now:()=>at,transport:async(c,n,a)=>n==='m1_public_identity'?identity:bad==='price'?{catalog_version:'2',items:[{...company,price:100}]}:bad==='huge'?{state:'PUBLISHED',sample_kind:'SYNTHETIC',x:'x'.repeat(262145)}:bad==='tree'?{catalog_version:'2',parents:[]}:fixture(n,a)});
 try{
  assert.equal((await http(g,routes[5])).status,502);bad='huge';assert.equal((await http(g,routes[0])).status,502);bad='tree';assert.equal((await http(g,'/v2/catalog')).status,502);bad=null;
  for(let i=0;i<9;i++)assert.equal((await http(g,'/v2/catalog')).status,200);
  const limited=await http(g,'/v2/catalog');assert.equal(limited.status,429);assert.equal(limited.headers['retry-after'],'1');at=61000;assert.equal((await http(g,'/v2/catalog')).status,200);
 }finally{await g.close();}
});
test('concurrent upstream maximum releases after rejection and close',async()=>{
 const pending=[];let block=true;const g=await createPreviewGateway(config,{port:0,transport:async(c,n,a)=>n==='m1_public_identity'?identity:block?new Promise(resolve=>pending.push(()=>resolve(fixture(n,a)))):fixture(n,a)});
 try{
  const running=[http(g,'/v2/catalog'),http(g,'/v2/catalog'),http(g,'/v2/catalog')];
  for(let i=0;pending.length<3&&i<100;i++)await new Promise(r=>setTimeout(r,5));assert.equal(pending.length,3);
  assert.equal((await http(g,'/v2/catalog')).status,429);block=false;pending.forEach(x=>x());assert.ok((await Promise.all(running)).every(x=>x.status===200));assert.equal((await http(g,'/v2/catalog')).status,200);
 }finally{pending.forEach(x=>x());await g.close();}
});
test('existing local guard and refresh lifecycle remain distinct and no preview secrets in app',()=>{
 const local=readFileSync(new URL('../scripts/public-read-gateway.mjs',import.meta.url),'utf8');assert.ok(local.includes("identity.environment!=='local'"));assert.ok(local.includes('identity.bootstrapId!==c.bootstrapId'));
 const client=readFileSync(new URL('../apps/mobile/src/data/public-read.ts',import.meta.url),'utf8');for(const marker of ['resolveReadTarget','value.mode!==target.mode','generation.current','controller?.abort()','AppState','credentials:\'omit\''])assert.ok(client.includes(marker));assert.ok(!client.includes('publicKey')&&!client.includes('Authorization'));
});

function ownDir(){return mkdtempSync(path.join(tmpdir(),'judoju-cloud10b-'));}
function cleanDir(dir){
 const absolute=path.resolve(dir),parent=realpathSync(tmpdir());assert.equal(realpathSync(path.dirname(absolute)),parent);assert.ok(path.basename(absolute).startsWith('judoju-cloud10b-')&&!lstatSync(absolute).isSymbolicLink());assert.equal(realpathSync(absolute),absolute);rmSync(absolute,{recursive:true,force:false});
}
function fakeSettings(dir){
 const h=b=>createHash('sha256').update(b).digest('hex'),folder=path.join(dir,'.local-data/cloud-preview');mkdirSync(folder,{recursive:true});
 const authorization=Buffer.from('synthetic fixture authorization'),live=Buffer.from(JSON.stringify({state:'PASS',projectRef:PROJECT,allowed:READ_RPCS.map(name=>({name,ok:true,status:200})),denied:DENIED_PROBES.map(name=>({name,status:404,code:'PGRST202',denied:true}))}));
 writeFileSync(path.join(folder,'user-authorization.txt'),authorization);writeFileSync(path.join(folder,'live-result.json'),live);
 const proof={state:'CLOUD10B_PUBLIC_READ_VERIFIED',productId:'judoju-news',projectRef:PROJECT,environment:'preview',dataApiEnabledObserved:true,writeGrants:0,M2:false,prodWrites:0,readRpcNames:READ_RPCS,userAuthorizationSha256:h(authorization),reviewedResultSha256:h(live),inventorySha256:h(readFileSync(new URL('../docs/cloud/cloud10b-acl-inventory.json',import.meta.url)))};
 const proofBytes=Buffer.from(JSON.stringify(proof));writeFileSync(path.join(folder,'access-proof.json'),proofBytes);writeFileSync(path.join(folder,'public-config.json'),JSON.stringify({...config,proofSha256:createHash('sha256').update(proofBytes).digest('hex')}));return folder;
}
test('isolated synthetic proof/config validates SHA/project/key with no product-root access',()=>{
 const dir=ownDir();try{
  const folder=fakeSettings(dir);assert.equal(loadApprovedPreviewConfig({privateRoot:dir}).keyKind,'PUBLISHABLE');
  const p=path.join(folder,'public-config.json'),original=readFileSync(p);writeFileSync(p,JSON.stringify({...config,proofSha256:'0'.repeat(64)}));assert.throws(()=>loadApprovedPreviewConfig({privateRoot:dir}),/PREVIEW_CONFIG_REJECTED/);writeFileSync(p,original);
  writeFileSync(p,JSON.stringify({...JSON.parse(original),projectRef:'other'}));assert.throws(()=>loadApprovedPreviewConfig({privateRoot:dir}),/PREVIEW_CONFIG_REJECTED/);writeFileSync(p,original);
  writeFileSync(path.join(folder,'access-proof.json'),'{');assert.throws(()=>loadApprovedPreviewConfig({privateRoot:dir}),/PREVIEW_READ_NOT_ACTIVATED/);
  for(const privateRoot of ['.',null,7])assert.throws(()=>loadApprovedPreviewConfig({privateRoot}),/PREVIEW_CONFIG_REJECTED/);
 }finally{cleanDir(dir);}
});
test('owned directory junction/symlink root and config-directory traversal rejected',()=>{
 const dir=ownDir();let rootLink,subLink;
 try{
  const actual=path.join(dir,'actual');mkdirSync(actual);fakeSettings(actual);rootLink=path.join(dir,'root-link');symlinkSync(actual,rootLink,process.platform==='win32'?'junction':'dir');assert.throws(()=>loadApprovedPreviewConfig({privateRoot:rootLink}),/PREVIEW_CONFIG_REJECTED/);unlinkSync(rootLink);rootLink=null;
  const other=path.join(dir,'other');mkdirSync(path.join(other,'.local-data'),{recursive:true});subLink=path.join(other,'.local-data/cloud-preview');symlinkSync(path.join(actual,'.local-data/cloud-preview'),subLink,process.platform==='win32'?'junction':'dir');assert.throws(()=>loadApprovedPreviewConfig({privateRoot:other}),/PREVIEW_READ_NOT_ACTIVATED/);
 }finally{if(rootLink)unlinkSync(rootLink);if(subLink)unlinkSync(subLink);cleanDir(dir);}
});
test('isolated privateRoot cannot combine with default gateway/upstream or forwarded root options',async()=>{
 const dir=ownDir();let calls=0;const original=globalThis.fetch;globalThis.fetch=()=>{calls++;throw new Error('NO_NETWORK');};
 try{
  fakeSettings(dir);const isolated=loadApprovedPreviewConfig({privateRoot:dir});
  await assert.rejects(createPreviewGateway(isolated),/ISOLATED_CONFIG_REQUIRES_FIXTURE/);
  await assert.rejects(createPreviewGateway(config,{privateRoot:dir}),/ISOLATED_CONFIG_REQUIRES_FIXTURE/);
  await assert.rejects(previewUpstream(isolated,'catalog_public_tree',{}),/ISOLATED_CONFIG_REQUIRES_FIXTURE/);
  assert.equal(calls,0);
  const g=await createPreviewGateway(isolated,{port:0,transport:async(c,n,a)=>fixture(n,a)});try{assert.equal((await http(g,'/v2/catalog')).status,200);}finally{await g.close();}
 }finally{globalThis.fetch=original;cleanDir(dir);}
});
test('test call paths never execute actual product CLI or default config loader',()=>{
 const source=readFileSync(new URL(import.meta.url),'utf8');
 assert.ok(!new RegExp('loadApprovedPreviewConfig'+'\\s*\\(\\s*\\)').test(source));
 assert.ok(!source.includes("['scripts/"+'cloud-preview-public-read.mjs'+"']"));
 const module=readFileSync(new URL('../scripts/cloud-preview-public-read.mjs',import.meta.url),'utf8');assert.ok(module.includes("if(Object.hasOwn(options,'privateRoot')||transport===previewUpstream&&isolatedConfigs.has(input))reject('ISOLATED_CONFIG_REQUIRES_FIXTURE');"));
});
async function deadlineFixture(body=false){
 let aborted=false,observedSignal,abortHandler,timer;const guard=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('SYNTHETIC_GUARD_EXPIRED')),11000);});
 const fetchImpl=async(url,{signal})=>{
  observedSignal=signal;
  if(!body)return await new Promise((resolve,reject)=>{abortHandler=()=>{aborted=true;reject(signal.reason);};signal.addEventListener('abort',abortHandler,{once:true});});
  return new Response(new ReadableStream({start(controller){abortHandler=()=>{aborted=true;controller.error(signal.reason);};signal.addEventListener('abort',abortHandler,{once:true});}}));
 };
 try{
  await assert.rejects(Promise.race([previewUpstream(config,'catalog_public_tree',{}, {fetchImpl}),guard]),/PREVIEW_READ_UNAVAILABLE/);
  assert.ok(aborted&&observedSignal.aborted&&observedSignal.reason?.name==='TimeoutError','ABORT_DEADLINE_REQUIRED');
 }finally{clearTimeout(timer);if(observedSignal&&abortHandler)observedSignal.removeEventListener('abort',abortHandler);}
}
test('actual deadline aborts pending fake fetch; non-aborting mutation must fail',{timeout:15000},async()=>{await deadlineFixture();});
test('actual deadline aborts delayed response body without leaking provider error',{timeout:15000},async()=>{await deadlineFixture(true);});
test('three delayed body timeouts release gateway slots for next healthy request',{timeout:15000},async()=>{
 let block=true,aborted=0,guardTimer;const listeners=[];
 const fetchImpl=async(url,{signal})=>block?new Response(new ReadableStream({start(controller){const handler=()=>{aborted++;controller.error(signal.reason);};listeners.push([signal,handler]);signal.addEventListener('abort',handler,{once:true});}})):Response.json(fixture('catalog_public_tree',{}));
 const transport=async(c,n,a)=>n==='m1_public_identity'?identity:previewUpstream(c,n,a,{fetchImpl});
 const g=await createPreviewGateway(config,{port:0,transport});
 try{
  const guard=new Promise((resolve,reject)=>{guardTimer=setTimeout(()=>reject(new Error('SYNTHETIC_GUARD_EXPIRED')),11000);});
  const results=await Promise.race([Promise.all([http(g,'/v2/catalog'),http(g,'/v2/catalog'),http(g,'/v2/catalog')]),guard]);assert.equal(aborted,3,'ABORT_DEADLINE_REQUIRED');assert.ok(results.every(x=>x.status===503&&x.text==='{"error":"PREVIEW_READ_UNAVAILABLE"}'));
  block=false;assert.equal((await http(g,'/v2/catalog')).status,200);
 }finally{clearTimeout(guardTimer);listeners.forEach(([signal,handler])=>signal.removeEventListener('abort',handler));await g.close();}
});
test('CLOUD10B proof is bound to the authorization, live result and inventory files, not to hash-shaped strings',()=>{
 const dir=ownDir();try{
  const folder=fakeSettings(dir);assert.equal(loadApprovedPreviewConfig({privateRoot:dir}).keyKind,'PUBLISHABLE');
  for(const [file,content] of [['user-authorization.txt','other authorization text'],['live-result.json',JSON.stringify({state:'FAIL'})]]){
   const p=path.join(folder,file),original=readFileSync(p);writeFileSync(p,content);assert.throws(()=>loadApprovedPreviewConfig({privateRoot:dir}),/PREVIEW_READ_NOT_ACTIVATED/);writeFileSync(p,original);
  }
  // Wrong probe names, a 400 validation error or a 500 never count as a refusal.
  const live=path.join(folder,'live-result.json'),good=JSON.parse(readFileSync(live));
  for(const denied of [good.denied.map((x,i)=>i?x:{...x,name:'n1'}),good.denied.map((x,i)=>i?x:{...x,status:400,code:'PGRST100'}),good.denied.map((x,i)=>i?x:{...x,status:500,code:'42501'}),good.denied.slice(1)]){
   writeFileSync(live,JSON.stringify({...good,denied}));assert.throws(()=>loadApprovedPreviewConfig({privateRoot:dir}),/PREVIEW_READ_NOT_ACTIVATED/);
  }
  rmSync(path.join(folder,'live-result.json'));assert.throws(()=>loadApprovedPreviewConfig({privateRoot:dir}),/PREVIEW_READ_NOT_ACTIVATED/);
 }finally{cleanDir(dir);}
});
test('0A000 counts as a refusal only for the event-trigger probe',()=>{
 assert.equal(deniedResponse(400,'0A000','rpc rls_auto_enable'),true);
 for(const name of DENIED_PROBES.filter(x=>x!=='rpc rls_auto_enable'))assert.equal(deniedResponse(400,'0A000',name),false);
 assert.equal(deniedResponse(400,'PGRST100','rpc rls_auto_enable'),false);assert.equal(deniedResponse(500,'0A000','rpc rls_auto_enable'),false);
});
