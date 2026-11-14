import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'smol-toml';
export const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
export const runtimeDir=path.join(root,'.local-data/runtime');
export const projectId='judoju-news-local',networkName='judoju-news-local-net';
const dockerPath=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker';
const dockerContext=process.platform==='win32'?'desktop-linux':'default';
export function command(executable,args,{input,timeout=30000,encoding='utf8',envOverrides={}}={}){
  const env={...process.env};for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
  Object.assign(env,envOverrides);
  const r=spawnSync(executable,args,{cwd:root,env,input,encoding,windowsHide:true,timeout,maxBuffer:8*1024*1024});
  if(r.error)throw r.error;return {code:r.status,stdout:r.stdout,stderr:r.stderr};
}
export const docker=(args,options)=>command(dockerPath,['--context',dockerContext,...args],options);
export function must(result,label){assert.equal(result.code,0,label);return result.stdout.trim();}
export function writePrivate(name,value){
  assert.ok(/^[a-zA-Z0-9_.-]+$/.test(name));mkdirSync(runtimeDir,{recursive:true});
  writeFileSync(path.join(runtimeDir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});
}
export function identity(){
  const p=path.join(runtimeDir,'identity.json');
  if(!existsSync(p))writePrivate('identity.json',{productId:'judoju-news',environment:'local',projectId,bootstrapId:randomUUID(),networkName,networkState:'NOT_CREATED',createdAt:new Date().toISOString()});
  const v=JSON.parse(readFileSync(p,'utf8'));
  assert.equal(v.productId,'judoju-news');assert.equal(v.environment,'local');assert.equal(v.projectId,projectId);assert.equal(v.networkName,networkName);assert.match(v.bootstrapId,/^[0-9a-f-]{36}$/);return v;
}
export function config(){
  const bytes=readFileSync(path.join(root,'supabase/config.toml'));
  const expected=JSON.parse(readFileSync(path.join(root,'docs/project-resource-manifest.json'),'utf8')).plannedLocalConfig;
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,'Reviewed local config digest');
  const cfg=parse(bytes.toString('utf8'));assert.equal(cfg.project_id,projectId);
  assert.equal(cfg.api.port,62321);assert.equal(cfg.db.port,62322);assert.equal(cfg.studio.port,62323);return cfg;
}
export function sourcePreflight(){
  assert.ok(!Object.hasOwn(process.env,'SUPABASE_CLI_BINARY_OVERRIDE'),'Supabase binary override forbidden');
  assert.equal(process.versions.node,'24.15.0');config();
  assert.equal(must(command('git',['rev-parse','--show-toplevel']),'Git root').replaceAll('\\','/').toLowerCase(),root.replaceAll('\\','/').toLowerCase());
  const status=JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8'));
  assert.equal(status.currentStage,4);assert.equal(status.stages[3].state,'IMPLEMENTED_SUPPLY_PENDING');
  const endpoint=must(docker(['context','inspect',dockerContext,'--format','{{(index .Endpoints "docker").Host}}']),'Local Docker context');
  assert.equal(endpoint,process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock','Only explicit local Docker engine');
  const engine=must(docker(['info','--format','{{.ServerVersion}} {{.OSType}}']),'Docker engine');assert.ok(engine.endsWith(' linux'));
  return {productId:'judoju-news',environment:'local',engine,projectId};
}
export function assertArchiveMetadata(c,record,id){
  assert.equal(c.Name,'/'+record.archive);assert.equal(c.HostConfig.NetworkMode,id.networkId);
  assert.equal(c.State.Running,false,'Unsafe archived service must never run');assert.equal(c.HostConfig.RestartPolicy.Name,'no','Unsafe archive auto-restart forbidden');
}
export function assertArchivesStopped(id){
  for(const record of Object.values(id.loopbackRebind??{})){
    const c=JSON.parse(must(docker(['container','inspect',record.oldId,'--format','{{json .}}']),'Recorded own archive must remain inspectable'));
    assertArchiveMetadata(c,record,id);
  }
}
export async function freePorts(){
  const c=config(),ports=[c.api.port,c.db.port,c.db.shadow_port,c.studio.port,c.local_smtp.port,c.local_smtp.smtp_port,c.local_smtp.pop3_port];
  for(const port of ports)await new Promise((resolve,reject)=>{const server=createServer();server.once('error',()=>reject(new Error('LOCAL_PORT_CONFLICT_'+port)));server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(resolve));});
  return ports;
}
export function ensureNetwork(){
  sourcePreflight();const id=identity();
  const found=docker(['network','inspect',networkName,'--format','{{json .}}']);
  if(found.code===0){
    const n=JSON.parse(found.stdout);assert.equal(n.Labels?.['com.judoju.product'],'judoju-news');assert.equal(n.Labels?.['com.judoju.bootstrap'],id.bootstrapId);assert.equal(n.Options?.['com.docker.network.bridge.host_binding_ipv4'],'127.0.0.1');
    assert.ok(['CREATE_INTENT','CREATED'].includes(id.networkState),'Never adopt pre-existing same-name network');
    id.networkId=n.Id;id.networkState='CREATED';writePrivate('identity.json',id);return id;
  }
  assert.equal(id.networkState,'NOT_CREATED','Uncertain network creation requires inspection, never silent resend');
  const ownContainers=must(docker(['ps','-a','--filter','name=^/supabase_.*_judoju-news-local$','--format','{{.Names}}']),'Own project collision');assert.equal(ownContainers,'','Do not adopt an existing same-name project');
  id.networkState='CREATE_INTENT';writePrivate('identity.json',id);
  const made=docker(['network','create','--driver','bridge','--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1','--label','com.judoju.product=judoju-news','--label','com.judoju.bootstrap='+id.bootstrapId,networkName]);
  assert.equal(made.code,0,'Network creation failed; intent retained');id.networkId=made.stdout.trim();id.networkState='CREATED';writePrivate('identity.json',id);
  return ensureNetwork();
}
