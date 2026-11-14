import test from 'node:test';
import assert from 'node:assert/strict';
import { loopbackCreate,createLoopbackProxy } from '../scripts/docker-loopback-proxy.mjs';
import { assertArchiveMetadata } from '../scripts/local-runtime.mjs';
const context={projectId:'judoju-news-local',networkId:'new-product-network'};
const body={Image:'public.ecr.aws/supabase/kong:2.8.1',Env:['SYNTHETIC_ONLY=1'],HostConfig:{NetworkMode:context.networkId,PublishAllPorts:true,PortBindings:{'8000/tcp':[{HostIp:'0.0.0.0',HostPort:'62321'},{HostIp:'::',HostPort:'62321'}]}}};
test('Local Docker transport denies callers without its ephemeral capability',async()=>{
  const proxy=await createLoopbackProxy(context);
  try{const url=new URL(proxy.host.replace('tcp:','http:'));const r=await fetch(url.origin+'/_ping');assert.equal(r.status,403);assert.equal(proxy.rewritten.length,0);}finally{await proxy.close();}
});
test('Recorded archive must remain stopped, restart=no and on its own network',()=>{
  const id={networkId:'owned'},record={archive:'owned_archive'},safe={Name:'/owned_archive',HostConfig:{NetworkMode:'owned',RestartPolicy:{Name:'no'}},State:{Running:false}};
  assertArchiveMetadata(safe,record,id);
  for(const mutate of [c=>c.State.Running=true,c=>c.HostConfig.RestartPolicy.Name='always',c=>c.HostConfig.NetworkMode='foreign']){const bad=structuredClone(safe);mutate(bad);assert.throws(()=>assertArchiveMetadata(bad,record,id));}
});
test('Bootstrap rewrites all IPv4/IPv6 published bindings before container create',()=>{
  const result=loopbackCreate(body,context);assert.equal(result.HostConfig.PublishAllPorts,false);assert.ok(result.HostConfig.PortBindings['8000/tcp'].every(p=>p.HostIp==='127.0.0.1'));assert.equal(body.HostConfig.PortBindings['8000/tcp'][0].HostIp,'0.0.0.0');assert.deepEqual(result.Env,body.Env);
});
test('Bootstrap rejects foreign network, unexpected host ports and nonofficial images',()=>{
  for(const mutate of [b=>b.HostConfig.NetworkMode='foreign',b=>b.HostConfig.PortBindings['8000/tcp'][0].HostPort='54321',b=>b.Image='foreign/image:latest']){const invalid=structuredClone(body);mutate(invalid);assert.throws(()=>loopbackCreate(invalid,context));}
});
