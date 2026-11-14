import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';
import {localClient} from './m0-test-client.mjs';
import {root,runtimeDir,writePrivate} from './local-runtime.mjs';
const f=localClient();
// Preserve the product-owned local DB before the first additive 6D migration.
const backupDir=path.join(root,'.local-data/backups');mkdirSync(backupDir,{recursive:true});
const backup=path.join(backupDir,'before-stage06d.dump');
if(!existsSync(backup)){
 assert.ok(!Object.keys(f.id.migrationDigests??{}).some(n=>n.startsWith('20261115000041_')||n.startsWith('20261115000042_')),'Missing original pre-6D backup; never label a later backup as pre-migration');
 const r=spawnSync('C:/Program Files/Docker/Docker/resources/bin/docker.exe',['--context','desktop-linux','exec','supabase_db_judoju-news-local','pg_dump','-U','postgres','-d','postgres','--format=custom'],{windowsHide:true,maxBuffer:64*1024*1024});
 assert.equal(r.status,0,'Owned database backup failed');assert.ok(r.stdout.length>10000);writeFileSync(backup,r.stdout,{flag:'wx',mode:0o600});
 writePrivate('before-stage06d-backup.json',{productId:'judoju-news',bootstrapId:f.id.bootstrapId,format:'PG_CUSTOM',bytes:r.stdout.length,sha256:createHash('sha256').update(r.stdout).digest('hex'),observedAt:new Date().toISOString(),containsPrivateData:true,gitIgnored:true});
}
const backupReceipt=JSON.parse(readFileSync(path.join(runtimeDir,'before-stage06d-backup.json'),'utf8'));
assert.equal(backupReceipt.bootstrapId,f.id.bootstrapId);assert.equal(backupReceipt.sha256,createHash('sha256').update(readFileSync(backup)).digest('hex'),'Private backup integrity');
const configPath=path.join(runtimeDir,'installation-server.json');
if(!existsSync(configPath)){
 const admin=JSON.parse(readFileSync(path.join(runtimeDir,'admin-server.json'),'utf8'));
 assert.equal(admin.bootstrapId,f.id.bootstrapId);assert.equal(admin.apiUrl,'http://127.0.0.1:62321');
 writePrivate('installation-server.json',{productId:'judoju-news',environment:'local',sampleKind:'SYNTHETIC',apiUrl:admin.apiUrl,bootstrapId:admin.bootstrapId,anonKey:admin.anonKey,serviceKey:admin.serviceKey,encryptionKey:randomBytes(32).toString('hex')});
}
const files=['20261115000041_installation_settings_revision.sql','20261115000042_installation_operations.sql'];
const pending=files.filter(name=>{const bytes=readFileSync(path.join(root,'supabase/migrations',name));if(f.id.migrationDigests[name]){assert.equal(f.id.migrationDigests[name],createHash('sha256').update(bytes).digest('hex'),'Applied 6D migration immutable');return false;}return true;});
const bodies=pending.map(name=>readFileSync(path.join(root,'supabase/migrations',name),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
// Compile the entire proposed pair in a rollback before durable application.
if(bodies.length)f.sql('begin;\n'+bodies.join('\n')+'\nrollback;');
console.log(JSON.stringify({status:'PASS',phase:pending.length?'6D_DDL_ROLLBACK_COMPILE':'ALREADY_APPLIED_DIGESTS_VERIFIED',files,privateBackupPreserved:true,secretsPrinted:false}));
