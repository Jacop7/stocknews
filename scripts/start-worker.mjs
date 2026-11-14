import assert from 'node:assert/strict';
import path from 'node:path';
import { sourcePreflight,identity,docker,must,writePrivate,runtimeDir,assertArchivesStopped } from './local-runtime.mjs';
sourcePreflight();const id=identity();assert.equal(id.dbState,'VERIFIED');
assertArchivesStopped(id);
const project='judoju-news-worker-local',image='judoju-news-worker-local:stage04-m0';
const own=must(docker(['ps','-a','--filter','label=com.docker.compose.project='+project,'--format','{{.ID}}']),'Worker collision inventory').split(/\r?\n/).filter(Boolean);
const volume=docker(['volume','inspect',project+'_mock_receipts','--format','{{json .}}']);
const existingImage=docker(['image','inspect',image,'--format','{{json .}}']);
if(!id.workerState){assert.equal(own.length,0,'Never adopt existing worker');assert.notEqual(volume.code,0,'Never adopt existing receipt volume');assert.notEqual(existingImage.code,0,'Never adopt existing image tag');}
else{
  for(const container of own){const c=JSON.parse(must(docker(['container','inspect',container,'--format','{{json .}}']),'Owned worker'));assert.equal(c.Config.Labels?.['com.judoju.bootstrap'],id.bootstrapId);}
  if(volume.code===0)assert.equal(JSON.parse(volume.stdout).Labels?.['com.judoju.bootstrap'],id.bootstrapId);
  if(existingImage.code===0)assert.equal(JSON.parse(existingImage.stdout).Config.Labels?.['com.judoju.bootstrap'],id.bootstrapId);
}
id.workerState='BUILD_START_INTENT';writePrivate('identity.json',id);
const args=['compose','--project-name',project,'--env-file',path.join(runtimeDir,'worker.env'),'-f','workers/common/compose.yaml'];
// Captured output can include environment diagnostics on failures. Keep it private.
const build=docker([...args,'build'],{timeout:300000});writePrivate('worker-build.stdout',build.stdout);writePrivate('worker-build.stderr',build.stderr);assert.equal(build.code,0,'Owned worker image build failed; private logs retained');
const up=docker([...args,'up','-d','--scale','worker=2','--wait','--wait-timeout','60'],{timeout:90000});writePrivate('worker-up.stdout',up.stdout);writePrivate('worker-up.stderr',up.stderr);assert.equal(up.code,0,'Owned mock worker start failed; private logs retained');
const ids=must(docker(['ps','--filter','label=com.docker.compose.project='+project,'--format','{{.ID}}']),'Worker inventory').split(/\r?\n/).filter(Boolean);assert.equal(ids.length,3);
const observed=ids.map(cid=>{const c=JSON.parse(must(docker(['container','inspect',cid,'--format','{{json .}}']),'Worker check'));assert.equal(c.Config.Labels['com.judoju.bootstrap'],id.bootstrapId);assert.equal(Object.keys(c.HostConfig.PortBindings??{}).length,0);assert.ok(Object.values(c.NetworkSettings.Networks).every(n=>n.NetworkID===id.networkId));return {id:c.Id,name:c.Name,imageId:c.Image,networkId:id.networkId,health:c.State.Health?.Status,service:c.Config.Labels['com.docker.compose.service']};});
id.workerState='RUNNING_LOCAL_MOCK';writePrivate('identity.json',id);writePrivate('workers-redacted.json',observed);
console.log(JSON.stringify({phase:'LOCAL_MOCK_WORKER_STARTED',workers:2,mockServices:1,hostPorts:0,realEffects:0,runtimeAcceptance:'PENDING'}));
