import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {m1FixtureClient} from './m1-fixtures.mjs';
import {docker,writePrivate} from './local-runtime.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
const f=await m1FixtureClient(),draft=await f.create();
const proposed=process.argv.includes('--proposed'),ddl=proposed?readFileSync('supabase/migrations/20261115000049_maintenance_observation_guards.sql','utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''):'';
const sql=`begin;${ddl}
do $$declare at_time timestamptz:=clock_timestamp();a text;b text;r jsonb;
begin
 if private.maintenance_job_state(true,true,false,null,null,at_time-interval '4 minutes','RESERVATIONS',at_time)<>'STALE'
 or private.maintenance_job_state(true,true,false,null,null,at_time-interval '1 minute','RESERVATIONS',at_time)<>'PENDING_FIRST_RUN'
 or private.maintenance_job_state(true,true,false,null,null,at_time-interval '70 minutes','RETENTION',at_time)<>'STALE'
 or private.maintenance_job_state(true,true,true,'running',at_time,at_time,'RESERVATIONS',at_time)<>'RUNNING'
 or private.maintenance_job_state(true,true,true,'failed',at_time,at_time,'RESERVATIONS',at_time)<>'FAILED'
 or private.maintenance_job_state(true,false,false,null,null,at_time,'RESERVATIONS',at_time)<>'STOPPED'
 or private.maintenance_job_state(false,true,false,null,null,at_time,'RESERVATIONS',at_time)<>'UNAVAILABLE' then raise exception 'JOB_STATE_CLASSIFICATION_FAILED';end if;
 update private.claims set valid_until=at_time+interval '2 days' where issue_id=${f.quote(draft.issue_id)};
 perform set_config('TimeZone','Asia/Seoul',true);a:=private.reservation_evidence_hash(${f.quote(draft.issue_id)});
 perform set_config('TimeZone','America/New_York',true);b:=private.reservation_evidence_hash(${f.quote(draft.issue_id)});
 if a<>b then raise exception 'EVIDENCE_HASH_DEPENDED_ON_TIMEZONE';end if;
 perform set_config('TimeZone','UTC',true);
 if current_setting('cron.launch_active_jobs',true) is distinct from 'on' then raise exception 'EXPECTED_VERIFIED_CRON_LAUNCHER';end if;
 perform public.maintenance_configure(false);
 if has_function_privilege('service_role','private.maintenance_configure_v1(boolean)','EXECUTE') or has_function_privilege('authenticated','public.maintenance_configure(boolean)','EXECUTE') then raise exception 'MAINTENANCE_PRIVATE_GRANT_LEAK';end if;
end$$;rollback;select 'OBSERVATION_GUARDS_PASS';`;
try{const r=docker(['exec','-i','supabase_db_judoju-news-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:sql});if(r.code){writePrivate('stage06e-observation-diagnostics.txt',r.stderr);throw Error(r.stderr.match(/^ERROR:.*$/m)?.[0]??'OBSERVATION_GUARD_TEST_FAILED');}assert.equal(r.stdout.trim().split('\n').at(-1),'OBSERVATION_GUARDS_PASS');console.log(JSON.stringify({status:'PASS',mode:proposed?'PROPOSED_ROLLBACK':'APPLIED_ROLLBACK',checks:4,jobStates:7,sessionTimezonesCompared:2,pauseOnlyRolledBack:true,limitations:'The existing global cron launcher was read as on, not disabled or reconfigured to test its off-state guard.'}));}
finally{await logout(f.capability,f.adminSession);}
