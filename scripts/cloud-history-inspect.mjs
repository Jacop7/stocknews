// No env/credential/network/database/subprocess or apply/repair operations.
import {fileURLToPath} from 'node:url';
import {readHistoryInputs} from './cloud-history-files.mjs';
import {parseHistoryArgs,inspectRecordedHistory} from './cloud-history-policy.mjs';
try{
 const args=process.argv.slice(2);parseHistoryArgs(args);
 console.log(JSON.stringify(inspectRecordedHistory({args,inputs:readHistoryInputs(fileURLToPath(new URL('../',import.meta.url)))}),null,2));
}catch{console.error(JSON.stringify({status:'BLOCKED',state:'NOT_EXECUTED',reason:'INVALID_TARGET_OR_RECORDED_SOURCE',networkRequests:0,sqlExecutions:0}));process.exitCode=1;}
