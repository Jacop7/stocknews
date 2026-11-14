import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {localClient} from './m0-test-client.mjs';
import {root,runtimeDir,writePrivate,docker} from './local-runtime.mjs';
const f=localClient(),observation=process.argv.includes('--observation-guard'),review=process.argv.includes('--review-guard'),names=review?['20261115000050_reservation_review_guards.sql']:observation?['20261115000049_maintenance_observation_guards.sql']:readdirSync(path.join(root,'supabase/migrations')).filter(n=>/^2026111500004[678]_/.test(n)).sort();assert.equal(names.length,observation||review?1:3);
const records=names.map(name=>({name,sha256:createHash('sha256').update(readFileSync(path.join(root,'supabase/migrations',name))).digest('hex')}));
const receipt=review?'stage06e-review-intent.json':observation?'stage06e-observation-intent.json':'stage06e-migrations-intent.json',file=path.join(runtimeDir,receipt);
if(existsSync(file)){
 const prior=JSON.parse(readFileSync(file,'utf8'));assert.equal(prior.state,'APPLIED_VERIFIED','Uncertain apply: inspect the prior intent and owned DB, never blindly replay.');assert.deepEqual(prior.migrations,records,'Applied migration files are immutable; add a new migration.');
 console.log(JSON.stringify({status:'PASS',state:'ALREADY_APPLIED_VERIFIED',migrations:records}));
}else{
 assert.equal(f.sql("select to_regprocedure('public.installation_qa_mark_gap(timestamp with time zone)') is not null;"),'t','Verified6D SQL45 prerequisite');
 assert.equal(f.sql(review?"select to_regprocedure('private.maintenance_configure_v1(boolean)') is not null and to_regprocedure('private.reservation_evidence_commit_guard()') is null;":observation?"select to_regclass('private.manual_publication_schedules') is not null and to_regprocedure('private.maintenance_configure_v1(boolean)') is null;":"select to_regclass('private.manual_publication_schedules') is null;"),'t','Never adopt a preexisting or mismatched maintenance schema');
 const beforeJobs=observation||review?f.sql("select coalesce(jsonb_agg(jsonb_build_object('id',c.jobid,'name',c.jobname,'command',c.command,'active',c.active) order by c.jobid),'[]') from private.maintenance_cron_jobs j join cron.job c on c.jobid=j.job_id;"):null;
 const intent={state:'APPLY_INTENT',productId:'judoju-news',environment:'local',bootstrapId:f.id.bootstrapId,migrations:records,startedAt:new Date().toISOString()};writePrivate(receipt,intent);
 const ddl=names.map(n=>readFileSync(path.join(root,'supabase/migrations',n),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')).join('\n');
 const result=docker(['exec','-i','supabase_db_judoju-news-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:'begin;'+ddl+'commit;'});
 if(result.code!==0){writePrivate('stage06e-apply-diagnostics.txt',result.stderr);throw Error('LOCAL_MAINTENANCE_APPLY_UNCONFIRMED: intent retained; inspect owned DB before recovery.');}
 assert.equal(f.sql(review?"select to_regprocedure('private.reservation_evidence_commit_guard()') is not null;":observation?"select to_regprocedure('private.maintenance_configure_v1(boolean)') is not null;":"select (select count(*) from private.maintenance_cron_jobs)=0 and to_regclass('private.manual_publication_schedules') is not null and to_regprocedure('private.reservation_tick()') is not null;"),'t');
 if(observation||review)assert.equal(f.sql("select coalesce(jsonb_agg(jsonb_build_object('id',c.jobid,'name',c.jobname,'command',c.command,'active',c.active) order by c.jobid),'[]') from private.maintenance_cron_jobs j join cron.job c on c.jobid=j.job_id;"),beforeJobs,'Owned jobs unchanged by appended guard');
 writePrivate(receipt,{...intent,state:'APPLIED_VERIFIED',completedAt:new Date().toISOString(),cronJobsChanged:0,bookkeeping:'Owned local DDL receipt; existing Supabase CLI migration history left unchanged.'});
 console.log(JSON.stringify({status:'PASS',state:'APPLIED_VERIFIED',migrations:records,cronJobsChanged:0}));
}
