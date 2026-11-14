import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { localClient } from './m0-test-client.mjs';
import { docker,must,writePrivate } from './local-runtime.mjs';
const {id,sql,asyncSql,rpc,request,jwt,quote:q}=localClient(),run=randomUUID(),cases=[];
const project='judoju-news-worker-local';
const workers=must(docker(['ps','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=worker','--format','{{.ID}}']),'Owned workers').split(/\r?\n/).filter(Boolean);assert.equal(workers.length,2);
for(const cid of workers){const c=JSON.parse(must(docker(['container','inspect',cid,'--format','{{json .}}']),'Worker ownership'));assert.equal(c.Config.Labels['com.judoju.bootstrap'],id.bootstrapId);}
async function test(name,fn){const start=Date.now();try{await fn();cases.push({name,status:'PASS',durationMs:Date.now()-start});console.log(JSON.stringify(cases.at(-1)));}catch(e){cases.push({name,status:'FAIL',durationMs:Date.now()-start,error:e.message});throw e;}}
async function ok(name,args={},opts={}){const r=await rpc(name,args,opts);assert.equal(r.status,200,name+' status ('+(r.body?.code??'none')+')');return r.body;}
async function denied(name,args,pattern,opts={}){const r=await rpc(name,args,opts);assert.ok(r.status>=400,name+' must fail');if(pattern)assert.match(r.body?.message??'',pattern);return r;}
const enqueue=(key,extra={})=>ok('m0_enqueue',{p_effect_key:run+':'+key,p_payload:{fixture_run_id:run,mode:'NORMAL',...extra}});
const jobState=j=>ok('m0_job_status',{p_job:j.id});
const endJob=j=>sql('update private.jobs set state=\'CANCELLED\',lease_token=null,lease_until=null where id='+q(j.id)+' and payload->>\'fixture_run_id\'='+q(run)+';');
must(docker(['pause',...workers]),'Pause own consumers for controlled DB queue cases');
let paused=true,failed,unknownEarlier;
try{
  await test('DB/RLS: private tables and new table/function defaults deny anon and authenticated',async()=>{
    assert.equal(sql("select count(*) from pg_tables where schemaname='private' and not rowsecurity;"),'0');
    const a=await request('news_public?select=body',{role:'anon'});assert.equal(a.status,401);
    const b=await request('jobs?select=*',{role:'anon'});assert.ok(b.status>=400);
    sql('create table public.m0_default_guard_'+run.replaceAll('-','')+' (v text); notify pgrst,\'reload schema\';');await sleep(500);
    assert.equal(sql("select has_table_privilege('anon','public.m0_default_guard_"+run.replaceAll('-','')+"','select');"),'f');
    const table='m0_default_guard_'+run.replaceAll('-','');
    const write=await request(table,{method:'POST',data:{v:'SYNTHETIC'},role:'anon'});assert.ok(write.status>=400);
    const func='m0_default_fn_'+run.replaceAll('-','');
    // Deliberately no function-specific REVOKE: prove the actual creating
    // role's default, then explicitly grant only the server for route visibility.
    sql('create function public.'+func+"() returns boolean language sql as 'select true';");
    assert.equal(sql("select pg_get_userbyid(proowner) from pg_proc where oid='public."+func+"()'::regprocedure;"),'postgres');
    for(const role of ['anon','authenticated'])assert.equal(sql("select has_function_privilege('"+role+"','public."+func+"()','EXECUTE');"),'f');
    sql('grant execute on function public.'+func+"() to service_role; notify pgrst,'reload schema';");
    let available=false;for(let n=0;n<20;n++){const r=await rpc(func);if(r.status===200){assert.equal(r.body,true);available=true;break;}await sleep(100);}assert.ok(available,'Real RPC exists for explicitly granted server');
    for(const options of [{role:'anon'},{token:jwt({role:'authenticated',sub:randomUUID()})}]){const r=await rpc(func,{},options);assert.ok(r.status>=400,'Unprivileged RPC must fail');}
  });
  await test('Roles: anon/general/user_metadata spoof rejected',async()=>{
    await denied('m0_enqueue',{p_effect_key:run+':forbidden'},null,{role:'anon'});
    for(const claims of [{role:'authenticated',sub:randomUUID()},{role:'authenticated',sub:randomUUID(),user_metadata:{app_role:'admin'}}])await denied('m0_requeue_dlq',{p_job:randomUUID(),p_reason:'fixture'},/EDITOR_ONLY/,{token:jwt(claims)});
  });
  await test('P01: concurrent enqueue binds one immutable effect payload',async()=>{
    const jobs=await Promise.all(Array.from({length:12},()=>enqueue('same')));assert.equal(new Set(jobs.map(j=>j.id)).size,1);
    await denied('m0_enqueue',{p_effect_key:run+':same',p_payload:{fixture_run_id:run,mode:'DROP_RESPONSE'}},/EFFECT_PAYLOAD_CONFLICT/);endJob(jobs[0]);
    for(const field of [{p_environment:'production'},{p_kind:'NEWS_FETCH'},{p_schema_version:999}])await denied('m0_enqueue',{p_effect_key:run+':bad',...field},/UNSUPPORTED_JOB_CONTRACT/);
    await denied('m0_enqueue',{p_effect_key:run+':bad-url',p_payload:{url:'https://example.invalid'}},/UNSUPPORTED_JOB_PAYLOAD/);
  });
  await test('P01: SKIP LOCKED leases and fenced ACK/heartbeat',async()=>{
    const j=await enqueue('claim'),claims=await Promise.all(Array.from({length:10},(_,n)=>ok('m0_claim',{p_owner:'fixture-'+n,p_lease_seconds:3})));
    const taken=claims.filter(Boolean);assert.equal(taken.length,1);assert.equal(taken[0].id,j.id);
    await denied('m0_ack',{p_job:j.id,p_token:randomUUID(),p_receipt:'bad'},/STALE_LEASE/);
    await denied('m0_ack',{p_job:j.id,p_token:taken[0].lease_token,p_receipt:'no-intent'},/EFFECT_INTENT_REQUIRED/);
    await denied('m0_fail',{p_job:j.id,p_token:taken[0].lease_token,p_uncertain:null,p_error_code:'MISSING_UNCERTAINTY'},/UNCERTAINTY_REQUIRED/);assert.equal((await jobState(j)).state,'LEASED');
    assert.equal(await ok('m0_heartbeat',{p_job:j.id,p_token:randomUUID()}),false);
    assert.equal(await ok('m0_mark_effect_intent',{p_job:j.id,p_token:taken[0].lease_token}),true);
    assert.equal(await ok('m0_mark_effect_intent',{p_job:j.id,p_token:taken[0].lease_token}),false);
    assert.equal((await ok('m0_ack',{p_job:j.id,p_token:taken[0].lease_token,p_receipt:run+':receipt'})).status,'APPLIED');
    assert.equal((await ok('m0_ack',{p_job:j.id,p_token:taken[0].lease_token,p_receipt:run+':receipt'})).status,'ALREADY_APPLIED');
  });
  await test('P01: lease expiry before dispatch reclaims; old token fails',async()=>{
    const j=await enqueue('expiry'),first=await ok('m0_claim',{p_owner:'first',p_lease_seconds:1});await sleep(1200);
    const next=await ok('m0_claim',{p_owner:'next',p_lease_seconds:5});assert.equal(next.id,j.id);assert.notEqual(first.lease_token,next.lease_token);assert.equal(next.attempt,2);
    assert.equal(await ok('m0_mark_effect_intent',{p_job:j.id,p_token:first.lease_token}),false);endJob(j);
  });
  await test('P01: expired dispatch enters confirmation hold without retry',async()=>{
    const j=await enqueue('uncertain'),lease=await ok('m0_claim',{p_owner:'uncertain',p_lease_seconds:1});await ok('m0_mark_effect_intent',{p_job:j.id,p_token:lease.lease_token});await sleep(1200);
    assert.equal(await ok('m0_claim',{p_owner:'cannot-retry',p_lease_seconds:5}),null);assert.equal((await jobState(j)).state,'WAIT_CONFIRMATION');
    const historyBefore=sql('select effect_state from private.job_attempts where job_id='+q(j.id)+' order by attempt;');
    await denied('m0_reconcile',{p_job:j.id,p_outcome:null,p_proof:'SYNTHETIC_NOT_A_TERMINAL_DECISION'},/TERMINAL_PROVIDER_PROOF_REQUIRED/);
    assert.equal((await jobState(j)).state,'WAIT_CONFIRMATION');assert.equal(sql('select effect_state from private.job_attempts where job_id='+q(j.id)+' order by attempt;'),historyBefore);
    await denied('m0_reconcile',{p_job:j.id,p_outcome:'NOT_FOUND',p_proof:'lookup absent'},/TERMINAL_PROVIDER_PROOF_REQUIRED/);
    await ok('m0_reconcile',{p_job:j.id,p_outcome:'ACCEPTED',p_proof:run+':accepted-proof'});assert.equal((await jobState(j)).state,'SUCCEEDED');
  });
  await test('P01: bounded retries/DLQ/replay preserve key and history',async()=>{
    const j=await enqueue('dlq');sql('update private.jobs set max_attempts=1 where id='+q(j.id)+';');
    const claim=await ok('m0_claim',{p_owner:'fail',p_lease_seconds:5});await ok('m0_fail',{p_job:j.id,p_token:claim.lease_token,p_uncertain:false,p_error_code:'FIXTURE_NOT_SENT'});
    assert.equal((await jobState(j)).state,'DLQ');await denied('m0_requeue_dlq',{p_job:j.id,p_reason:''},/REPLAY_REASON_REQUIRED/);
    const replay=await ok('m0_requeue_dlq',{p_job:j.id,p_reason:'fixture confirmed not sent'});assert.equal(replay.effect_key,run+':dlq');
    const second=await ok('m0_claim',{p_owner:'replay',p_lease_seconds:5});assert.equal(second.attempt,2);endJob(j);
  });
  await test('P01: REST statement/transaction timeout rolls back prior write',async()=>{
    const count=()=>sql("select count(*) from private.audits where action='TIMEOUT_PROBE';");const before=count(),start=Date.now();
    const response=await rpc('m0_hold_for_timeout',{p_seconds:7});assert.ok(response.status>=400,'Long REST transaction must abort');assert.ok(Date.now()-start<6500,'5s bound must be effective');assert.equal(count(),before,'Timed-out write rolled back');
  });
  await test('P01: actual REST lock timeout at 2s rolls back prior write',async()=>{
    const count=()=>sql("select count(*) from private.audits where action='LOCK_TIMEOUT_PROBE';"),before=count();
    const locker=asyncSql('begin;set local application_name='+q('m0-lock-'+run)+";select 1 from private.runtime_identity where singleton for update;select pg_sleep(4);commit;");
    try{
      let locked=false;for(let n=0;n<20;n++){if(sql('select count(*) from pg_stat_activity where application_name='+q('m0-lock-'+run)+" and wait_event='PgSleep';")==='1'){locked=true;break;}await sleep(50);}assert.ok(locked,'Observed actual owning lock');
      const start=Date.now(),r=await rpc('m0_lock_probe');assert.ok(r.status>=400);assert.match(r.body?.message??'',/lock timeout/);assert.ok(Date.now()-start<3200,'Actual 2s lock bound');assert.equal(count(),before);
    }finally{await locker;}
  });
  // Earlier UNKNOWN is not proof of non-delivery and must not starve later receipts.
  unknownEarlier=await enqueue('earlier-unknown');
  const uncertainLease=await ok('m0_claim',{p_owner:'unknown-no-post',p_lease_seconds:20});assert.equal(uncertainLease.id,unknownEarlier.id);
  await ok('m0_mark_effect_intent',{p_job:unknownEarlier.id,p_token:uncertainLease.lease_token});
  await ok('m0_fail',{p_job:unknownEarlier.id,p_token:uncertainLease.lease_token,p_uncertain:true,p_error_code:'SYNTHETIC_UNKNOWN_NO_POST'});
  must(docker(['unpause',...workers]),'Resume own consumers');paused=false;
  await test('P01 Docker: two consumers and durable sink accept effect once',async()=>{
    const j=await enqueue('docker-normal');await waitSuccess(j);assert.equal((await mockReceipt(j.effect_key)).acceptedCount,1);
    await Promise.all(Array.from({length:6},()=>enqueue('docker-normal')));assert.equal((await mockReceipt(j.effect_key)).acceptedCount,1);
  });
  await test('P01 Docker: earlier UNKNOWN stays held while later lost response reconciles',async()=>{
    const j=await enqueue('drop-response',{mode:'DROP_RESPONSE'});await waitSuccess(j);assert.equal((await mockReceipt(j.effect_key)).acceptedCount,1);
    const held=await jobState(unknownEarlier);assert.equal(held.state,'WAIT_CONFIRMATION');assert.equal(held.attempts,1);assert.equal((await mockReceipt(unknownEarlier.effect_key)).state,'UNKNOWN');
  });
  await test('P01 Docker: heartbeat retains lease during work longer than lease',async()=>{
    const j=await enqueue('long-work',{work_ms:7000});await waitSuccess(j);assert.equal((await jobState(j)).attempts,1);assert.equal((await mockReceipt(j.effect_key)).acceptedCount,1);
  });
  await test('P01 Docker: kill after acceptance before ACK; recover without repeat',async()=>{
    const j=await enqueue('crash-after-effect',{mode:'ACK_DELAY'});let victim;
    for(let n=0;n<60;n++){
      const receipt=await mockReceipt(j.effect_key);
      if(receipt.state==='ACCEPTED'){
        const owner=sql('select lease_owner from private.jobs where id='+q(j.id)+';');
        victim=workers.find(cid=>{const logs=docker(['logs','--tail','200',cid]);return logs.stdout.split(/\r?\n/).filter(Boolean).some(line=>{try{const l=JSON.parse(line);return l.owner===owner&&l.jobId===j.id&&l.event==='EFFECT_ACCEPTED';}catch{return false;}});});
        if(victim)break;
      }
      await sleep(100);
    }
    assert.ok(victim,'Observed exact owning worker after accepted effect');
    must(docker(['kill','--signal','KILL',victim]),'Kill only own fixture consumer');
    try{await waitSuccess(j);assert.equal((await mockReceipt(j.effect_key)).acceptedCount,1);}
    finally{must(docker(['start',victim]),'Restart own fixture consumer');}
  });
  await test('P01 Docker: mock restart preserves durable accepted receipt',async()=>{
    const j=await enqueue('durable');await waitSuccess(j);const before=await mockReceipt(j.effect_key);
    const mockId=must(docker(['ps','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=mock','--format','{{.ID}}']),'Own mock');
    const c=JSON.parse(must(docker(['container','inspect',mockId,'--format','{{json .}}']),'Own mock identity'));assert.equal(c.Config.Labels['com.judoju.bootstrap'],id.bootstrapId);
    must(docker(['restart',mockId]),'Restart only own durable mock');
    let after;for(let n=0;n<30;n++){try{after=await mockReceipt(j.effect_key);break;}catch{await sleep(300);}}
    assert.equal(after?.receipt,before.receipt);assert.equal(after?.acceptedCount,1);
  });
  await test('P02a: actual pg_cron to queue to Docker receipt and ACK',async()=>{
    await ok('m0_schedule_fixture',{p_run:run,p_effect_key:run+':cron'});
    let job;for(let n=0;n<40;n++){const found=sql('select id from private.jobs where effect_key='+q(run+':cron')+';');if(found){job={id:found,effect_key:run+':cron'};break;}await sleep(500);}assert.ok(job,'Cron created job');
    await waitSuccess(job);assert.equal((await mockReceipt(job.effect_key)).acceptedCount,1);await ok('m0_stop_fixture_schedule',{p_run:run});
  });
}catch(e){failed=e;}
finally{
  try{await rpc('m0_stop_fixture_schedule',{p_run:run});sql('update private.jobs set state=\'CANCELLED\',lease_token=null,lease_until=null where payload->>\'fixture_run_id\'='+q(run)+" and state not in ('SUCCEEDED','DLQ');");}catch{}
  if(paused)must(docker(['unpause',...workers]),'Resume own consumers after fixture');
  const report={productId:'judoju-news',run,sample_kind:'SYNTHETIC',status:failed?'FAIL':'PASS',cases,actualNewsRequests:0,actualExternalEffects:0,createdAt:new Date().toISOString()};writePrivate('m0-runtime-'+run+'.json',report);
}
if(failed)throw failed;
async function waitSuccess(j){for(let n=0;n<100;n++){const s=await jobState(j);if(s.state==='SUCCEEDED')return s;if(s.state==='DLQ')throw new Error('Unexpected fixture DLQ');await sleep(300);}throw new Error('Worker completion timeout');}
async function mockReceipt(effectKey){
  const mockId=must(docker(['ps','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=mock','--format','{{.ID}}']),'Own mock');
  const source="const r=await fetch('http://127.0.0.1:7070/effects/'+encodeURIComponent("+JSON.stringify(effectKey)+"),{headers:{'X-Mock-Key':process.env.M0_MOCK_KEY}});console.log(await r.text());";
  return JSON.parse(must(docker(['exec',mockId,'node','--input-type=module','-e',source]),'Mock receipt'));
}
