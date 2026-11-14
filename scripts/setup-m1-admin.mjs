import { randomBytes } from 'node:crypto';
import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { authFixtures } from './m1-auth-fixtures.mjs';
import { runtimeDir,writePrivate } from './local-runtime.mjs';
const f=await authFixtures(),admin=f.state.users.admin;
f.sql('insert into private.admin_memberships(user_id,active) values ('+f.quote(admin.id)+',true) on conflict(user_id) do update set active=true,updated_at=now();');
const file=path.join(runtimeDir,'admin-server.json'),credentials=JSON.parse(readFileSync(path.join(runtimeDir,'credentials.json'),'utf8'));
if(!existsSync(file))writePrivate('admin-server.json',{productId:'judoju-news',environment:'local',sampleKind:'SYNTHETIC',bootstrapId:f.id.bootstrapId,apiUrl:credentials.apiUrl,origin:'http://127.0.0.1:3100',anonKey:credentials.anonKey,serviceKey:credentials.serviceKey,encryptionKey:randomBytes(32).toString('hex')});
else{const config=JSON.parse(readFileSync(file,'utf8'));if(config.bootstrapId!==f.id.bootstrapId)throw new Error('PRODUCT_FINGERPRINT_MISMATCH');}
console.log(JSON.stringify({phase:'M1_LOCAL_ADMIN_SETUP',productId:'judoju-news',sample_kind:'SYNTHETIC',membership:'OWNED_FIXTURE_ADMIN_ONLY',secretsPrinted:false,remote:false}));
