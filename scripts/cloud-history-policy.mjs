// Recorded history integrity only: no connection, SQL execution or live attestation.
import assert from 'node:assert/strict';
import {digest,parseCloudJson} from './cloud-deployment-policy.mjs';
export {parseCloudJson};
export const historyPrefix='supabase/cloud/dev/';
export const expectedAdoption=()=>({
  "schemaVersion": 1,
  "productId": "judoju-news",
  "state": "RECORDED_ADOPTED_DISABLED",
  "liveVerified": false,
  "organizationRef": "qfzgicohgpuogehdyzfx",
  "projectRef": "nxfpfvsdwbziowkxsxnh",
  "projectName": "judoju-news-dev",
  "physicalEnvironment": "dev",
  "logicalEnvironment": "preview",
  "observedAt": "2026-11-15T11:35:55.193610+00:00",
  "recordedOfficialHistoryAdopted": true,
  "method": "MANAGEMENT_API_TRACKING_ONLY_SQL_NOT_REMOTE_CLI",
  "remoteHistoryWrites": 1,
  "sources": [
    {
      "version": "20261114000000",
      "name": "cloud02_dev_control",
      "path": "supabase/cloud/dev/migrations/20261114000000_cloud02_dev_control.sql",
      "bytes": 2956,
      "sha256": "a58a6453802cb785087ccd7cc3bcfd536b7c7f8b765fe6822f0e66e9a0eadb1e",
      "statementCount": 16,
      "statementCharacters": 2924,
      "statementArraySha256": "abc9505f190dd3487bd9c25f8c86a5408bc5ee380ac7247ad357e3282ec67eec"
    },
    {
      "version": "20261114000001",
      "name": "cloud03_dev_domain_foundation",
      "path": "supabase/cloud/dev/migrations/20261114000001_cloud03_dev_domain_foundation.sql",
      "bytes": 24148,
      "sha256": "330f333ff252111d97ac68a8b55695350d545eaa524930589cecbb02396d5df9",
      "statementCount": 87,
      "statementCharacters": 23970,
      "statementArraySha256": "4971cb4aaf88ac8e658b22997955898eff3150074c499a09c52776c35500a306"
    }
  ],
  "config": {
    "path": "supabase/cloud/dev/config.toml",
    "bytes": 442,
    "sha256": "c681c7798f48ddd3febf7a2115e73ace57f01947a671cc8aee733cc540107ffa",
    "purpose": "ARCHIVE_NOT_CLI_WORKDIR"
  },
  "rootLocalStream": {
    "path": "supabase/migrations",
    "migrationCount": 50,
    "foundationBytes": 19011,
    "foundationSha256": "5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa",
    "cloudCompatible": false,
    "remoteUse": "FORBIDDEN"
  },
  "snapshots": {
    "dev": {
      "fingerprintBefore": "3e1ea72466621695b654701ab808caa4fd125e17263e325a8e698a4813bfa3dc",
      "fingerprintAfter": "3e1ea72466621695b654701ab808caa4fd125e17263e325a8e698a4813bfa3dc",
      "relations": 45
    },
    "prod": {
      "fingerprintBefore": "152880e674e3d00c089fcd6a09b9132627963c4d0a59dfe8bcf2dbbe8b9ffc79",
      "fingerprintAfter": "152880e674e3d00c089fcd6a09b9132627963c4d0a59dfe8bcf2dbbe8b9ffc79",
      "relations": 0
    }
  },
  "production": {
    "projectRef": "zkzevpinuixeuyjlffwi",
    "recordedOfficialHistoryAdopted": false,
    "writes": 0
  },
  "runtime": {
    "dataApiDevEnabled": false,
    "dataApiProdEnabled": false,
    "plan": "Free",
    "appConnected": false,
    "workerConnected": false,
    "M2": false,
    "rightsHoldCount": 112,
    "iPhone": "USER_DEFERRED"
  },
  "history": {
    "relation": "supabase_migrations.schema_migrations",
    "owner": "postgres",
    "rls": false,
    "forceRls": false,
    "apiRolePrivileges": 0,
    "originalSqlReplayed": false
  },
  "artifactLedger": "judoju_control.schema_artifacts; distinct from official Supabase migration history",
  "replay": "REPLAY_FORBIDDEN",
  "supersedes": [
    "docs/project-resource-manifest.json#resources.supabase_preview.actual.officialHistoryAdopted",
    "docs/cloud/deployment-contract.json#officialHistoryAdopted",
    "docs/development-status.json#cloudDeployment.officialHistoryAdopted"
  ],
  "precedence": "docs/development-status.json#cloudHistory -> supabase/cloud/dev/adoption.json; listed CLOUD04A fields are historical observations",
  "evidence": {
    "manifest": "ec5655dfcee7bd0a75e81ae6a02a8224c562ebeb67f43fa4658562bab88f24e6",
    "claudeKey": "c369fbd3490062d45037569fb723750d5fc97d044f469c9e49af2be205d33c64",
    "codexKey": "4a458a6ed85e92fdf8e78ed1fa5f4afafbc19b0a982a45a8c408612feb3aae77",
    "status": {
      "path": "outputs/development-stages/reviews/cloud04d-implementation/status.json",
      "sha256": "569b5a25c9d25932c54f0ce0e78c5333b30f5da01db97affc39e5bfb26cd686e"
    },
    "remoteProof": {
      "path": "outputs/development-stages/reviews/cloud04d-implementation/remote-proof.json",
      "sha256": "7445067ff7ee16c9bb0518c2146f7d479119c13fa5f9433397d810494df14b8c"
    },
    "backupSha256": "205664d859f1477ecc33b87fa7a55b98c833f686200e84b23314a087beb7abee"
  },
  "limitations": [
    "Stored host observations and review receipts, not provider-signed or current live-state proof.",
    "Scoped fingerprints exclude unspecified platform internals and expected DDL-trigger notifications.",
    "Version dates are ordering identifiers; observedAt is the history adoption post-read time.",
    "No cloud migrations 2–50, RPC, runtime connection or production readiness."
  ]
});
export function parseHistoryArgs(args){
 assert.ok(Array.isArray(args)&&args.length===4,'Exactly two option/value pairs');
 const out={}; for(let i=0;i<4;i+=2){const k=args[i]; assert.ok(['--environment','--project-ref'].includes(k)&&!Object.hasOwn(out,k),'Unknown/duplicate option');out[k]=args[i+1];}
 assert.equal(out['--environment'],'preview','Preview only'); assert.equal(out['--project-ref'],'nxfpfvsdwbziowkxsxnh','Exact dev ref');
 return {environment:'preview',projectRef:out['--project-ref']};
}
export function inspectRecordedHistory({args,inputs}){
 const target=parseHistoryArgs(args),record=parseCloudJson(inputs[historyPrefix+'adoption.json']),expected=expectedAdoption();
 assert.deepEqual(record,expected,'Exact recorded disabled history contract');
 for(const entry of [...record.sources,record.config]){
  const bytes=inputs[entry.path];assert.ok(Buffer.isBuffer(bytes),'Source bytes required');assert.equal(bytes.length,entry.bytes,'Source byte count');assert.equal(digest(bytes),entry.sha256,'Source SHA256');assert.ok(!bytes.includes(13),'Reviewed LF source');
 }
 const local=inputs['supabase/migrations/20261114000001_m0_foundation.sql'];
 assert.equal(local.length,record.rootLocalStream.foundationBytes);assert.equal(digest(local),record.rootLocalStream.foundationSha256);
 assert.ok(!local.equals(inputs[record.sources[1].path]),'Distinct local and cloud streams');
 assert.deepEqual(inputs[record.sources[1].path],inputs['supabase/cloud/cloud03/dev-domain-foundation.sql'],'Original guarded deployment bytes');
 const provenance=parseCloudJson(inputs['supabase/cloud/cloud03/provenance.json']);
 assert.equal(provenance.sourceSha256,record.rootLocalStream.foundationSha256);assert.equal(provenance.deploymentSha256,record.sources[1].sha256);
 return {status:'PASS',state:'RECORDED_ADOPTED_DISABLED_OFFLINE_VERIFIED',...target,observedAt:record.observedAt,recordedOfficialHistoryAdopted:true,liveVerified:false,appConnected:false,workerConnected:false,replay:record.replay,supersedes:record.supersedes,precedence:record.precedence,historyVersions:record.sources.map(s=>s.version),networkRequests:0,sqlExecutions:0,limitations:record.limitations};
}
export function allowedRecordedHistory({head,count,parents,base,hosted,pullRef,hostedSha,otherParents,otherCount,treeEqualsChild}){
 if(head===base)return count===16&&parents.length===1;
 if(count===17&&parents.length===1)return parents[0]===base;
 return count===18&&parents.length===2&&new Set(parents).size===2&&hosted&&!!pullRef&&head===hostedSha&&parents.includes(base)&&otherParents.length===1&&otherParents[0]===base&&otherCount===17&&treeEqualsChild===true;
}
