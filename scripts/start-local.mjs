import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync,writeFileSync,createWriteStream,realpathSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLoopbackProxy } from './docker-loopback-proxy.mjs';
import { root,runtimeDir,projectId,networkName,sourcePreflight,identity,ensureNetwork,freePorts,docker,must,writePrivate } from './local-runtime.mjs';

sourcePreflight();const id=ensureNetwork();
assert.ok(!Object.keys(id.loopbackRebind??{}).length,'Never rerun vendor bootstrap over an explicitly loopback-bound local stack');
assert.equal(id.dbState,undefined,'First bootstrap runs once only; inspect an existing or uncertain runtime rather than replaying start');
const prior=must(docker(['volume','ls','--filter','name=^supabase_.*_judoju-news-local$','--format','{{.Name}}']),'Own volume collision check');
if(!id.dbState){assert.equal(prior,'','Never adopt a pre-existing product-name volume');await freePorts();}
else assert.equal(id.dbState,'START_INTENT','Unexpected or uncertain DB lifecycle');
id.dbState='START_INTENT';id.migrationDigests=Object.fromEntries(readdirSync(path.join(root,'supabase/migrations')).filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort().map(name=>[name,createHash('sha256').update(readFileSync(path.join(root,'supabase/migrations',name))).digest('hex')]));writePrivate('identity.json',id);
const cli=realpathSync(path.join(root,'node_modules/supabase/dist/supabase.js'));assert.ok(!path.relative(root,cli).startsWith('..'));
const env={...process.env};for(const k of Object.keys(env))if(/^SUPABASE_|^PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|PASS)|^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH)$/.test(k))delete env[k];
// Engine-side rewrite happens before creation, avoiding transient wildcard
// exposure. The CLI still injects its own generated TLS/config files normally.
const proxy=await createLoopbackProxy({projectId,networkId:id.networkId});
env.DOCKER_HOST=proxy.host;delete env.DOCKER_CONTEXT;
async function runCli(args,label){
  const out=createWriteStream(path.join(runtimeDir,label+'.stdout'),{flags:'w',mode:0o600}),err=createWriteStream(path.join(runtimeDir,label+'.stderr'),{flags:'w',mode:0o600});
  return await new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[cli,'--workdir',root,...args],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});p.stdout.pipe(out);p.stderr.pipe(err);
    p.once('error',reject);p.once('close',code=>{out.end();err.end();resolve(code);});
  });
}
console.log(JSON.stringify({phase:'STARTING_NEW_LOCAL_STACK',projectId,credentials:'CAPTURED_TO_IGNORED_LOCAL_FILES_ONLY',remoteProject:'NONE'}));
const startLogLabel='supabase-start-'+Date.now();
let code;try{code=await runCli(['start','--network-id',id.networkId,'--output-format','json'],startLogLabel);}finally{await proxy.close();}
writePrivate('bootstrap-loopback-rewrite.json',{containers:proxy.rewritten,observedAt:new Date().toISOString(),binding:'127.0.0.1'});
if(code!==0){console.error(JSON.stringify({phase:'LOCAL_START_FAILED',exitCode:code,state:'IMPLEMENTED_RUNTIME_PENDING',details:'Ignored local logs retained; secrets not printed; do not replay uncertain bootstrap'}));process.exit(code||1);}
assert.ok(proxy.rewritten.length>0,'CLI must have used the loopback transport');
const names=must(docker(['ps','--filter','name=^/supabase_.*_judoju-news-local$','--format','{{.Names}}']),'New project container inventory').split(/\r?\n/).filter(Boolean);
assert.ok(names.some(n=>n==='supabase_db_'+projectId),'Expected new DB container');
const observed=[];
for(const name of names){
  const c=JSON.parse(must(docker(['container','inspect',name,'--format','{{json .}}']),'Owned container inspect'));
  assert.match(c.Config.Image,/^(?:public\.ecr\.aws\/supabase\/|ghcr\.io\/supabase\/|supabase\/)/,'Official Supabase image namespace only');
  assert.ok(Object.values(c.NetworkSettings.Networks).some(n=>n.NetworkID===id.networkId),'Owned network required');
  for(const bindings of Object.values(c.NetworkSettings.Ports??{}))for(const binding of bindings??[])assert.equal(binding.HostIp,'127.0.0.1','Local service publicly bound');
  const volumes=c.Mounts.filter(m=>m.Type==='volume').map(m=>({name:m.Name,destination:m.Destination}));
  assert.ok(volumes.every(m=>m.name.endsWith('_'+projectId)),'Owned volume namespace');
  observed.push({name,image:c.Config.Image,imageId:c.Image,labels:c.Config.Labels,networkId:id.networkId,ports:c.NetworkSettings.Ports,volumes,health:c.State.Health?.Status??c.State.Status});
}
writePrivate('containers-redacted.json',observed);
id.dbState='BOUND_LOOPBACK';id.loopbackVerifiedAt=new Date().toISOString();writePrivate('identity.json',id);
await import('./initialize-local.mjs');
