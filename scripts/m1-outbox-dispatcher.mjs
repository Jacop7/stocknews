import { setTimeout as sleep } from 'node:timers/promises';
import { localClient } from './m0-test-client.mjs';
const f=localClient();let stop=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop=true;});
console.log(JSON.stringify({component:'M1_OUTBOX_DISPATCHER',mode:'LOCAL_MOCK_ONLY',product:'judoju-news'}));
do{
  try{const r=await f.rpc('m1_dispatch_outbox',{p_limit:50});if(r.status!==200)throw new Error('DISPATCH_FAILED');if(r.body.length)console.log(JSON.stringify({event:'ENQUEUED',count:r.body.length}));}
  catch{console.log(JSON.stringify({event:'LOCAL_DISPATCH_RETRY',effectResend:false}));}
  if(process.argv.includes('--once'))break;await sleep(1000);
}while(!stop);
