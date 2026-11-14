import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {m1FixtureClient,fixtureContent} from './m1-fixtures.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=await m1FixtureClient(),checks=[],claims=JSON.parse(Buffer.from(f.adminSession.accessToken.split('.')[1],'base64url').toString());
const editor=`select set_config('request.jwt.claims',${f.quote(JSON.stringify(claims))},true);`;
async function until(query){for(const end=Date.now()+8000;Date.now()<end;){if(f.sql(query)==='t')return;await new Promise(r=>setTimeout(r,50));}throw Error('EXPECTED_COMMITTED_LOCK_NOT_OBSERVED');}
const jobs=JSON.parse(f.sql("select json_agg(json_build_object('id',c.jobid,'active',c.active)) from private.maintenance_cron_jobs j join cron.job c on c.jobid=j.job_id;"));assert.equal(jobs.length,3);assert.ok(jobs.every(j=>j.active),'Race probe requires known running own6E jobs');
assert.equal((await f.rpc('maintenance_configure',{p_enabled:false})).status,200);
try{
 for(const first of ['execute','cancel','save']){
  let d=await f.create();await f.editor('m1_save_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:fixtureContent(d,{title:'SYNTHETIC 6E committed '+first})});d=await f.editor('m1_get_draft',{p_issue:d.issue_id});
  const reservation=await f.editor('reservation_create',{p_issue:d.issue_id,p_draft_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_policy:d.policy_version,p_catalog:d.catalog_version,p_due_at:new Date(Date.now()+120000).toISOString(),p_request:randomUUID()});
  const sid=reservation.schedule_id,issue=d.issue_id,tag='s6e_'+randomUUID().replaceAll('-',''),a=tag+'a',b=tag+'b';
  f.sql(`begin;update private.manual_publication_schedules set due_at=statement_timestamp()-interval '1 minute',expires_at=statement_timestamp()+interval '14 minutes' where id=${f.quote(sid)};update private.issues set scheduled_publish_at=(select due_at from private.manual_publication_schedules where id=${f.quote(sid)}) where id=${f.quote(issue)};commit;`);
  const cancel=`select public.reservation_cancel('${sid}',1,'${randomUUID()}');`,save=`select public.m1_save_draft('${issue}',${d.draft_revision},${f.quote(JSON.stringify({...d.content,title:'SYNTHETIC 6E updated pending draft'}))}::jsonb);`;
  const holder=f.asyncSql(`begin;set local application_name='${a}';set local statement_timeout='12s';${first==='execute'?'select private.reservation_tick();':editor+(first==='cancel'?cancel:save)}select pg_sleep(4);commit;`);
  await until(`select exists(select 1 from pg_stat_activity where application_name='${a}' and wait_event='PgSleep');`);
  const waiter=f.asyncSql(`begin;set local application_name='${b}';set local statement_timeout='12s';set local lock_timeout='10s';${first==='execute'?editor+cancel:'select private.reservation_tick();'}commit;`);
  await until(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${b}' and h.application_name='${a}' and w.wait_event_type='Lock');`);
  await Promise.all([holder,waiter]);
  const result=JSON.parse(f.sql(`select json_build_object('status',s.status,'versions',(select count(*) from private.article_versions where issue_id=s.issue_id),'outbox',(select count(*) from private.outbox where effect_key=s.effect_key),'scheduled',i.scheduled_publish_at is not null) from private.manual_publication_schedules s join private.issues i on i.id=s.issue_id where s.id='${sid}';`));
  assert.deepEqual(result,{status:first==='execute'?'PUBLISHED':first==='cancel'?'CANCELLED':'HELD',versions:first==='execute'?1:0,outbox:first==='execute'?1:0,scheduled:false});
  checks.push({name:first==='execute'?'Execution commits before cancel: late cancel cannot hide article':first==='cancel'?'Cancellation commits before executor: zero publication':'Draft save commits before executor: HELD and zero publication',status:'PASS',blockingObserved:true});
 }
 const report={status:'PASS',checks,committedInterleavings:true,blockingObservedFromPgBlockingPids:true,onlyOwnedSyntheticFixtures:true,realPushSent:0};writePrivate('stage06e-race-tests.json',report);console.log(JSON.stringify(report));
}finally{assert.equal((await f.rpc('maintenance_configure',{p_enabled:true})).status,200);await logout(f.capability,f.adminSession);}
