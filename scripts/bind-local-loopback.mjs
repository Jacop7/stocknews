// Recreate only this freshly bootstrapped local project's stopped published services.
// Docker Engine create preserves complete entrypoint/health/env without putting keys in argv.
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync,readFileSync,mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { root,runtimeDir,sourcePreflight,identity,docker,must,writePrivate,projectId,networkName } from './local-runtime.mjs';
sourcePreflight();const id=identity();assert.equal(id.dbState,'START_INTENT');
const names=[...new Set([...must(docker(['ps','-a','--filter','name=^/supabase_.*_judoju-news-local$','--format','{{.Names}}']),'Own project inventory').split(/\r?\n/).filter(Boolean),...Object.keys(id.loopbackRebind??{})])];
assert.ok(names.includes('supabase_db_'+projectId));
const expectedPorts=new Set(['62321','62322','62323','62324','62325','62326']);
const normalizedRoot=root.replaceAll('\\','/').toLowerCase();
const vmRoot=normalizedRoot.replace(/^([a-z]):/,'/run/desktop/mnt/host/$1');
const apiVersion=must(docker(['version','--format','{{.Server.APIVersion}}']),'Local Docker API version');assert.match(apiVersion,/^1\.\d+$/);
async function createContainer(name,body){
  const encoded=JSON.stringify(body);
  return await new Promise((resolve,reject)=>{
    const req=http.request({socketPath:process.platform==='win32'?'\\\\.\\pipe\\dockerDesktopLinuxEngine':'/var/run/docker.sock',path:'/v'+apiVersion+'/containers/create?name='+encodeURIComponent(name),method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(encoded)}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>{if(res.statusCode!==201){reject(new Error('OWNED_CONTAINER_CREATE_HTTP_'+res.statusCode));return;}try{resolve(JSON.parse(Buffer.concat(chunks)));}catch{reject(new Error('DOCKER_CREATE_PARSE_FAILED'));}});
    });req.setTimeout(30000,()=>req.destroy(new Error('DOCKER_CREATE_TIMEOUT')));req.on('error',reject);req.end(encoded);
  });
}
id.loopbackRebind??={};
for(const name of names){
  const currentResult=docker(['container','inspect',name,'--format','{{json .}}']);
  const savedPath=path.join(runtimeDir,'bindfix-'+name+'.json');
  let c=currentResult.code===0?JSON.parse(currentResult.stdout):existsSync(savedPath)?JSON.parse(readFileSync(savedPath,'utf8')):null;
  assert.ok(c,'Missing owned container or recorded create intent');
  if(id.loopbackRebind?.[name]){
    const previous=JSON.parse(must(docker(['container','inspect',id.loopbackRebind[name].oldId,'--format','{{json .}}']),'Recorded own archive'));
    assert.equal(previous.Name,'/'+id.loopbackRebind[name].archive);assert.equal(previous.State.Running,false);
    must(docker(['update','--restart=no',previous.Id]),'Keep unsafe archived container stopped');
    if(currentResult.code===0&&c.Config.Labels?.['com.judoju.bootstrap']===id.bootstrapId){
      assert.equal(c.Image,previous.Image);assert.equal(c.HostConfig.NetworkMode,id.networkId);
      for(const ports of Object.values(c.HostConfig.PortBindings))for(const port of ports)assert.equal(port.HostIp,'127.0.0.1');
      id.loopbackRebind[name]={...id.loopbackRebind[name],state:'CREATED',newId:c.Id};writePrivate('identity.json',id);continue;
    }
  }
  if(!Object.keys(c.HostConfig.PortBindings??{}).length)continue;
  assert.equal(c.State.Running,false,'Stop own stack before changing bindings');
  assert.match(c.Config.Image,/^public\.ecr\.aws\/supabase\//);
  assert.equal(c.HostConfig.NetworkMode,id.networkId);assert.deepEqual(Object.keys(c.NetworkSettings.Networks),[networkName]);
  for(const mount of c.Mounts){
    if(mount.Type==='volume')assert.ok(mount.Name.endsWith('_'+projectId));
    else if(mount.Type==='bind'){const source=mount.Source.replaceAll('\\','/').toLowerCase();assert.ok(source.startsWith(normalizedRoot+'/')||source.startsWith(vmRoot+'/'),'Bind source must be in this new product');}
    else throw new Error('UNEXPECTED_MOUNT_KIND');
  }
  const recordName='bindfix-'+name+'.json',saved=path.join(runtimeDir,recordName);
  if(!existsSync(saved))writePrivate(recordName,c);else c=JSON.parse(readFileSync(saved,'utf8'));
  const archive=name+'__bindfix_archive';
  if(!id.loopbackRebind[name]){
    id.loopbackRebind[name]={state:'RENAME_INTENT',oldId:c.Id,archive};writePrivate('identity.json',id);
    must(docker(['update','--restart=no',c.Id]),'Disable archive auto-restart');
    must(docker(['rename',c.Id,archive]),'Archive stopped own container');
    id.loopbackRebind[name].state='CREATE_INTENT';writePrivate('identity.json',id);
  }
  const existing=docker(['container','inspect',name,'--format','{{json .}}']);
  if(existing.code===0){
    const current=JSON.parse(existing.stdout);assert.equal(current.Config.Labels?.['com.judoju.bootstrap'],id.bootstrapId,'Do not adopt an uncertain same-name container');
    id.loopbackRebind[name]={...id.loopbackRebind[name],state:'CREATED',newId:current.Id};writePrivate('identity.json',id);continue;
  }
  assert.equal(id.loopbackRebind[name].state,'CREATE_INTENT');
  const host=structuredClone(c.HostConfig);
  host.PublishAllPorts=false;
  for(const bindings of Object.values(host.PortBindings))for(const binding of bindings){assert.ok(expectedPorts.has(binding.HostPort));binding.HostIp='127.0.0.1';}
  const aliases=c.NetworkSettings.Networks[networkName].Aliases??[name];
  const made=await createContainer(name,{...c.Config,Image:c.Image,Labels:{...c.Config.Labels,'com.judoju.product':'judoju-news','com.judoju.bootstrap':id.bootstrapId,'com.judoju.loopback':'explicit'},HostConfig:host,NetworkingConfig:{EndpointsConfig:{[networkName]:{NetworkID:id.networkId,Aliases:aliases}}}});
  id.loopbackRebind[name]={...id.loopbackRebind[name],state:'CREATED',newId:made.Id};writePrivate('identity.json',id);
}
// The CLI injects generated TLS/declarative files into Kong's writable layer,
// rather than mounting them. Preserve only this new stack's own generated files.
const kongName='supabase_kong_'+projectId,kongRecord=id.loopbackRebind[kongName];
if(kongRecord&&!kongRecord.generatedFilesOwnershipPreservedAt){
  const archive=JSON.parse(must(docker(['container','inspect',kongRecord.oldId,'--format','{{json .}}']),'Own Kong archive'));
  assert.equal(archive.Name,'/'+kongRecord.archive);assert.equal(archive.State.Running,false);
  assert.equal(archive.HostConfig.NetworkMode,id.networkId);
  const generated=path.join(runtimeDir,'own-kong-generated');mkdirSync(generated,{recursive:true});
  must(docker(['stop',kongName]),'Stop own gateway before restoring its generated files');
  must(docker(['cp',archive.Id+':/home/kong/.',generated]),'Capture own generated gateway files privately');
  // Stream the original tar with archive mode: a Windows directory round trip
  // would lose the original container UID and make the non-root entrypoint fail.
  const tar=docker(['cp',archive.Id+':/home/kong/.','-'],{encoding:null});
  assert.equal(tar.code,0,'Capture own gateway tar');assert.ok(Buffer.isBuffer(tar.stdout));
  must(docker(['cp','--archive','-',kongName+':/home/kong'],{input:tar.stdout}),'Restore generated files with original ownership');
  kongRecord.generatedFilesOwnershipPreservedAt=new Date().toISOString();writePrivate('identity.json',id);
}
must(docker(['start','supabase_db_'+projectId]),'Start owned loopback DB');
let dbReady=false;
for(let n=0;n<30;n++){if(docker(['exec','supabase_db_'+projectId,'pg_isready','-U','postgres']).code===0){dbReady=true;break;}await sleep(1000);}
assert.ok(dbReady,'Owned DB not healthy');
must(docker(['start',...names.filter(n=>n!=='supabase_db_'+projectId)]),'Start owned loopback stack');
let healthy=false;
for(let n=0;n<60;n++){
  const all=names.map(name=>JSON.parse(must(docker(['container','inspect',name,'--format','{{json .}}']),'Owned health')));
  for(const c of all)for(const bindings of Object.values(c.NetworkSettings.Ports??{}))for(const binding of bindings??[])assert.equal(binding.HostIp,'127.0.0.1');
  if(all.every(c=>c.State.Running&&(!c.State.Health||c.State.Health.Status==='healthy'))){healthy=true;break;}
  if(n%10===0)console.log(JSON.stringify({phase:'OWNED_LOOPBACK_HEALTH_WAIT',elapsedPolls:n,containers:all.map(c=>({name:c.Name,health:c.State.Health?.Status??c.State.Status}))}));
  await sleep(1000);
}
assert.ok(healthy,'Owned local stack health failed');
id.dbState='BOUND_LOOPBACK';id.loopbackVerifiedAt=new Date().toISOString();writePrivate('identity.json',id);
console.log(JSON.stringify({phase:'OWNED_STACK_BOUND_LOOPBACK',containers:names.length,archivedStoppedOnly:Object.keys(id.loopbackRebind).length,otherProductsTouched:false,bootstrapRpc:'NOT_YET_RUN'}));
