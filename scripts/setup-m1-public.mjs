import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { localClient } from './m0-test-client.mjs';
import { runtimeDir,writePrivate } from './local-runtime.mjs';
const f=localClient(),credentials=JSON.parse(readFileSync(path.join(runtimeDir,'credentials.json'),'utf8'));
const value={productId:'judoju-news',environment:'local',sampleKind:'SYNTHETIC',bootstrapId:f.id.bootstrapId,apiUrl:'http://127.0.0.1:62321',anonKey:credentials.anonKey,webOrigins:['http://127.0.0.1:8084','http://127.0.0.1:8085']};
const file=path.join(runtimeDir,'public-read.json');if(existsSync(file)){const prior=JSON.parse(readFileSync(file,'utf8'));if(prior.bootstrapId!==f.id.bootstrapId)throw new Error('PRODUCT_FINGERPRINT_MISMATCH');}
writePrivate('public-read.json',value);console.log(JSON.stringify({phase:'M1_PUBLIC_READ_CONFIG',serviceKeyIncluded:false,adminCredentialsIncluded:false,remote:false}));
