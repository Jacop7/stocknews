import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { comparisonCommits,verifyNativeHistory } from './native-release-policy.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=args=>spawnSync('git',['-c','core.quotepath=false','-C',root,...args],{encoding:'utf8',windowsHide:true});
const names=new Set(['apps/mobile/package.json','apps/mobile/app.json','apps/mobile/app.config.ts','apps/mobile/eas.json','pnpm-lock.yaml']);
const files=git(['ls-files','--cached','--others','--exclude-standard','-z']);assert.equal(files.status,0);
for(const name of files.stdout.split('\0').filter(Boolean)) if(/^apps\/mobile\/(android|ios|plugins|patches)\//.test(name)) names.add(name);
const inputs=[...names].sort().map(name=>{const b=readFileSync(path.join(root,name));return {path:name,bytes:b.length,sha256:hash(b)};});
const digest=hash(JSON.stringify(inputs));
const record=JSON.parse(readFileSync(path.join(root,'docs/native-release.json'),'utf8'));
const app=JSON.parse(readFileSync(path.join(root,'apps/mobile/app.json'),'utf8')).expo;
let checks=0;const check=(ok,msg)=>{assert.ok(ok,msg);checks++;};
check(record.schemaVersion===1&&['NATIVE_BUILDS_COMPILED','DEVELOPMENT_VERIFIED'].includes(record.state),'Known native verification state');
assert.deepEqual(record.inputs,inputs);checks++;
check(record.digest===digest,'Native input digest matches current source');
for(const platform of ['android','ios'])check(record.runtimeVersions[platform]===app[platform].runtimeVersion&&record.runtimeVersions[platform].startsWith(platform+'-native-'),'Explicit platform runtime '+platform);
for(const platform of ['android','ios']) {
  const build=record.actualBuilds[platform];
  check(build.binaryStatus==='FINISHED'&&/^[a-f0-9-]{36}$/.test(build.buildId)&&build.runtimeVersion===record.runtimeVersions[platform],'Recorded platform build '+platform);
}
check(record.actualBuilds.android.deviceStatus==='AGENT_OBSERVED_EMULATOR','Android device verification evidence kind');
check(['PENDING_NATIVE_CONFIRMATION','USER_CONFIRMED_PHYSICAL'].includes(record.actualBuilds.ios.deviceStatus),'Explicit iOS device evidence kind');
if(record.state==='DEVELOPMENT_VERIFIED')check(record.actualBuilds.ios.deviceStatus==='USER_CONFIRMED_PHYSICAL','No complete native claim before iOS confirmation');
const branch=git(['branch','--show-current']);assert.equal(branch.status,0);
const commits=comparisonCommits({env:process.env,branch:branch.stdout.trim(),resolve:ref=>{
  const q=git(['rev-parse','--verify',ref+'^{commit}']);assert.ifError(q.error);return q.status===0?q.stdout.trim():null;
}});
verifyNativeHistory(record,commits,commit=>{
  const tree=git(['ls-tree','--name-only',commit,'--','docs/native-release.json']);assert.equal(tree.status,0,'Cannot inspect verified baseline tree');
  if(!tree.stdout.trim())return null;
  const prior=git(['show',commit+':docs/native-release.json']);assert.equal(prior.status,0,'Cannot read existing native baseline');
  return JSON.parse(prior.stdout);
});checks+=commits.length;
console.log(JSON.stringify({status:'PASS',stage:2,checks,digest,limitations:'Source/runtime consistency only; no native build or OTA certified.'},null,2));
