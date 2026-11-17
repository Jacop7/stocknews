// ADMIN_PREVIEW_ENTRY_C1B. Fixed synthetic lifecycle or blocked production Next, no credentials.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import path from 'node:path';
import {assertEnvironmentBoundary} from './admin-preview-policy.mjs';
import {productDirectory,nativeNode,controlledEnvironment,boundaryHold} from '../apps/admin/lib/preview-file-boundary.mjs';
const mode=process.argv.length===4&&process.argv[2]==='--mode'?process.argv[3]:null;
if(!['Preflight','Fixture','FixtureBrowser','Descendant','Preview'].includes(mode))boundaryHold('FIXED_MODE');
assertEnvironmentBoundary();
if(process.versions.node!=='24.15.0')boundaryHold('FIXED_NODE');
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
if(mode==='Preflight'){emit({status:'PREFLIGHT_PASS',actualKeysRead:0,frameworkStarted:false});}
else {
  if(process.env.JUDOJU_C1B_FIXTURE_NO_HANDSHAKE!=='1')emit({eventName:'handshake',pid:process.pid});
  if(mode==='Descendant'){setInterval(()=>{},1000);}
  else if(mode==='Fixture'){
    const child=spawn(nativeNode,[path.join(productDirectory,'scripts/admin-preview-entry.mjs'),'--mode','Descendant'],{cwd:productDirectory,env:controlledEnvironment(),windowsHide:true,stdio:'ignore'});
    child.on('error',()=>process.exit(2));emit({eventName:'descendant',pid:child.pid});emit({eventName:'ready',kind:'SYNTHETIC'});setInterval(()=>{},1000);
  }else if(mode==='FixtureBrowser'){
    const cookie='judoju_c1b_fixture_cookie';
    await Promise.all([['127.0.0.2',62334],['127.0.0.2',62335],['127.0.0.1',62336]].map(([host,port])=>new Promise((resolve,reject)=>{
      const server=createServer((req,res)=>{
        if(req.headers.host!==`${host}:${port}`){res.writeHead(403).end();return;}
        res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');
        if(req.url==='/set'&&host==='127.0.0.2'&&port===62334)res.setHeader('Set-Cookie',`${cookie}=SYNTHETIC; HttpOnly; SameSite=Strict; Path=/`);
        if(req.url==='/clear')res.setHeader('Set-Cookie',`${cookie}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/`);
        const sent=(req.headers.cookie??'').split(';').some(s=>s.trim()===cookie+'=SYNTHETIC');
        res.end(`<title>C1B fixture</title><h1>Cookie host fixture</h1><p>Host: ${host}:${port}</p><p>Fixture cookie received: ${sent}</p><p>No actual authentication or database connection.</p>`);
      });server.on('error',reject);server.listen(port,host,resolve);
    })));
    emit({eventName:'ready',kind:'COOKIE_FIXTURE_ONLY'});
  }else {
    assertEnvironmentBoundary();
    const cli=path.join(productDirectory,'apps/admin/node_modules/next/dist/bin/next');
    const child=spawn(nativeNode,[cli,'start',path.join(productDirectory,'apps/admin'),'--hostname','127.0.0.2','--port','62333'],{cwd:productDirectory,windowsHide:true,stdio:['ignore','inherit','inherit'],env:{...controlledEnvironment(),JUDOJU_ADMIN_PROFILE:'preview'}});
    child.on('error',()=>process.exit(2));child.on('exit',()=>process.exit(3));
    const until=performance.now()+29000;
    let ready=false;
    while(performance.now()<until){try{const r=await fetch('http://127.0.0.2:62333/login',{redirect:'error',signal:AbortSignal.timeout(500)});if(r.status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    if(!ready)process.exit(4);emit({eventName:'ready',kind:'ACTUAL_BLOCKED_PREVIEW'});
  }
}
