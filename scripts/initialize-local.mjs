import assert from 'node:assert/strict';
import { readFileSync,realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash,randomBytes } from 'node:crypto';
import { root,projectId,networkName,sourcePreflight,identity,docker,must,command,writePrivate,assertArchivesStopped } from './local-runtime.mjs';
sourcePreflight();const id=identity();
assert.ok(['BOUND_LOOPBACK','VERIFIED'].includes(id.dbState),'Verify actual localhost stack first');
assertArchivesStopped(id);
const names=must(docker(['ps','--filter','name=^/supabase_.*_judoju-news-local$','--format','{{.Names}}']),'Own inventory').split(/\r?\n/).filter(Boolean);
assert.equal(names.length,9);
const containers=names.map(name=>JSON.parse(must(docker(['container','inspect',name,'--format','{{json .}}']),'Own container')));
const observed=[];
for(const c of containers){
  assert.equal(c.HostConfig.NetworkMode,id.networkId);assert.deepEqual(Object.keys(c.NetworkSettings.Networks),[networkName]);
  assert.ok(c.State.Running&&!c.State.Restarting&&(!c.State.Health||c.State.Health.Status==='healthy'));
  for(const bindings of Object.values(c.NetworkSettings.Ports??{}))for(const b of bindings??[])assert.equal(b.HostIp,'127.0.0.1');
  const image=JSON.parse(must(docker(['image','inspect',c.Image,'--format','{{json .}}']),'Own image metadata'));
  observed.push({name:c.Name,image:c.Config.Image,imageId:c.Image,repoDigests:image.RepoDigests,networkId:id.networkId,ports:c.NetworkSettings.Ports,health:c.State.Health?.Status??c.State.Status});
}
for(const [name,sha] of Object.entries(id.migrationDigests))assert.equal(createHash('sha256').update(readFileSync(path.join(root,'supabase/migrations',name))).digest('hex'),sha,'Never edit applied migration');
const versions=must(docker(['exec','supabase_db_'+projectId,'psql','-U','postgres','-d','postgres','-At','-c','select version from supabase_migrations.schema_migrations order by version;']),'Migration inventory').split(/\r?\n/);
for(const name of Object.keys(id.migrationDigests))assert.ok(versions.includes(name.split('_')[0]));
const cli=realpathSync(path.join(root,'node_modules/supabase/dist/supabase.js'));
const result=command(process.execPath,[cli,'--workdir',root,'status','--output','json'],{envOverrides:{DOCKER_HOST:process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock'}});
writePrivate('supabase-status.stdout',result.stdout);writePrivate('supabase-status.stderr',result.stderr);
assert.equal(result.code,0,'Local status failed; ignored output retained');
const raw=result.stdout;const status=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
const apiUrl=status.API_URL??status.api_url??status.apiUrl,serviceKey=status.SERVICE_ROLE_KEY??status.service_role_key??status.serviceRoleKey;
assert.equal(apiUrl,'http://127.0.0.1:62321');assert.ok(typeof serviceKey==='string'&&serviceKey.length>20);
const credentials={apiUrl,serviceKey,anonKey:status.ANON_KEY??status.anon_key??status.anonKey,jwtSecret:status.JWT_SECRET??status.jwt_secret??status.jwtSecret,scope:'LOCAL_DEVELOPMENT_ONLY',source:'NEW_CLI_STACK_DEFAULTS_MAY_BE_PUBLIC'};
writePrivate('credentials.json',credentials);
const r=await fetch(apiUrl+'/rest/v1/rpc/m0_bootstrap',{method:'POST',redirect:'error',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({p_bootstrap:id.bootstrapId}),signal:AbortSignal.timeout(8000)});
const body=await r.json();assert.equal(r.status,200,'Bootstrap RPC failed; response intentionally not logged');
assert.equal(body.productId,'judoju-news');assert.equal(body.environment,'local');assert.equal(body.bootstrapId,id.bootstrapId);
// Separate random mock authentication is not a public Supabase development key.
id.mockKey??=randomBytes(32).toString('hex');id.dbState='VERIFIED';id.verifiedAt=new Date().toISOString();
writePrivate('identity.json',id);
writePrivate('worker.env',[
  'JUDOJU_M0_MOCK_KEY='+id.mockKey,'JUDOJU_M0_BOOTSTRAP='+id.bootstrapId,
  'JUDOJU_M0_RPC_URL=http://supabase_kong_'+projectId+':8000/rest/v1/rpc','JUDOJU_M0_SERVICE_KEY='+serviceKey,
].join('\n')+'\n');
writePrivate('containers-redacted.json',observed);
console.log(JSON.stringify({phase:'NEW_LOCAL_DB_VERIFIED',projectId,containers:observed.length,loopback:true,migrations:versions.length,schemaVersion:body.schemaVersion,keysPrinted:false,actualNewsRequests:0,runtimeTests:'PENDING'}));
