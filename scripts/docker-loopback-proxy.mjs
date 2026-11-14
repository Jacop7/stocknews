// Local CLI transport adapter: rewrite published bindings before Docker creates a
// container. Never rely on a network default that this Docker version ignored.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
export function loopbackCreate(body,{projectId,networkId}){
  const result=structuredClone(body);
  assert.match(result.Image,/^(?:public\.ecr\.aws\/supabase\/|ghcr\.io\/supabase\/|supabase\/)/,'Official local Supabase image only');
  assert.equal(result.HostConfig?.NetworkMode,networkId,'New product network only');
  result.HostConfig.PublishAllPorts=false;
  const allowed=new Set(['62321','62322','62323','62324','62325','62326']);
  for(const ports of Object.values(result.HostConfig.PortBindings??{}))for(const port of ports){assert.ok(allowed.has(port.HostPort),'Unexpected published port');port.HostIp='127.0.0.1';}
  assert.equal(projectId,'judoju-news-local');return result;
}
export async function createLoopbackProxy({projectId,networkId}){
  const socketPath=process.platform==='win32'?'\\\\.\\pipe\\dockerDesktopLinuxEngine':'/var/run/docker.sock',connections=new Set(),rewritten=[];
  // Docker clients preserve the DOCKER_HOST base path. An ephemeral capability
  // keeps other local callers and web pages from using this engine transport.
  const prefix='/'+randomBytes(32).toString('hex');
  const authorizedPath=url=>typeof url==='string'&&url.startsWith(prefix+'/')?url.slice(prefix.length):null;
  const server=http.createServer(async(req,res)=>{
    try{
      const enginePath=authorizedPath(req.url);if(!enginePath){res.writeHead(403);res.end('LOCAL_DOCKER_CAPABILITY_REQUIRED');return;}
      let body;
      if(req.method==='POST'&&/^\/(?:v[0-9.]+\/)?containers\/create(?:\?|$)/.test(enginePath)){
        const name=new URL(enginePath,'http://localhost').searchParams.get('name');
        assert.ok(name?.endsWith('_'+projectId),'Unexpected CLI product namespace');
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;assert.ok(bytes<4*1024*1024);chunks.push(chunk);}
        body=Buffer.from(JSON.stringify(loopbackCreate(JSON.parse(Buffer.concat(chunks)),{projectId,networkId})));rewritten.push(name);
      }
      const headers={...req.headers};if(body){headers['content-length']=String(body.length);delete headers['transfer-encoding'];}
      const upstream=http.request({socketPath,path:enginePath,method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('LOCAL_DOCKER_TRANSPORT_FAILED');});
      if(body)upstream.end(body);else req.pipe(upstream);
    }catch{res.writeHead(400);res.end('LOCAL_CONTAINER_BINDING_REJECTED');}
  });
  server.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
  // Docker exec/attach uses an upgraded duplex connection. This carries only
  // the local CLI's engine traffic, without reading or logging its payload.
  server.on('upgrade',(req,downstream,head)=>{
    const enginePath=authorizedPath(req.url);if(!enginePath){downstream.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    const upstream=net.connect(socketPath,()=>{
      upstream.write(req.method+' '+enginePath+' HTTP/'+req.httpVersion+'\r\n'+Object.entries(req.headers).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);downstream.pipe(upstream);upstream.pipe(downstream);
    });upstream.on('error',()=>downstream.destroy());downstream.on('error',()=>upstream.destroy());downstream.on('close',()=>upstream.destroy());
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {host:'tcp://127.0.0.1:'+server.address().port+prefix,rewritten,async close(){for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
