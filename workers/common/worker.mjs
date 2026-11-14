import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
assert.equal(process.env.JUDOJU_ENV,'local','This M0 worker cannot run in preview/production');
const api=new URL(process.env.M0_RPC_URL??'');
assert.ok(api.protocol==='http:'&&!api.username&&!api.password&&!api.search&&!api.hash);
assert.ok(api.hostname==='127.0.0.1'&&api.port==='62321'||/^supabase_(?:kong|api|gateway)_judoju-news-local$/.test(api.hostname)&&api.port==='8000');
assert.equal(api.pathname,'/rest/v1/rpc');
const mock=new URL(process.env.M0_MOCK_URL??'');assert.equal(mock.origin,'http://mock:7070');assert.equal(mock.pathname,'/');
const serviceKey=process.env.M0_SERVICE_KEY,mockKey=process.env.M0_MOCK_KEY;
assert.ok(serviceKey?.length>20&&mockKey?.length>=32);
const owner='m0-'+randomUUID(),lease=Number(process.env.M0_LEASE_SECONDS??10);assert.ok(Number.isInteger(lease)&&lease>=2&&lease<=120);
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
function log(event,extra={}){console.log(JSON.stringify({product:'judoju-news',component:'M0_WORKER',owner,event,...extra}));}
async function rpc(name,args={}){
  const r=await fetch(api.href+'/'+name,{method:'POST',redirect:'error',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});
  if(!r.ok){const error=new Error('RPC_FAILED');error.code='RPC_'+r.status;throw error;}
  return await r.json();
}
async function receipt(effectKey){
  const r=await fetch(mock.origin+'/effects/'+encodeURIComponent(effectKey),{headers:{'X-Mock-Key':mockKey},redirect:'error',signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw new Error('MOCK_LOOKUP_FAILED');return await r.json();
}
async function reconcileOne(){
  const job=await rpc('m0_pending_confirmation');if(!job)return;
  const observed=await receipt(job.effect_key);
  if(observed.state==='ACCEPTED')await rpc('m0_reconcile',{p_job:job.id,p_outcome:'ACCEPTED',p_proof:observed.receipt});
  else if(observed.state==='NOT_ACCEPTED'&&observed.terminal===true)await rpc('m0_reconcile',{p_job:job.id,p_outcome:'CONFIRMED_NOT_SENT',p_proof:observed.proof});
  // UNKNOWN is not evidence of non-delivery. No POST, new key or automatic replay.
}
async function handle(job){
  assert.equal(job.environment,'local');assert.equal(job.job_schema_version,1);assert.equal(job.kind,'MOCK_EFFECT');
  const work=Number(job.payload?.work_ms??0);assert.ok(Number.isFinite(work)&&work>=0&&work<=30000);
  let leaseLost=false,beating=false,accepted=false;
  const timer=setInterval(async()=>{
    if(beating)return;beating=true;
    try{if(!await rpc('m0_heartbeat',{p_job:job.id,p_token:job.lease_token,p_lease_seconds:lease}))leaseLost=true;}
    catch{leaseLost=true;}finally{beating=false;}
  },Math.max(400,Math.floor(lease*1000/3)));
  try{
    if(work)await sleep(work);
    if(leaseLost||stopping){log('NO_EFFECT_LEASE_OR_SHUTDOWN',{jobId:job.id});return;}
    if(!await rpc('m0_mark_effect_intent',{p_job:job.id,p_token:job.lease_token})){log('INTENT_REFUSED',{jobId:job.id});return;}
    const response=await fetch(mock.origin+'/effects',{method:'POST',redirect:'error',headers:{'X-Mock-Key':mockKey,'Content-Type':'application/json'},body:JSON.stringify({effectKey:job.effect_key,mode:job.payload?.mode??'NORMAL'}),signal:AbortSignal.timeout(7000)});
    const observed=await response.json();
    if(response.ok&&observed.state==='ACCEPTED'){
      accepted=true;log('EFFECT_ACCEPTED',{jobId:job.id});
      if(job.payload?.mode==='ACK_DELAY')await sleep(6000);
      if(leaseLost||stopping)return;
      await rpc('m0_ack',{p_job:job.id,p_token:job.lease_token,p_receipt:observed.receipt});log('ACKED',{jobId:job.id});
    }else if(observed.state==='NOT_ACCEPTED'&&observed.terminal===true){
      await rpc('m0_fail',{p_job:job.id,p_token:job.lease_token,p_uncertain:false,p_error_code:'MOCK_CONFIRMED_NOT_ACCEPTED'});
    }else throw new Error('MOCK_OUTCOME_UNKNOWN');
  }catch{
    if(!leaseLost){try{await rpc('m0_fail',{p_job:job.id,p_token:job.lease_token,p_uncertain:true,p_error_code:accepted?'ACK_UNCERTAIN':'EFFECT_ACCEPTANCE_UNCERTAIN'});}catch{/* stale token or an already committed ACK: never resend */}}
    log('RECONCILIATION_REQUIRED',{jobId:job.id});
  }finally{clearInterval(timer);}
}
log('STARTED',{leaseSeconds:lease,mode:'LOCAL_MOCK_ONLY'});
while(!stopping){
  try{
    writeFileSync('/tmp/judoju-worker-heartbeat',String(Date.now()));
    await reconcileOne();
    const job=await rpc('m0_claim',{p_owner:owner,p_lease_seconds:lease});if(job)await handle(job);else await sleep(700);
  }catch(error){log('LOOP_RETRY',{code:error.code??'LOCAL_OPERATION_ERROR'});await sleep(1200);}
}
log('STOPPED');
