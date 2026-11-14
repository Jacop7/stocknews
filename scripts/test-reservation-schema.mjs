import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {m1FixtureClient,fixtureContent} from './m1-fixtures.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
import {docker,writePrivate} from './local-runtime.mjs';
const f=await m1FixtureClient(),seed=await f.create(),claims=JSON.parse(Buffer.from(f.adminSession.accessToken.split('.')[1],'base64url').toString());
const proposed=process.argv.includes('--proposed');
const ddl=proposed?readdirSync('supabase/migrations').filter(n=>/^2026111500004[678]_/.test(n)).sort().map(n=>readFileSync('supabase/migrations/'+n,'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')).join('\n'):'';
const editor=f.quote(JSON.stringify(claims)),template=f.quote(JSON.stringify(fixtureContent(seed,{title:'SYNTHETIC 6E 예약 검증'})));
const sql=`begin;${ddl}
create function pg_temp.editor() returns void language sql as $$select set_config('request.jwt.claims',${editor},true)::void$$;
create function pg_temp.server() returns void language sql as $$select set_config('request.jwt.claims','{}',true)::void$$;
create function pg_temp.draft() returns jsonb language plpgsql as $$declare d jsonb;c jsonb;begin
 perform pg_temp.editor();d:=public.m1_create_draft(gen_random_uuid());d:=public.m1_get_draft((d->>'issue_id')::uuid);
 c:=replace(${template},${f.quote(seed.claim_id)},d->>'claim_id')::jsonb;
 perform public.m1_save_draft((d->>'issue_id')::uuid,0,c);return public.m1_get_draft((d->>'issue_id')::uuid);end$$;
create function pg_temp.reserve(d jsonb,k uuid default gen_random_uuid()) returns jsonb language plpgsql as $$begin perform pg_temp.editor();return public.reservation_create((d->>'issue_id')::uuid,(d->>'draft_revision')::bigint,(d->>'issue_revision')::bigint,(d->>'policy_version')::bigint,(d->>'catalog_version')::bigint,to_char(clock_timestamp()+interval '2 minutes','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),k);end$$;
create function pg_temp.due(p_id uuid,p_old interval default interval '1 minute') returns void language plpgsql as $$declare t timestamptz:=clock_timestamp()-p_old;i uuid;begin
 update private.manual_publication_schedules set due_at=t,expires_at=t+interval '15 minutes' where id=p_id returning issue_id into i;
 update private.issues set scheduled_publish_at=t where id=i;end$$;
do $$declare d jsonb;r jsonb;s uuid;i uuid;k uuid;before_count integer;clock_before timestamptz;v bigint;claim uuid;head bigint;
begin
 d:=pg_temp.draft();r:=pg_temp.reserve(d);s:=(r->>'schedule_id')::uuid;i:=(d->>'issue_id')::uuid;
 perform pg_temp.server();perform private.reservation_tick();
 if exists(select 1 from private.article_versions where issue_id=i) or not exists(select 1 from private.manual_publication_schedules where id=s and status='PENDING') then raise exception 'PUBLISHED_BEFORE_DUE';end if;
 perform pg_temp.due(s);perform private.reservation_tick();perform private.reservation_tick();
 if not exists(select 1 from private.manual_publication_schedules where id=s and status='PUBLISHED') or (select count(*) from private.article_versions where issue_id=i)<>1 or (select count(*) from private.outbox where effect_key='reservation:'||s::text)<>1 then raise exception 'RESERVATION_NOT_EXACTLY_ONCE';end if;
 if public.m1_public_article(i)->>'state'<>'PUBLISHED' then raise exception 'PUBLIC_PROJECTION_MISSING';end if;
 perform pg_temp.editor();r:=public.reservation_cancel(s,1,gen_random_uuid());if r->>'status'<>'ALREADY_PUBLISHED' then raise exception 'LATE_CANCEL_HID_ARTICLE';end if;

 d:=pg_temp.draft();r:=pg_temp.reserve(d);s:=(r->>'schedule_id')::uuid;i:=(d->>'issue_id')::uuid;k:=gen_random_uuid();
 perform public.reservation_cancel(s,1,k);perform public.reservation_cancel(s,1,k);perform pg_temp.due(s);perform pg_temp.server();perform private.reservation_tick();
 if exists(select 1 from private.article_versions where issue_id=i) or not exists(select 1 from private.manual_publication_schedules where id=s and status='CANCELLED') then raise exception 'CANCEL_BEFORE_EXECUTE_FAILED';end if;

 d:=pg_temp.draft();r:=pg_temp.reserve(d);s:=(r->>'schedule_id')::uuid;i:=(d->>'issue_id')::uuid;
 perform public.m1_save_draft(i,(d->>'draft_revision')::bigint,(d->'content')||jsonb_build_object('title','SYNTHETIC 6E 수정'));
 if not exists(select 1 from private.manual_publication_schedules where id=s and status='HELD' and outcome_code='STALE_DRAFT') or exists(select 1 from private.issues where id=i and scheduled_publish_at is not null) then raise exception 'SAVE_DID_NOT_HOLD_RESERVATION';end if;

 d:=pg_temp.draft();r:=pg_temp.reserve(d);s:=(r->>'schedule_id')::uuid;i:=(d->>'issue_id')::uuid;perform pg_temp.due(s);
 update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{app_role}','"reader"') where id=${f.quote(f.adminSession.userId)};
 perform pg_temp.server();perform private.reservation_tick();
 if not exists(select 1 from private.manual_publication_schedules where id=s and status='HELD' and outcome_code='ACTOR_INACTIVE') or exists(select 1 from private.article_versions where issue_id=i) or exists(select 1 from private.outbox where effect_key='reservation:'||s::text) then raise exception 'DEMOTED_ACTOR_PUBLISHED';end if;
 update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{app_role}','"admin"') where id=${f.quote(f.adminSession.userId)};

 d:=pg_temp.draft();r:=pg_temp.reserve(d);s:=(r->>'schedule_id')::uuid;i:=(d->>'issue_id')::uuid;perform pg_temp.due(s,interval '16 minutes');perform pg_temp.server();perform private.reservation_tick();
 if not exists(select 1 from private.manual_publication_schedules where id=s and status='EXPIRED') or exists(select 1 from private.article_versions where issue_id=i) then raise exception 'EXPIRED_RESERVATION_PUBLISHED';end if;

 d:=pg_temp.draft();r:=pg_temp.reserve(d);s:=(r->>'schedule_id')::uuid;i:=(d->>'issue_id')::uuid;perform pg_temp.due(s);
 update private.claims set official_original=false,claim_type='SYSTEMIC_MACRO' where issue_id=i;perform pg_temp.server();perform private.reservation_tick();
 if not exists(select 1 from private.manual_publication_schedules where id=s and status='HELD') or exists(select 1 from private.article_versions where issue_id=i) then raise exception 'REVOKED_MACRO_EVIDENCE_PUBLISHED';end if;

 d:=pg_temp.draft();i:=(d->>'issue_id')::uuid;claim:=(d->>'claim_id')::uuid;
 update private.claims set official_original=false,claim_type='SYSTEMIC_MACRO' where id=claim;
 begin perform pg_temp.reserve(d);raise exception 'EXPECTED_MACRO_REJECTION';exception when raise_exception then if sqlerrm<>'CLAIM_NOT_VERIFIED' then raise;end if;end;

 d:=pg_temp.draft();r:=pg_temp.reserve(d);s:=(r->>'schedule_id')::uuid;i:=(d->>'issue_id')::uuid;
 perform public.m1_set_state(i,(d->>'issue_revision')::bigint,'CORRECTION_PENDING','6e-fixture:'||gen_random_uuid()::text);
 select correction_pending_since into clock_before from private.issues where id=i;update private.issues set revision=revision+1 where id=i;
 if (select correction_pending_since from private.issues where id=i) is distinct from clock_before then raise exception 'CORRECTION_CLOCK_RESET';end if;
 perform pg_temp.server();perform private.correction_timeout_tick();
 if (select publication_state from private.issues where id=i)<>'CORRECTION_PENDING' then raise exception 'CORRECTION_EARLY_WITHDRAWAL';end if;
 -- This rollback fixture alone ages its clock. Production clients have no clock parameter.
 set constraints all immediate;
 alter table private.issues disable trigger correction_pending_clock;
 update private.issues set correction_pending_since=clock_timestamp()-interval '24 hours 1 second' where id=i;
 alter table private.issues enable trigger correction_pending_clock;
 perform private.correction_timeout_tick();perform private.correction_timeout_tick();
 if (select publication_state from private.issues where id=i)<>'WITHDRAWN' or (select count(*) from private.outbox where issue_id=i and effect_key like 'correction-timeout:%')<>1 then raise exception 'CORRECTION_TIMEOUT_NOT_ONCE';end if;
 if public.m1_public_article(i) ? 'body' then raise exception 'WITHDRAWN_BODY_EXPOSED';end if;

 if has_function_privilege('anon','public.reservation_list(uuid)','EXECUTE') or has_function_privilege('service_role','public.reservation_create(uuid,bigint,bigint,bigint,bigint,text,uuid)','EXECUTE')
 or has_function_privilege('authenticated','private.reservation_publish_core(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.maintenance_configure(boolean)','EXECUTE') then raise exception 'RESERVATION_GRANT_LEAK';end if;
 perform pg_temp.server();perform public.maintenance_configure(false);perform public.maintenance_configure(false);
 if (select count(*) from private.maintenance_cron_jobs)<>3 or exists(select 1 from private.maintenance_cron_jobs j join cron.job c on c.jobid=j.job_id where c.active) then raise exception 'CRON_NOT_IDEMPOTENT_PAUSED';end if;
 perform pg_temp.editor();r:=public.maintenance_admin_status();if jsonb_array_length(r->'jobs')<>3 then raise exception 'MAINTENANCE_STATUS_MISSING';end if;
end$$;
rollback;select 'RESERVATION_ROLLBACK_CONTRACTS_PASS';`;
try{const result=docker(['exec','-i','supabase_db_judoju-news-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:sql});if(result.code!==0){writePrivate('stage06e-rollback-diagnostics.txt',result.stderr);throw new Error((result.stderr.match(/^ERROR:.*$/m)?.[0]??'OWNED_SQL_FAILED').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[fixture-id]'));}assert.equal(result.stdout.trim().split('\n').at(-1),'RESERVATION_ROLLBACK_CONTRACTS_PASS');console.log(JSON.stringify({status:'PASS',mode:proposed?'PROPOSED_ROLLBACK':'APPLIED_ROLLBACK',checks:12,limitations:'Own local synthetic rollback contracts; no cron firing or concurrency certification.'}));}
finally{await logout(f.capability,f.adminSession);}
