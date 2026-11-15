// Pure offline verification of a stored observation; never deployment authorization.
import assert from 'node:assert/strict';
import {digest,parseCloudJson} from './cloud-deployment-policy.mjs';
import {parseHistoryArgs,inspectRecordedHistory} from './cloud-history-policy.mjs';
export {parseCloudJson};
export const corePrefix='supabase/cloud/core-dev/';
export const expectedCoreAdoption=()=>(({
  "schemaVersion": 1,
  "productId": "judoju-news",
  "state": "RECORDED_DEV_DISABLED_CORE_APPLIED",
  "liveVerified": false,
  "organizationRef": "qfzgicohgpuogehdyzfx",
  "projectRef": "nxfpfvsdwbziowkxsxnh",
  "projectName": "judoju-news-dev",
  "physicalEnvironment": "dev",
  "logicalEnvironment": "preview",
  "observedAt": "2026-11-15T13:23:45.990186+00:00",
  "historicalBase": {
    "path": "supabase/cloud/dev/adoption.json",
    "sha256": "4a2f801f94f4741c8a7d7b6740c838d188acb843093496613705f26d663dcd39",
    "observedAt": "2026-11-15T11:35:55.193610+00:00",
    "historyRows": 2,
    "context": "HISTORICAL_CLOUD04D_TRACKING_ONLY"
  },
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
    },
    {
      "version": "20261115000101",
      "name": "cloud05a_core_disabled",
      "path": "supabase/cloud/core-dev/migrations/20261115000101_cloud05a_core_disabled.sql",
      "bytes": 88750,
      "sha256": "cd45fb900076c4ea30e5de715619363effcddb4a1eafb95d6492515d5b2456f1",
      "statementCount": 46,
      "statementCharacters": 88541,
      "statementArraySha256": "a26349c2bac4c056f855b4d7d71274177678cb64c930b7e0be1f81a0651fb306"
    }
  ],
  "config": {
    "path": "supabase/cloud/dev/config.toml",
    "bytes": 442,
    "sha256": "c681c7798f48ddd3febf7a2115e73ace57f01947a671cc8aee733cc540107ffa",
    "purpose": "ARCHIVE_NOT_CLI_WORKDIR"
  },
  "snapshots": {
    "dev": {
      "fingerprintBefore": "3e1ea72466621695b654701ab808caa4fd125e17263e325a8e698a4813bfa3dc",
      "fingerprintAfter": "77b731ebeb11479fb16dcd153c2e98d4ee5da3fbd4b7296cb15b0911f48dc5eb",
      "relations": 45
    },
    "prod": {
      "fingerprintBefore": "152880e674e3d00c089fcd6a09b9132627963c4d0a59dfe8bcf2dbbe8b9ffc79",
      "fingerprintAfter": "152880e674e3d00c089fcd6a09b9132627963c4d0a59dfe8bcf2dbbe8b9ffc79",
      "relations": 0
    }
  },
  "core": {
    "functions": 32,
    "officialHistoryRows": 3,
    "latestVersion": "20261115000101",
    "preparedBodyExecuted": true,
    "rootLocalStreamReplayed": false,
    "coreMutationRequests": 1,
    "publicAndApiExecutePrivileges": 0,
    "coveredLocalMigrations": [
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10
    ],
    "pendingLocalMigrations": [
      11,
      12,
      13,
      14,
      15,
      16,
      17,
      18,
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31,
      32,
      33,
      34,
      35,
      36,
      37,
      38,
      39,
      40,
      41,
      42,
      43,
      44,
      45,
      46,
      47,
      48,
      49,
      50
    ]
  },
  "production": {
    "projectRef": "zkzevpinuixeuyjlffwi",
    "writes": 0,
    "applicationRelations": 0
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
  "rootLocalStream": {
    "path": "supabase/migrations",
    "migrationCount": 50,
    "foundationBytes": 19011,
    "foundationSha256": "5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa",
    "cloudCompatible": false,
    "remoteUse": "FORBIDDEN"
  },
  "replay": "REPLAY_FORBIDDEN",
  "supersedes": [
    "docs/development-status.json#cloudHistory",
    "supabase/cloud/dev/adoption.json#sources",
    "supabase/cloud/dev/adoption.json#snapshots.dev",
    "supabase/cloud/dev/adoption.json#limitations"
  ],
  "precedence": "docs/development-status.json#cloudCore -> supabase/cloud/core-dev/adoption.json; supersedes listed selectors for current core state only, historical files remain unchanged",
  "postBaseline": {
    "stage": "CLOUD05B_POST_APPLY",
    "devFingerprint": "77b731ebeb11479fb16dcd153c2e98d4ee5da3fbd4b7296cb15b0911f48dc5eb",
    "files": {
      "dev-after.json": "26e0291eb3a3c578aecdc4a5860d6ab1cd26c066fbec34f68b9c1388a7c18967",
      "history-after.json": "2cae1fbd626f3a53f9ae7ca57b9bfca42630c885dccf998d84a2a090a18d9c05",
      "core-after.json": "2a9e58ac51144c3f57ccb47d276c3254fd25b1f09a68b8c713350557879f36f1",
      "prod-after.json": "ac0c7fa6fb6c3124adc7b059b20aad2887d6905d291908f02ecfb7a398eeb466"
    },
    "replayForbidden": true,
    "nextStageUses": "CLOUD05B_POST_APPLY"
  },
  "evidence": {
    "manifest": "90a12b0f54ef9e69d6b89660bbbdc56de2f158d09589150f6360cbc0e3cdef87",
    "claudeKey": "dd6c1003559a5a1f4612f073238a56cc9a4687ebebf2533710fc4e77bf099271",
    "codexKey": "623a2e9d2a75641de8c463a06a5128e82dd05bb04f574110530dc94a8712d1f9",
    "status": {
      "path": "outputs/development-stages/reviews/cloud05b-implementation/status.json",
      "sha256": "28d310f9e8fa04cc4e1e554fd1465d8d46670ceff30c74508ccdf47e391788ae"
    },
    "remoteProof": {
      "path": "outputs/development-stages/reviews/cloud05b-implementation/remote-proof.json",
      "sha256": "eed466c175779689ea8f5a8be838e1a89ad643ea95de6c79317f029f0f90e41a"
    },
    "backupSha256": "34f52eb77c7425fe2d158b6511e1225501e7b8923b6a385e52425944e1ba6321"
  },
  "limitations": [
    "Stored host observations and review receipts, not current live-state or provider-signed attestation.",
    "Core source archive is recovery material, not a remote CLI workdir or replay authorization.",
    "cloud:history:inspect reports the historical tracking-only two-row observation; cloud:core:inspect is the current recorded three-row context.",
    "Scope fingerprints exclude unspecified platform internals; static identical screenshot bytes do not prove observation time.",
    "Migrations11-50, API/runtime grants, gateway, app/admin/worker integration and M2 remain pending."
  ]
}));
export const parseCoreArgs=parseHistoryArgs;
export function inspectRecordedCore({args,inputs}){
 const target=parseCoreArgs(args),record=parseCloudJson(inputs[corePrefix+'adoption.json']);
 assert.deepEqual(record,expectedCoreAdoption(),'Exact recorded core contract');
 const old=inspectRecordedHistory({args,inputs}),historical=parseCloudJson(inputs[record.historicalBase.path]);
 assert.equal(digest(inputs[record.historicalBase.path]),record.historicalBase.sha256,'Historical base SHA');
 assert.deepEqual(record.sources.slice(0,2),historical.sources,'Original two native records');
 assert.equal(record.snapshots.dev.fingerprintBefore,historical.snapshots.dev.fingerprintAfter,'Before/after authority chain');
 assert.equal(record.snapshots.prod.fingerprintBefore,record.snapshots.prod.fingerprintAfter,'Production unchanged');
 for(const entry of [...record.sources,record.config]){const bytes=inputs[entry.path];assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.length,entry.bytes,'Source byte count');assert.equal(digest(bytes),entry.sha256,'Source SHA');assert.ok(!bytes.includes(13),'Reviewed LF source');}
 return {status:'PASS',state:'RECORDED_DEV_DISABLED_CORE_OFFLINE_VERIFIED',context:'CURRENT_RECORDED_CORE',...target,observedAt:record.observedAt,historyVersions:record.sources.map(s=>s.version),historyRows:3,functions:32,liveVerified:false,appConnected:false,workerConnected:false,replay:record.replay,networkRequests:0,sqlExecutions:0,supersedes:record.supersedes,precedence:record.precedence,historicalBase:{context:record.historicalBase.context,observedAt:old.observedAt,historyRows:old.historyVersions.length},limitations:record.limitations};
}
export function allowedCoreHistory({head,count,parents,base,hosted,pullRef,hostedSha,otherParents,otherCount,treeEqualsChild}){
 if(head===base)return count===17&&parents.length===1;
 if(count===18&&parents.length===1)return parents[0]===base;
 return count===19&&parents.length===2&&new Set(parents).size===2&&hosted&&!!pullRef&&head===hostedSha&&parents.includes(base)&&otherParents.length===1&&otherParents[0]===base&&otherCount===18&&treeEqualsChild===true;
}
