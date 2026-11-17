import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync,readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {assertEnvironmentBoundary} from './admin-preview-policy.mjs';
import {controlledEnvironment} from '../apps/admin/lib/preview-file-boundary.mjs';
assertEnvironmentBoundary();
const verifierEnvironment={...controlledEnvironment(),npm_config_user_agent:'pnpm/11.25.0'};
const results = [];
const p4=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).parallelDurablePreparation?.stage==='MAIN_PARALLEL_P4';
const c1b=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).adminC1bPreparation?.stage==='MAIN_ADMIN_C1B';
const p3=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).parallelOperationalBoundaries?.stage==='MAIN_PARALLEL_P3';
const p2=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).parallelProgressBinding?.stage==='MAIN_PARALLEL_P2';
const p1=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).parallelSourceImplementation?.stage==='MAIN_PARALLEL_P1';
const r1=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).sourceReceiptPreparation?.stage==='MAIN_SOURCE_R1';
const a1=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).mainAiMetadataPreparation?.stage==='MAIN_AI_A1';
const g0b=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).parallelContractSemanticsPreparation?.stage==='PARALLEL4_G0B';
const parallel4=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).parallelDevelopmentPreparation?.stage==='PARALLEL4_G0A';
const adminPreview=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).cloudAdminPreviewPreparation?.stage==='CLOUD11A';
for (const script of ['verify-toolchain.mjs', p4?'verify-parallel-p4-foundation.mjs':c1b?'verify-admin-c1b-foundation.mjs':p3?'verify-parallel-p3-foundation.mjs':p2?'verify-parallel-p2-foundation.mjs':p1?'verify-parallel-p1-foundation.mjs':r1?'verify-source-r1-foundation.mjs':a1?'verify-main-ai-a1-foundation.mjs':g0b?'verify-parallel4-g0b-foundation.mjs':parallel4?'verify-parallel4-g0-foundation.mjs':adminPreview?'verify-cloud11a-foundation.mjs':'verify-cloud10b-foundation.mjs', 'verify-foundation.mjs', 'verify-native-release.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {encoding:'utf8', windowsHide:true,env:verifierEnvironment});
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
for (const script of ['test:domain',...(stage>=3?['test:providers']:[]),...(stage>=4?['test:m0-contracts']:[]),...(stage>=5?['test:m1-contracts']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).catalogPreparation?.stage==='6A'?['test:catalog']:[]),...(stage>=6?['test:catalog-connection']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).searchBookmarks?.stage==='6C'?['test:search-bookmarks']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).installationAnalytics?.stage==='6D'?['test:installation']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).reservationMaintenance?.stage==='6E'?['test:reservations']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).marketMetricsPreparation?.stage==='7A'?['test:market-metrics']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).issuePriorityPreparation?.stage==='7B1'?['test:issue-priority']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).homeSnapshotPreparation?.stage==='7B2A'?['test:home-snapshot']:[]),...(JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8')).homeRankingPreparation?.stage==='7B2B'?['test:home-ranking']:[]),'test:cloud-deployment','test:cloud-history','test:cloud-core','test:cloud-preview-read',...(adminPreview?['test:preview-admin']:[]),...(parallel4?['test:pipeline-contracts','test:parallel4-readiness']:[]),...(g0b?['test:pipeline-semantics','test:pipeline-ranking']:[]),...(a1?['test:ai-intake','check:ai-intake']:[]),...(r1?['test:source-receipts','check:source-receipts']:[]),...(p1?['test:acquisition','test:collector-inventory','test:home-worker-adapter','check:home-worker-adapter']:[]),...(p2?['test:collector-partition','test:rankable-batch','test:event-routing']:[]),...(p3?['test:collector-read-boundary','test:home-bound','test:analysis-input','test:admin-preview-lifecycle','check:home-ranking']:[]),...(c1b?['test:admin-preview-config-writer','test:admin-preview-supervisor','test:admin-preview-host']:[]),...(p4?['test:collector-db-capture','test:home-database-bound','test:durable-analysis-input']:[]),'check:types','build:admin','export:android','export:ios']) {
  const result=spawnSync(process.execPath,[manager,'run',script],{cwd:root,encoding:'utf8',windowsHide:true,env:verifierEnvironment,maxBuffer:16*1024*1024});
  if(result.error||result.status!==0){process.stderr.write(result.stderr||String(result.error));process.stdout.write(result.stdout||'');process.exit(result.status||1);}
  results.push({name:script,status:'PASS',exitCode:result.status,stdout:result.stdout,stderr:result.stderr});
}
if(p4||p3||p2||p1||r1||a1||g0b){const artifactCheck=spawnSync(process.execPath,[fileURLToPath(new URL(p4?'verify-parallel-p4-foundation.mjs':c1b?'verify-admin-c1b-foundation.mjs':p3?'verify-parallel-p3-foundation.mjs':p2?'verify-parallel-p2-foundation.mjs':p1?'verify-parallel-p1-foundation.mjs':r1?'verify-source-r1-foundation.mjs':a1?'verify-main-ai-a1-foundation.mjs':'verify-parallel4-g0b-foundation.mjs',import.meta.url)),'--artifacts'],{cwd:root,encoding:'utf8',windowsHide:true,env:verifierEnvironment});if(artifactCheck.error||artifactCheck.status!==0){process.stderr.write(artifactCheck.stderr||String(artifactCheck.error));process.exit(artifactCheck.status||1);}results.push({name:'pipeline-artifact-boundary',status:'PASS',stdout:artifactCheck.stdout});}
console.log(JSON.stringify({status:'PASS', stage, results, limitations:'Local checks, web production build and platform JS/Hermes exports only. No Android/iOS native binaries or cloud operation certified.'}, null, 2));
