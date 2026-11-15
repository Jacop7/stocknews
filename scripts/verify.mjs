import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync,readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const results = [];
for (const script of ['verify-toolchain.mjs', 'verify-foundation.mjs', 'verify-native-release.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {encoding:'utf8', windowsHide:true});
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stderr || String(result.error));
    process.stdout.write(result.stdout || '');
    process.exit(result.status || 1);
  }
  results.push(JSON.parse(result.stdout));
}
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const manager=realpathSync(process.env.npm_execpath || '');
assert.ok(!path.relative(root,manager).startsWith('..'),'Use product-local Corepack/pnpm cache');
const stage=JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).currentStage;
for (const script of ['test:domain',...(stage>=3?['test:providers']:[]),...(stage>=4?['test:m0-contracts']:[]),...(stage>=5?['test:m1-contracts']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).catalogPreparation?.stage==='6A'?['test:catalog']:[]),...(stage>=6?['test:catalog-connection']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).searchBookmarks?.stage==='6C'?['test:search-bookmarks']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).installationAnalytics?.stage==='6D'?['test:installation']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).reservationMaintenance?.stage==='6E'?['test:reservations']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).marketMetricsPreparation?.stage==='7A'?['test:market-metrics']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).issuePriorityPreparation?.stage==='7B1'?['test:issue-priority']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).homeSnapshotPreparation?.stage==='7B2A'?['test:home-snapshot']:[]),'check:types','build:admin','export:android','export:ios']) {
  const result=spawnSync(process.execPath,[manager,'run',script],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,EXPO_NO_TELEMETRY:'1',NEXT_TELEMETRY_DISABLED:'1',CI:'1'},maxBuffer:16*1024*1024});
  if(result.error||result.status!==0){process.stderr.write(result.stderr||String(result.error));process.stdout.write(result.stdout||'');process.exit(result.status||1);}
  results.push({name:script,status:'PASS',exitCode:result.status,stdout:result.stdout,stderr:result.stderr});
}
console.log(JSON.stringify({status:'PASS', stage, results, limitations:'Local checks, web production build and platform JS/Hermes exports only. No Android/iOS native binaries or cloud operation certified.'}, null, 2));
