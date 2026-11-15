// No environment, credential, network, database, subprocess or mutation access.
import {fileURLToPath} from 'node:url';
import {readCoreInputs} from './cloud-core-files.mjs';
import {parseCoreArgs,inspectRecordedCore} from './cloud-core-policy.mjs';
try{const args=process.argv.slice(2);parseCoreArgs(args);console.log(JSON.stringify(inspectRecordedCore({args,inputs:readCoreInputs(fileURLToPath(new URL('../',import.meta.url)))}),null,2));}
catch{console.error(JSON.stringify({status:'BLOCKED',state:'NOT_EXECUTED',reason:'INVALID_TARGET_OR_RECORDED_CORE',networkRequests:0,sqlExecutions:0}));process.exitCode=1;}
