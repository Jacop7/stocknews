// Offline artifact inspection, never a database deployment authorization.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const cloud03Manifest='051fca72c1e29c195aa8819eeb71625d3005d0927d6ae5cab63b47511cc46071';
export const sourceSha256='5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa';
export const deploymentSha256='330f333ff252111d97ac68a8b55695350d545eaa524930589cecbb02396d5df9';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function parseCloudJson(bytes){
  assert.ok(Buffer.isBuffer(bytes),'JSON bytes required');const value=JSON.parse(bytes);
  assert.deepEqual(bytes,Buffer.from(JSON.stringify(value,null,2)+'\n'),'Canonical JSON bytes; duplicate keys forbidden');return value;
}
export function expectedResource(id){
  assert.ok(['supabase_preview','supabase_production'].includes(id),'Unknown resource');
  const dev=id==='supabase_preview';
  return {status:'OBSERVED_NOT_CONNECTED',actual:{productId:'judoju-news',createdNewForProduct:true,
    organizationRef:'qfzgicohgpuogehdyzfx',region:'ap-northeast-2',plan:'Free',observedAt:'2026-11-15T08:29:06.201Z',
    dataApiEnabled:false,connected:false,observationOnly:true,officialHistoryAdopted:false,evidenceManifest:cloud03Manifest,
    projectRef:dev?'nxfpfvsdwbziowkxsxnh':'zkzevpinuixeuyjlffwi',projectName:dev?'judoju-news-dev':'judoju-news-prod',
    physicalEnvironment:dev?'dev':'prod',logicalEnvironment:dev?'preview':'production',databaseState:dev?'STAGED_DISABLED':'EMPTY'}};
}
export function expectedContract(){
  return {schemaVersion:1,productId:'judoju-news',mode:'OFFLINE_SOURCE_ONLY',officialHistoryAdopted:false,
    evidenceManifest:cloud03Manifest,
    nameEvidence:{path:'outputs/development-stages/reviews/cloud01-implementation/resources.json',sha256:'3c0d450990e5122cd27b33adea1c2d741700e13bfc28e4a843b9f9c01daea143'},
    targets:['supabase_preview','supabase_production'].map(id=>({id,...expectedResource(id)})),
    artifact:{id:'foundation1',version:'20261114000001',sourcePath:'supabase/migrations/20261114000001_m0_foundation.sql',
      sourceBytes:19011,sourceSha256,guardBytes:1941,guardSha256:'90e223fdef008a609ab12c906731e23583d951a73477ec5d66ee5894d48ae75d',
      sealBytes:3193,sealSha256:'e556b2bfa61c22a2c21190d3c05a197b77f0977db24c74987e762b6870bc4056',deploymentBytes:24148,deploymentSha256},
    replay:'REPLAY_FORBIDDEN',limitations:['Historical UI observations only; not current health or connection approval.',
      'Artifact ledger is not official Supabase CLI migration history. Migrations 2–50, RPC and runtime connections remain pending.']};
}
export function parseCloudArgs(args){
  assert.ok(Array.isArray(args)&&args.length===6,'Exactly three option/value pairs required');
  const out={};
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    assert.ok(['--environment','--project-ref','--artifact'].includes(key)&&!Object.hasOwn(out,key),'Unknown/duplicate option');
    assert.equal(typeof value,'string');out[key]=value;
  }
  assert.equal(out['--environment'],'preview','Only preview inspection is allowed');
  assert.equal(out['--project-ref'],'nxfpfvsdwbziowkxsxnh','Wrong development project ref');
  assert.equal(out['--artifact'],'foundation1','Only staged foundation1 inspection is allowed');
  return {environment:'preview',projectRef:out['--project-ref'],artifact:'foundation1'};
}
export function inspectCloudArtifact({args,contract,manifest,provenance,source,guard,seal,deployment}){
  const target=parseCloudArgs(args),expected=expectedContract();
  assert.deepEqual(contract,expected,'Exact offline deployment contract');
  assert.equal(manifest.productId,'judoju-news');
  for(const id of ['supabase_preview','supabase_production']){
    const rows=manifest.resources.filter(r=>r.id===id);assert.equal(rows.length,1,'One resource per target');
    assert.equal(rows[0].environment,id==='supabase_preview'?'preview':'production');
    assert.deepEqual({status:rows[0].status,actual:rows[0].actual},expectedResource(id),'Exact target observations');
  }
  const a=expected.artifact;
  for(const [name,bytes,size,sha] of [['source',source,a.sourceBytes,a.sourceSha256],['guard',guard,a.guardBytes,a.guardSha256],
    ['seal',seal,a.sealBytes,a.sealSha256],['deployment',deployment,a.deploymentBytes,a.deploymentSha256]]){
    assert.ok(Buffer.isBuffer(bytes),name+' bytes required');assert.equal(bytes.length,size,name+' byte count');assert.equal(digest(bytes),sha,name+' SHA256');
    assert.ok(!bytes.includes(13),name+' reviewed LF bytes');
  }
  const raw=source.toString('utf8'),g='\n'+guard.toString('utf8')+'\n',s=seal.toString('utf8')+'\n';
  assert.equal((raw.match(/^begin;$/gm)||[]).length,1);assert.equal((raw.match(/^commit;$/gm)||[]).length,1);
  const start=raw.indexOf('begin;')+6,end=raw.lastIndexOf('commit;');
  const rebuilt=Buffer.from(raw.slice(0,start)+g+raw.slice(start,end)+s+raw.slice(end));
  assert.deepEqual(deployment,rebuilt,'Exact single guard/seal insertions');
  const recovered=deployment.toString('utf8').replace(g,'').replace(s,'');assert.deepEqual(Buffer.from(recovered),source,'Original source reconstruction');
  assert.equal(provenance.source,a.sourcePath);assert.equal(provenance.sourceBytes,a.sourceBytes);assert.equal(provenance.sourceSha256,a.sourceSha256);
  assert.equal(provenance.guardSha256,a.guardSha256);assert.equal(provenance.sealSha256,a.sealSha256);assert.equal(provenance.deploymentSha256,a.deploymentSha256);
  assert.deepEqual(provenance.sourceTables,[...raw.matchAll(/create table ([a-z_]+\.[a-z_]+)/gi)].map(x=>x[1]));
  assert.equal(provenance.sourceTableCount,42);assert.equal(provenance.sourceView,'public.news_list');
  assert.equal(provenance.devPhysicalProject,target.projectRef);assert.equal(provenance.logicalRuntimeEnvironment,'preview');
  assert.equal(provenance.appConnected,false);assert.equal(provenance.dataApiEnabled,false);
  assert.equal(provenance.applicationMigrationLedger,'judoju_control.schema_artifacts; NOT Supabase CLI migration history');
  return {status:'PASS',state:'NOT_EXECUTED_OFFLINE_ONLY',...target,sourceSha256,deploymentSha256,replay:'REPLAY_FORBIDDEN',
    officialHistoryAdopted:false,networkRequests:0,sqlExecutions:0,limitations:[...expected.limitations]};
}

// Shape checks, not cryptographic authentication of CI environment variables.
export function allowedCloudHistory({head,count,parents,base,hosted,pullRef,hostedSha,otherParents,otherCount,treeEqualsChild}){
  if(head===base)return count===15&&parents.length===1;
  if(count===16&&parents.length===1)return parents[0]===base;
  return count===17&&parents.length===2&&new Set(parents).size===2&&hosted&&!!pullRef&&head===hostedSha&&
    parents.includes(base)&&otherParents.length===1&&otherParents[0]===base&&otherCount===16&&treeEqualsChild===true;
}
export function allowedCloudMain({localMain,remoteMain,base,branch,head,hosted,pullRef}){
  if(remoteMain!==null&&remoteMain!==base&&remoteMain!==head)return false;
  if(localMain!==null)return localMain===base||branch==='main'&&localMain===head;
  return hosted===true&&!!pullRef&&remoteMain===base;
}
