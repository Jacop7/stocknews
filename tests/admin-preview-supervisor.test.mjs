import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {nativeBoundary,nativePowerShell,controlledEnvironment,productDirectory} from '../apps/admin/lib/preview-file-boundary.mjs';
const win=process.platform==='win32';
function run(payload){const r=spawnSync(nativePowerShell,['-NoProfile','-NonInteractive','-File',path.join(productDirectory,'scripts/admin-preview-supervisor.ps1'),'-Operation','Supervise'],{cwd:productDirectory,input:JSON.stringify(payload),encoding:'utf8',windowsHide:true,timeout:40000,env:controlledEnvironment()});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return {lines:r.stdout.trim().split(/\r?\n/).map(s=>JSON.parse(s))};}
test('actual Windows job-list creation, owned membership, handshake, descendant and TTL cleanup',{skip:!win?'NOT_VERIFIED_WINDOWS':false},()=>{
 const {lines}=run({mode:'Fixture'}),r=lines.at(-1);assert.equal(r.status,'PASS');assert.equal(r.cleanupObserved,true);assert.ok(lines.some(x=>x.phase==='Suspended'&&x.created));assert.ok(lines.some(x=>x.eventName==='descendant'));assert.ok(lines.some(x=>x.phase==='Handshake'));
});
test('native faults before creation, suspended, reader, handshake timeout and report clean only own job',{skip:!win?'NOT_VERIFIED_WINDOWS':false},()=>{
 for(const fault of ['BeforeCreate','AfterCreate','BeforeResume','ReaderFailure','HandshakeTimeout','ReportFailure']){const {lines}=run({mode:'Fixture',fault}),r=lines.at(-1);assert.equal(r.status,'HOLD',fault);assert.equal(r.cleanupObserved,true,fault);assert.equal(r.created,fault!=='BeforeCreate',fault);}
});
test('force-killed parent leaves no observed owned child handles alive, without retaining the Job handle',{skip:!win?'NOT_VERIFIED_WINDOWS':false},()=>{
 for(const phase of ['BeforeCreate','Suspended','Handshake','Descendant']){const r=nativeBoundary('DeathTest',{phase,lockProbe:phase==='Suspended'});assert.equal(r.allObservedExited,true);assert.equal(r.jobHandleDuplicated,false);assert.equal(r.closedJobQueried,false);assert.equal(r.syscallInterior,'NOT_OBSERVABLE');if(phase!=='BeforeCreate')assert.ok(r.processHandles>=1);assert.equal(r.identities.length,r.processHandles);assert.ok(r.identities.every(x=>x.matched===true&&/^\d+$/.test(x.created)));if(phase==='Suspended')assert.equal(r.lockContenderRejected,true);}
});
test('foreign listener is left alive and fixed port collision holds',{skip:!win?'NOT_VERIFIED_WINDOWS':false},async t=>{
 const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(62333,'127.0.0.2',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const {lines}=run({mode:'Fixture'}),r=lines.at(-1);assert.equal(r.status,'HOLD');assert.equal(r.reason,'PORT_COLLISION');assert.equal(r.created,false);assert.equal(server.listening,true);
});
test('arbitrary command, endpoint or executable cannot enter the fixed launcher',{skip:!win?'NOT_VERIFIED_WINDOWS':false},()=>{
 assert.throws(()=>nativeBoundary('Supervise',{mode:'arbitrary',command:'cmd.exe'}),/HOLD/);assert.throws(()=>nativeBoundary('Unknown',{}),/OPERATION/);
});
test('supervisor metadata preflight has no child-process launch gap before the creation-time Job',()=>{
 const source=readFileSync(path.join(productDirectory,'scripts/admin-preview-native.cs'),'utf8');const preflight=source.slice(source.indexOf('static void Preflight()'),source.indexOf('static string OwnDirectory'));
 assert.doesNotMatch(preflight,/Process\.Start|CreateProcess/);assert.match(preflight,/Inspect\(file\)/);
 const supervisor=source.slice(source.indexOf('static object Supervise'),source.indexOf('static object DeathTest'));assert.doesNotMatch(supervisor,/Process\.Start\(/);assert.ok(supervisor.indexOf('CreateJobObject(')<supervisor.indexOf('CreateProcess('));
});
