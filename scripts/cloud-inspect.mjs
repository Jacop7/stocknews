// No .env, credentials, network, database, subprocess or apply/repair operations.
import {fileURLToPath} from 'node:url';
import {readCloudInputs} from './cloud-source-files.mjs';
import {inspectCloudArtifact,parseCloudArgs,parseCloudJson} from './cloud-deployment-policy.mjs';
try{
  const args=process.argv.slice(2);parseCloudArgs(args);
  const inputs=readCloudInputs(fileURLToPath(new URL('../',import.meta.url))),json=p=>parseCloudJson(inputs[p]);
  const prefix='supabase/cloud/cloud03/';
  const result=inspectCloudArtifact({args,contract:json('docs/cloud/deployment-contract.json'),manifest:json('docs/project-resource-manifest.json'),
    provenance:json(prefix+'provenance.json'),source:inputs['supabase/migrations/20261114000001_m0_foundation.sql'],
    guard:inputs[prefix+'guard.sql'],seal:inputs[prefix+'seal.sql'],deployment:inputs[prefix+'dev-domain-foundation.sql']});
  console.log(JSON.stringify(result,null,2));
}catch{
  console.error(JSON.stringify({status:'BLOCKED',state:'NOT_EXECUTED_OFFLINE_ONLY',reason:'INVALID_TARGET_OR_SOURCE',sqlExecutions:0}));
  process.exitCode=1;
}
