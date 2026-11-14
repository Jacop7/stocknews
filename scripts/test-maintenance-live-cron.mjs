import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {m1FixtureClient,fixtureContent} from './m1-fixtures.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
import {runtimeDir,writePrivate} from './local-runtime.mjs';
const receiptPath=path.join(runtimeDir,'stage06e-live-cron.json');
if(existsSync(receiptPath)){
 const prior=JSON.parse(readFileSync(receiptPath,'utf8'));assert.equal(prior.state,'VERIFIED','Uncertain prior cron probe: inspect its owned job and intent; do not resend.');console.log(JSON.stringify({status:'PASS',evidence:'REUSED_PRIOR_ACTUAL_CRON_OBSERVATION',timeoutRollback:prior.timeoutRollback,normalPublication:prior.normalPublication}));
}else{
 const f=await m1FixtureClient(),run=randomUUID();let ownJob=null,probeInstalled=false,normalEnabled=false;
 const state={state:'SETUP_INTENT',run,productId:'judoju-news',environment:'local',bootstrapId:f.id.bootstrapId,issues:[],jobId:null};
 writePrivate('stage06e-live-cron.json',state);
 try{
  const due=new Date(Date.now()+70000).toISOString(),drafts=[];
  for(const name of ['A','B']){let d=await f.create();await f.editor('m1_save_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:fixtureContent(d,{title:'SYNTHETIC 6E 실제 cron '+name})});d=await f.editor('m1_get_draft',{p_issue:d.issue_id});const s=await f.editor('reservation_create',{p_issue:d.issue_id,p_draft_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_policy:d.policy_version,p_catalog:d.catalog_version,p_due_at:due,p_request:randomUUID()});drafts.push({...d,schedule_id:s.schedule_id});}
  state.issues=drafts.map(x=>({issue_id:x.issue_id,schedule_id:x.schedule_id}));writePrivate('stage06e-live-cron.json',state);
  const paused=await f.rpc('maintenance_configure',{p_enabled:false});assert.equal(paused.status,200);
  ownJob=Number(f.sql("select job_id from private.maintenance_cron_jobs where kind='RESERVATIONS';"));assert.ok(Number.isSafeInteger(ownJob));state.jobId=ownJob;writePrivate('stage06e-live-cron.json',state);
  assert.equal(f.sql("select to_regclass('private.s6e_cron_probe') is null and to_regprocedure('private.s6e_cron_fault()') is null;"),'t','Never adopt an existing fault injector');
  const fault=drafts.slice().sort((a,b)=>a.schedule_id.localeCompare(b.schedule_id))[1];
  const ids=drafts.map(x=>f.quote(x.issue_id)).join(',');
  f.sql(`begin;create table private.s6e_cron_probe(issue_id uuid primary key);insert into private.s6e_cron_probe values(${f.quote(fault.issue_id)});
   create function private.s6e_cron_fault() returns trigger language plpgsql set search_path='' as $$begin if exists(select 1 from private.s6e_cron_probe where issue_id=new.issue_id) then perform pg_sleep(8);end if;return new;end$$;
   revoke all on private.s6e_cron_probe from public,anon,authenticated,service_role;revoke execute on function private.s6e_cron_fault() from public,anon,authenticated,service_role;
   create trigger s6e_cron_fault before insert on private.article_versions for each row execute function private.s6e_cron_fault();commit;`);probeInstalled=true;
  const startRun=Number(f.sql('select coalesce(max(runid),0) from cron.job_run_details where jobid='+ownJob+';'));
  state.state='TIMEOUT_PROBE_RUNNING';writePrivate('stage06e-live-cron.json',state);
  f.sql('select cron.alter_job('+ownJob+',active:=true);');
  console.log(JSON.stringify({stage:'WAITING_FOR_REAL_CRON_TIMEOUT',dueAt:due,maxWaitSeconds:190}));
  let failed;
  for(const until=Date.now()+190000;Date.now()<until;){
   const value=f.sql(`select coalesce((select json_build_object('run_id',runid,'status',status,'duration_seconds',extract(epoch from end_time-start_time),'statement_timeout',return_message like '%statement timeout%')::text from cron.job_run_details where jobid=${ownJob} and runid>${startRun} and status='failed' order by runid desc limit 1),'null');`);failed=JSON.parse(value);if(failed)break;await new Promise(resolve=>setTimeout(resolve,1000));
  }
  f.sql('select cron.alter_job('+ownJob+',active:=false);');
  assert.equal(failed?.statement_timeout,true,'Actual registered command must enforce its five-second statement limit');assert.ok(Number(failed.duration_seconds)>=4.5&&Number(failed.duration_seconds)<15);
  assert.equal(f.sql(`select count(*) from private.article_versions where issue_id in(${ids});`),'0','Whole tick rolls back the first successful item too');
  assert.equal(f.sql(`select count(*) from private.outbox where issue_id in(${ids});`),'0');
  assert.equal(f.sql(`select count(*) from private.manual_publication_schedules where issue_id in(${ids}) and status='PENDING';`),'2');
  state.timeoutRollback={status:'PASS',actualRunId:failed.run_id,durationSeconds:Number(failed.duration_seconds),versionCount:0,outboxCount:0,pendingCount:2};writePrivate('stage06e-live-cron.json',state);
  f.sql('begin;drop trigger s6e_cron_fault on private.article_versions;drop function private.s6e_cron_fault();drop table private.s6e_cron_probe;commit;');probeInstalled=false;
  f.sql(`insert into private.maintenance_safety_proof(singleton,bootstrap_id,command_hashes,timeout_verified) select true,bootstrap_id,jsonb_build_object('RESERVATIONS',private.reservation_hash(to_jsonb(private.maintenance_command('RESERVATIONS'))),'CORRECTIONS',private.reservation_hash(to_jsonb(private.maintenance_command('CORRECTIONS'))),'RETENTION',private.reservation_hash(to_jsonb(private.maintenance_command('RETENTION')))),true from private.runtime_identity where singleton on conflict(singleton) do update set bootstrap_id=excluded.bootstrap_id,command_hashes=excluded.command_hashes,timeout_verified=true,verified_at=clock_timestamp();`);
  const enabled=await f.rpc('maintenance_configure',{p_enabled:true});assert.equal(enabled.status,200);normalEnabled=true;
  state.state='NORMAL_CRON_RUNNING';writePrivate('stage06e-live-cron.json',state);console.log(JSON.stringify({stage:'WAITING_FOR_REAL_CRON_PUBLICATION',timeoutRollback:'PASS',maxWaitSeconds:85000/1000}));
  let published=false;
  for(const until=Date.now()+85000;Date.now()<until;){published=f.sql(`select count(*) from private.manual_publication_schedules where issue_id in(${ids}) and status='PUBLISHED';`)==='2';if(published)break;await new Promise(resolve=>setTimeout(resolve,1000));}
  assert.equal(published,true,'Normal next cron tick must publish both original schedules');
  for(const d of drafts){assert.equal(f.sql(`select count(*) from private.article_versions where issue_id=${f.quote(d.issue_id)};`),'1');assert.equal(f.sql(`select count(*) from private.outbox where effect_key=${f.quote('reservation:'+d.schedule_id)};`),'1');const pub=await f.rpc('m1_public_article',{p_issue:d.issue_id},{role:'anon'});assert.equal(pub.body?.state,'PUBLISHED');}
  const repeated=f.sql('select private.reservation_tick();');assert.equal(JSON.parse(repeated).published,0);
  state.normalPublication={status:'PASS',articles:2,versionsPerIssue:1,outboxPerSchedule:1,anonymousRead:'PUBLISHED',repeatPublished:0};state.state='VERIFIED';state.finishedAt=new Date().toISOString();writePrivate('stage06e-live-cron.json',state);
  console.log(JSON.stringify({status:'PASS',state:'ACTUAL_OWN_LOCAL_CRON_VERIFIED',timeoutRollback:state.timeoutRollback,normalPublication:state.normalPublication,realNewsRequests:0}));
 }finally{
  if(!normalEnabled&&ownJob!==null)f.sql('select cron.alter_job('+ownJob+',active:=false);');
  // Leave an uncertain probe intact, paused and with its exact receipt for inspection.
  if(probeInstalled)console.log(JSON.stringify({probeState:'PAUSED_REQUIRES_INSPECTION',receipt:'ignored own runtime evidence'}));
  await logout(f.capability,f.adminSession);
 }
}
