import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { sourcePreflight,identity,runtimeDir,docker,must,projectId,assertArchivesStopped } from './local-runtime.mjs';
export function localClient(){
  sourcePreflight();const id=identity();assert.equal(id.dbState,'VERIFIED');
  assertArchivesStopped(id);
  const credentials=JSON.parse(readFileSync(path.join(runtimeDir,'credentials.json'),'utf8'));
  assert.equal(credentials.apiUrl,'http://127.0.0.1:62321');
  const inspect=JSON.parse(must(docker(['container','inspect','supabase_db_'+projectId,'--format','{{json .}}']),'Owned DB'));
  assert.equal(inspect.HostConfig.NetworkMode,id.networkId);
  for(const bindings of Object.values(inspect.NetworkSettings.Ports??{}))for(const p of bindings??[])assert.equal(p.HostIp,'127.0.0.1');
  const sql=(query)=>must(docker(['exec','-i','supabase_db_'+projectId,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:query}),'Owned fixture SQL failed');
  assert.equal(sql("select bootstrap_id::text from private.runtime_identity where product_id='judoju-news' and environment='local';"),id.bootstrapId);
  const jwt=(claims)=>{
    assert.ok(typeof credentials.jwtSecret==='string'&&credentials.jwtSecret.length>20,'Local JWT signing key unavailable');
    const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const body=encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:'supabase',exp:Math.floor(Date.now()/1000)+3600,...claims});
    return body+'.'+createHmac('sha256',credentials.jwtSecret).update(body).digest('base64url');
  };
  async function request(route,{method='GET',data,role='service',token}={}){
    const access=token??(role==='anon'?credentials.anonKey:credentials.serviceKey);
    const r=await fetch(credentials.apiUrl+'/rest/v1/'+route,{method,redirect:'error',headers:{apikey:credentials.anonKey,Authorization:'Bearer '+access,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
    let body;try{body=await r.json();}catch{body=null;}
    return {status:r.status,body};
  }
  const rpc=(name,data={},options={})=>request('rpc/'+name,{method:'POST',data,...options});
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  function asyncSql(query){
    const env={...process.env};for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
    return new Promise((resolve,reject)=>{
      const p=spawn(process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker',['--context',process.platform==='win32'?'desktop-linux':'default','exec','-i','supabase_db_'+projectId,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
      p.stdout.resume();p.stderr.resume();p.once('error',reject);p.once('close',code=>code===0?resolve():reject(new Error('OWNED_ASYNC_SQL_FAILED')));p.stdin.end(query);
    });
  }
  return {id,sql,asyncSql,jwt,request,rpc,quote};
}
