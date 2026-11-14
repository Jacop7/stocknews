import assert from 'node:assert/strict';
import { readFileSync, realpathSync, lstatSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { allowedHostedPullRef } from './native-release-policy.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
let checks=0;const check=(ok,msg)=>{assert.ok(ok,msg);checks++;};
const read=p=>readFileSync(path.join(root,p));const json=p=>JSON.parse(read(p).toString('utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const currentStatus=json('docs/development-status.json'),stage=currentStatus.currentStage;
assert.ok(stage===2||stage===3,'Supported stage2/3 validation');
const stage3=stage===3,stage2Commit='0c81416de798a4923ebdcf4dee2ead0f1955f416';
function git(args,input){const q=spawnSync('git',['-c','core.quotepath=false','-C',root,...args],{input,windowsHide:true});assert.ifError(q.error);return {code:q.status,text:q.stdout.toString('utf8').trim(),bytes:q.stdout};}
const base='fa928e987a792cb99536b7e0fc4461e7575ba8d6',initial='f7dce3a9e05c39580f23a210c3ac9d2514c38b74';
check(realpathSync(git(['rev-parse','--show-toplevel']).text)===root,'Own execution root');
check(lstatSync(path.join(root,'.git')).isDirectory()&&!lstatSync(path.join(root,'.git')).isSymbolicLink(),'Own Git directory');
check(realpathSync(path.resolve(root,git(['rev-parse','--git-common-dir']).text))===realpathSync(path.join(root,'.git')),'No common-dir reuse');
check(!existsSync(path.join(root,'.git/objects/info/alternates'))&&!existsSync(path.join(root,'.gitmodules')),'No borrowed history/submodules');
const config=git(['config','--local','--name-only','--get-regexp','^(include\\.|includeif\\.|core\\.hookspath$)']);check(config.code===1&&!config.text,'No external config/hooks');
for(const name of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES']) check(!process.env[name],'No inherited Git routing '+name);
function noGitLinks(directory){for(const e of readdirSync(directory,{withFileTypes:true})){const p=path.join(directory,e.name);check(!e.isSymbolicLink(),'No Git symlinks');if(e.isDirectory())noGitLinks(p);}}
noGitLinks(path.join(root,'.git'));
check(git(['remote']).text==='origin','One authorized remote');
for(const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']]) check(git(args).text==='https://github.com/Jacop7/stocknews.git','Authorized remote URL');
check(git(['rev-list','--max-parents=0','HEAD']).text===initial&&git(['merge-base','--is-ancestor',base,'HEAD']).code===0,'Reviewed independent ancestry');
const branch=git(['branch','--show-current']).text,head=git(['rev-parse','HEAD']).text;
const hosted=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Jacop7/stocknews';
check(['main',stage3?'spike/03-data-providers':'feat/02-app-admin-shell'].includes(branch)||(hosted&&!branch&&head===process.env.GITHUB_SHA),'Stage branch / exact hosted detached commit');
const count=Number(git(['rev-list','--count','HEAD']).text);check((count>=(stage3?3:2)&&count<=(stage3?4:3))||(hosted&&count===(stage3?5:4)&&git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).length===3),'Stage history bounds');
const refs=git(['for-each-ref','--format=%(refname)']).text.split(/\r?\n/).filter(Boolean);
const allowed=['refs/heads/main','refs/heads/feat/02-app-admin-shell','refs/remotes/origin/main','refs/remotes/origin/feat/02-app-admin-shell','refs/remotes/origin/HEAD'];
if(stage3){allowed.push('refs/heads/spike/03-data-providers','refs/remotes/origin/spike/03-data-providers');check(git(['merge-base','--is-ancestor',stage2Commit,'HEAD']).code===0,'Reviewed stage2 ancestry');}
const pullRef=allowedHostedPullRef(process.env,head,ref=>{const q=git(['rev-parse','--verify',ref]);return q.code===0?q.text:null;});
if(pullRef)allowed.push(pullRef);
check(refs.every(ref=>allowed.includes(ref)),'Only stage refs');
const files=git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString('utf8').split('\0').filter(Boolean);
for(const name of files){let current=root;for(const part of name.split('/')){current=path.join(current,part);check(!lstatSync(current).isSymbolicLink(),'Source has no links '+name);}check(!path.relative(root,realpathSync(current)).startsWith('..'),'Source is internal');}
const resources=json('docs/project-resource-manifest.json');
check(resources.schemaVersion===2&&resources.productId==='judoju-news'&&resources.productRoot==='.'&&resources.repository.initialCommit===initial&&resources.repository.stage1Commit===base,'Portable product identity');
const ids=['expo_eas','supabase_local','supabase_preview','supabase_production','worker_local','worker_preview','worker_production','admin_hosting','push_ads','observability','backups','ci_cd','environment_secrets'];
assert.deepEqual(resources.resources.map(x=>x.id).sort(),ids.sort());checks++;
function validateResource(x){
  assert.equal(x.plannedNamespace,'judoju-news-'+x.id.replaceAll('_','-'));
  if(x.id==='expo_eas') {
    assert.equal(x.status,'CREATED');
    assert.deepEqual(x.actual,{projectId:'133b3e36-2bcc-4e98-86f5-3f029e37500c',owner:'jacop7223',slug:'judoju-news',dashboardUrl:'https://expo.dev/accounts/jacop7223/projects/judoju-news',createdNewForProduct:true});
  } else {assert.equal(x.status,'PENDING');assert.equal(x.actual,null);}
}
for(const item of resources.resources){validateResource(item);checks++;}
const bad=structuredClone(resources.resources[0]);bad.actual={url:'https://invalid.example'};assert.throws(()=>validateResource(bad));checks++;
const names=['.env','apps/mobile/.env.production','signing/app.p12','signing/app.jks','AuthKey_test.p8','service-account.json','prod.env','secrets/id_rsa','secrets/id_ed25519','android/google-services.json','ios/GoogleService-Info.plist','node_modules/a','apps/mobile/node_modules/a','.local-data/db','docker-data/db','supabase/.temp/project-ref','.local-tools/key','.codex/runtime.json'];
const ignored=new Set(git(['check-ignore','--no-index','--stdin'],names.join('\n')+'\n').text.split(/\r?\n/));for(const n of names)check(ignored.has(n),'Ignored private/generated '+n);
for(const n of ['.env.example','apps/mobile/.env.example','apps/admin/.env.example','docs/project-resource-manifest.json'])check(git(['check-ignore','--no-index',n]).code===1,'Trackable example '+n);
const status=currentStatus;check(status.currentStage===stage&&(stage3?['IMPLEMENTING','IMPLEMENTED_SUPPLY_PENDING']:['IMPLEMENTING','IMPLEMENTED_REVIEW_PENDING']).includes(status.state),'Honest current stage');
check(status.stages.every(x=>x.state===(x.stage<stage?'COMPLETE':x.stage===stage?status.state:'NOT_STARTED')),'No future success claim');
const provenance=json('docs/reference/provenance.json');check(provenance.files.length===(stage3?12:11),'Approved snapshot count');
const old=JSON.parse(git(['show',base+':docs/reference/provenance.json']).text);
for(const f of provenance.files){const bytes=read(f.copy);check(bytes.length===f.bytes&&hash(bytes)===f.sha256,'Immutable snapshot '+f.copy);const a=git(['hash-object','--no-filters','--stdin'],bytes),b=git(['hash-object','--path='+f.copy,'--stdin'],bytes);check(a.code===0&&b.code===0&&a.text===b.text,'No snapshot Git transformation');}
for(const f of old.files){const current=provenance.files.find(x=>x.copy===f.copy);check(current?.bytes===f.bytes&&current?.sha256===f.sha256&&hash(git(['show',base+':'+f.copy]).bytes)===f.sha256,'Original ten bytes preserved');}
if(stage3){const prior=JSON.parse(git(['show',stage2Commit+':docs/reference/provenance.json']).text);for(const f of prior.files){assert.deepEqual(provenance.files.find(x=>x.copy===f.copy),f);check(hash(git(['show',stage2Commit+':'+f.copy]).bytes)===f.sha256,'Stage2 eleven snapshots preserved');}}
const cfg=parse(read('supabase/config.toml').toString('utf8')),planned=resources.plannedLocalConfig;
check(cfg.project_id===planned.project_id&&cfg.project_id==='judoju-news-local'&&hash(read(planned.file))===planned.sha256,'New local config identity/digest');
const active={'api':cfg.api.port,'db':cfg.db.port,'db.shadow':cfg.db.shadow_port,'studio':cfg.studio.port,'inbucket':cfg.inbucket.port,'inbucket.smtp':cfg.inbucket.smtp_port,'inbucket.pop3':cfg.inbucket.pop3_port};assert.deepEqual(planned.ports,active);checks++;
assert.deepEqual(planned.disabledPorts,{'db.pooler':cfg.db.pooler.port,'edge_runtime.inspector':cfg.edge_runtime.inspector_port,'analytics':cfg.analytics.port});checks++;
check([cfg.api,cfg.studio,cfg.inbucket,cfg.auth,cfg.storage].every(s=>s.enabled===true)&&[cfg.db.pooler,cfg.edge_runtime,cfg.analytics].every(s=>s.enabled===false),'Explicit active/disabled service set');
const allPorts=[...Object.values(active),...Object.values(planned.disabledPorts)];
check(new Set(allPorts).size===allPorts.length&&allPorts.every(n=>Number.isInteger(n)&&n>1024&&n<65536),'Unique configured ports');
check(resources.configValidation.status==='CONFIG_VALIDATED'&&resources.configValidation.portConflictCheck.status==='PASS'&&resources.configValidation.dockerNameConflictCheck.status==='PASS'&&resources.configValidation.actualContainerVolumeProductResponse==='PENDING_STAGE_4','Read-only config readiness, no running DB claim');
const native=json('docs/native-release.json');
check(resources.appIdentity.easProjectId==='133b3e36-2bcc-4e98-86f5-3f029e37500c'&&resources.appIdentity.easStatus==='LINKED','New EAS linked');
for(const platform of ['android','ios'])check(resources.appIdentity.nativeBuilds[platform]===native.actualBuilds[platform].deviceStatus,'Matching native device evidence kind '+platform);
if(!stage3)console.log(JSON.stringify({status:'PASS',stage,checks,root,limitations:'Local source/config and historical contract validation only. Native builds and cloud resources not certified.'},null,2));
