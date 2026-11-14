import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {m1FixtureClient,fixtureContent} from './m1-fixtures.mjs';
import {docker,writePrivate} from './local-runtime.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
const f=await m1FixtureClient(),seed=await f.create(),claims=JSON.parse(Buffer.from(f.adminSession.accessToken.split('.')[1],'base64url').toString());
const proposed=process.argv.includes('--proposed'),ddl=proposed?readFileSync('supabase/migrations/20261115000050_reservation_review_guards.sql','utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''):'';
const sql=`begin;${ddl}
create temporary table s6e_fault(issue uuid primary key,mode text);
create function pg_temp.s6e_fault_trigger() returns trigger language plpgsql as $$declare m text;begin
 select mode into m from pg_temp.s6e_fault where issue=new.issue_id;
 if m='DELAY' then perform pg_sleep(1.2);
 elsif m='VALIDATION' then raise exception 'CLAIM_NOT_VERIFIED';
 elsif m is not null then raise exception using errcode=m,message='INJECTED_UNEXPECTED_DB_ERROR';end if;return new;
end$$;
create trigger s6e_review_fault before insert on private.article_versions for each row execute function pg_temp.s6e_fault_trigger();
create function pg_temp.editor() returns void language sql as $$select set_config('request.jwt.claims',${f.quote(JSON.stringify(claims))},true)::void$$;
create function pg_temp.server() returns void language sql as $$select set_config('request.jwt.claims','{}',true)::void$$;
create function pg_temp.draft() returns jsonb language plpgsql as $$declare d jsonb;c jsonb;begin
 perform pg_temp.editor();d:=public.m1_create_draft(gen_random_uuid());d:=public.m1_get_draft((d->>'issue_id')::uuid);
 c:=replace(${f.quote(JSON.stringify(fixtureContent(seed,{title:'SYNTHETIC 6E review guard'})))},${f.quote(seed.claim_id)},d->>'claim_id')::jsonb;
 perform public.m1_save_draft((d->>'issue_id')::uuid,0,c);return public.m1_get_draft((d->>'issue_id')::uuid);end$$;
create function pg_temp.queue(d jsonb,p_age interval) returns uuid language plpgsql as $$declare s jsonb;t timestamptz:=clock_timestamp()-p_age;begin
 perform pg_temp.editor();s:=public.reservation_create((d->>'issue_id')::uuid,(d->>'draft_revision')::bigint,(d->>'issue_revision')::bigint,(d->>'policy_version')::bigint,(d->>'catalog_version')::bigint,to_char(clock_timestamp()+interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),gen_random_uuid());
 update private.manual_publication_schedules set due_at=t,expires_at=t+interval '15 minutes' where id=(s->>'schedule_id')::uuid;
 update private.issues set scheduled_publish_at=t where id=(d->>'issue_id')::uuid;return(s->>'schedule_id')::uuid;
end$$;
do $$declare d jsonb;a jsonb;b jsonb;s uuid;sa uuid;sb uuid;i uuid;ia uuid;ib uuid;code text;before_count integer;r jsonb;
begin
 -- now() remains before this fact expires. The actual wall clock must win.
 d:=pg_temp.draft();i:=(d->>'issue_id')::uuid;update private.claims set valid_until=clock_timestamp()+interval '400 milliseconds' where issue_id=i;
 s:=pg_temp.queue(d,interval '1 minute');perform pg_sleep(0.6);perform pg_temp.server();perform private.reservation_tick();
 if not exists(select 1 from private.manual_publication_schedules where id=s and status='HELD' and outcome_code='EVIDENCE_EXPIRED') or exists(select 1 from private.article_versions where issue_id=i) then raise exception 'TRANSACTION_START_TIME_ACCEPTED_EXPIRED_FACT';end if;

 -- An early item's evidence can expire while a later item consumes time. The
 -- deferred guard forces rollback at the commit boundary, not false success.
 a:=pg_temp.draft();b:=pg_temp.draft();ia:=(a->>'issue_id')::uuid;ib:=(b->>'issue_id')::uuid;
 update private.claims set valid_until=clock_timestamp()+interval '800 milliseconds' where issue_id=ia;
 sa:=pg_temp.queue(a,interval '2 minutes');sb:=pg_temp.queue(b,interval '1 minute');insert into pg_temp.s6e_fault values(ib,'DELAY');perform pg_temp.server();
 begin
  perform private.reservation_tick();set constraints private.reservation_evidence_at_commit immediate;raise exception 'EXPECTED_DEFERRED_EXPIRY';
 exception when raise_exception then if sqlerrm<>'RESERVATION_EVIDENCE_EXPIRED' then raise;end if;end;
 set constraints private.reservation_evidence_at_commit deferred;
 if exists(select 1 from private.article_versions where issue_id in(ia,ib)) or exists(select 1 from private.outbox where issue_id in(ia,ib)) or (select count(*) from private.manual_publication_schedules where id in(sa,sb) and status='PENDING')<>2 then raise exception 'DEFERRED_EXPIRY_LEFT_PARTIAL_PUBLICATION';end if;
 delete from pg_temp.s6e_fault;perform pg_temp.editor();perform public.reservation_cancel(sa,1,gen_random_uuid());perform public.reservation_cancel(sb,1,gen_random_uuid());

 foreach code in array array['40P01','40001','XX000','P0001'] loop
  a:=pg_temp.draft();b:=pg_temp.draft();ia:=(a->>'issue_id')::uuid;ib:=(b->>'issue_id')::uuid;
  sa:=pg_temp.queue(a,interval '2 minutes');sb:=pg_temp.queue(b,interval '1 minute');insert into pg_temp.s6e_fault values(ib,code);perform pg_temp.server();
  before_count:=(select count(*) from private.maintenance_runs where kind='RESERVATIONS');
  begin perform private.reservation_tick();raise exception 'EXPECTED_DB_FAILURE';exception when others then if sqlstate<>code or sqlerrm<>'INJECTED_UNEXPECTED_DB_ERROR' then raise;end if;end;
  if exists(select 1 from private.article_versions where issue_id in(ia,ib)) or exists(select 1 from private.outbox where issue_id in(ia,ib)) or (select count(*) from private.manual_publication_schedules where id in(sa,sb) and status='PENDING')<>2 or (select count(*) from private.maintenance_runs where kind='RESERVATIONS')<>before_count then raise exception 'FATAL_DB_ERROR_CONVERTED_TO_HELD_OR_PARTIAL_COMMIT';end if;
  delete from pg_temp.s6e_fault;perform pg_temp.editor();perform public.reservation_cancel(sa,1,gen_random_uuid());perform public.reservation_cancel(sb,1,gen_random_uuid());
 end loop;

 a:=pg_temp.draft();b:=pg_temp.draft();ia:=(a->>'issue_id')::uuid;ib:=(b->>'issue_id')::uuid;
 sa:=pg_temp.queue(a,interval '2 minutes');sb:=pg_temp.queue(b,interval '1 minute');insert into pg_temp.s6e_fault values(ib,'VALIDATION');perform pg_temp.server();perform private.reservation_tick();
 if not exists(select 1 from private.manual_publication_schedules where id=sa and status='PUBLISHED') or not exists(select 1 from private.manual_publication_schedules where id=sb and status='HELD' and outcome_code='VALIDATION_FAILED') or (select count(*) from private.article_versions where issue_id in(ia,ib))<>1 then raise exception 'EXPECTED_BUSINESS_ERROR_NOT_ISOLATED';end if;
 set constraints private.reservation_evidence_at_commit immediate;set constraints private.reservation_evidence_at_commit deferred;delete from pg_temp.s6e_fault;

 before_count:=(select count(*) from private.audits where actor_id=${f.quote(f.adminSession.userId)} and action='ADMIN_MAINTENANCE_PAUSE');perform public.maintenance_configure_for_admin(false,${f.quote(f.adminSession.userId)},${f.quote(f.adminSession.sessionId)});
 if (select count(*) from private.audits where actor_id=${f.quote(f.adminSession.userId)} and action='ADMIN_MAINTENANCE_PAUSE')<>before_count+1 then raise exception 'ADMIN_MAINTENANCE_ACTOR_NOT_AUDITED';end if;
 perform pg_temp.editor();perform cron.alter_job((select job_id from private.maintenance_cron_jobs where kind='RESERVATIONS'),schedule:='0 0 * * *');r:=public.maintenance_admin_status();
 if not exists(select 1 from jsonb_array_elements(r->'jobs') j where j->>'kind'='RESERVATIONS' and j->>'state'='UNAVAILABLE' and (j->>'registered')::boolean=false) then raise exception 'CHANGED_CRON_SCHEDULE_REPORTED_ACTIVE';end if;
end$$;
rollback;select 'REVIEW_GUARDS_PASS';`;
try{const r=docker(['exec','-i','supabase_db_judoju-news-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:sql});if(r.code){writePrivate('stage06e-review-guards-diagnostics.txt',r.stderr);throw Error(r.stderr.match(/^ERROR:.*$/m)?.[0]??'REVIEW_GUARD_TEST_FAILED');}assert.equal(r.stdout.trim().split('\n').at(-1),'REVIEW_GUARDS_PASS');console.log(JSON.stringify({status:'PASS',mode:proposed?'PROPOSED_ROLLBACK':'APPLIED_ROLLBACK',checks:9,wallclockExpiry:true,deferredCommitExpiry:true,fatalSqlStates:['40P01','40001','XX000','P0001-unknown'],knownBusinessErrorHeld:true,actorAudit:true,cronRegistrationMismatch:true,allFixturesRolledBack:true}));}
finally{await logout(f.capability,f.adminSession);}
