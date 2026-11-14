import assert from 'node:assert/strict';
import {m1FixtureClient,fixtureContent} from './m1-fixtures.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
import {docker,writePrivate} from './local-runtime.mjs';
import {randomUUID} from 'node:crypto';
const f=await m1FixtureClient();let d=await f.create();await f.editor('m1_save_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:fixtureContent(d,{title:'SYNTHETIC 6E 보관 검증'})});d=await f.editor('m1_get_draft',{p_issue:d.issue_id});
const published=await f.editor('m1_publish_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_policy:d.policy_version,p_catalog:d.catalog_version,p_effect_key:'6e-retention:'+randomUUID()});
const query=`begin;do $$declare install uuid:=gen_random_uuid();ticket uuid;keep_ticket uuid:=gen_random_uuid();raw_id uuid;at_time timestamptz:=clock_timestamp();r jsonb;n integer;sealed uuid:=gen_random_uuid();
begin
 insert into private.installations(id,secret_hash,expires_at) values(install,extensions.digest('synthetic-retention-secret','sha256'),at_time+interval '1 day');
 insert into private.installation_settings(installation_id) values(install);
 for n in 1..1001 loop
  ticket:=gen_random_uuid();raw_id:=gen_random_uuid();
  insert into private.installation_view_tickets(id,installation_id,visit_id,issue_id,version_id,issued_at,expires_at) values(ticket,install,gen_random_uuid(),${f.quote(d.issue_id)},${f.quote(published.version_id)},at_time-interval '31 days',at_time-interval '31 days'+interval '30 minutes');
  insert into private.installation_qa_views(installation_id,event_key,ticket_id,issue_id,version_id,accepted_at) values(install,raw_id,ticket,${f.quote(d.issue_id)},${f.quote(published.version_id)},at_time-interval '31 days');
  insert into private.installation_view_outcomes values(install,raw_id,ticket,'{"state":"ACCEPTED"}',at_time-interval '31 days');
  insert into private.installation_qa_daily(issue_id,day,pv,uv) values(${f.quote(d.issue_id)},(at_time at time zone 'Asia/Seoul')::date-(400+n),1,1);
  insert into private.installation_setting_changes(installation_id,settings_revision,reason,occurred_at) values(install,n,'SETTINGS_CHANGED',at_time-interval '31 days');
  insert into private.installation_operations(generation,kind,state,transport,installation_id,receipt_ciphertext,deadline) values(gen_random_uuid(),'BOOTSTRAP','ACKNOWLEDGED','WEB',install,'SYNTHETIC expired receipt',at_time-interval '1 day');
 end loop;
 insert into private.installation_operations(generation,kind,state,transport,deadline) values(sealed,'BOOTSTRAP','SEALED_START','WEB',at_time-interval '30 days');
 insert into private.installation_view_tickets(id,installation_id,visit_id,issue_id,version_id,issued_at,expires_at) values(keep_ticket,install,gen_random_uuid(),${f.quote(d.issue_id)},${f.quote(published.version_id)},at_time,at_time+interval '30 minutes');
 insert into private.installation_qa_views(installation_id,event_key,ticket_id,issue_id,version_id,accepted_at) values(install,gen_random_uuid(),keep_ticket,${f.quote(d.issue_id)},${f.quote(published.version_id)},at_time-interval '30 days'+interval '1 minute');
 r:=public.installation_qa_purge();
 if (r->>'raw_deleted')::int<>1000 or (r->>'daily_deleted')::int<>1000 or (r->>'outcomes_deleted')::int<>1000 or (r->>'receipts_cleared')::int<>1000 then raise exception 'RETENTION_BATCH_LIMIT_FAILED';end if;
 if (select count(*) from private.installation_qa_views where installation_id=install)<>2 then raise exception 'BACKLOG_NOT_RETAINED';end if;
 perform public.installation_qa_purge();perform public.installation_qa_purge();
 if (select count(*) from private.installation_qa_views where installation_id=install)<>1 or not exists(select 1 from private.installation_view_tickets where id=keep_ticket)
 or exists(select 1 from private.installation_view_outcomes where installation_id=install)
 or exists(select 1 from private.installation_qa_daily where issue_id=${f.quote(d.issue_id)})
 or exists(select 1 from private.installation_setting_changes where installation_id=install)
 or exists(select 1 from private.installation_operations where installation_id=install and receipt_ciphertext is not null) then raise exception 'RETENTION_REMAINDER_OR_FK_FAILED';end if;
 if (select count(*) from private.installation_operations where installation_id=install)<>1001 or not exists(select 1 from private.installation_operations where generation=sealed) then raise exception 'REPLAY_TOMBSTONE_DELETED';end if;
 r:=public.installation_qa_purge();if (r->>'raw_deleted')::int<>0 or (r->>'daily_deleted')::int<>0 or (r->>'tickets_deleted')::int<>0 or (r->>'receipts_cleared')::int<>0 then raise exception 'REPEAT_PURGE_NOT_ZERO';end if;
 if not exists(select 1 from private.installation_retention_ledger where outcomes_deleted>0 and receipts_cleared>0) then raise exception 'RETENTION_LEDGER_MISSING';end if;
end$$;rollback;select 'RETENTION_CONTRACTS_PASS';`;
try{const r=docker(['exec','-i','supabase_db_judoju-news-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:query});if(r.code){writePrivate('stage06e-retention-diagnostics.txt',r.stderr);throw Error(r.stderr.match(/^ERROR:.*$/m)?.[0]??'RETENTION_TEST_FAILED');}assert.equal(r.stdout.trim().split('\n').at(-1),'RETENTION_CONTRACTS_PASS');console.log(JSON.stringify({status:'PASS',checks:7,rowsPerExpiredType:1001,fixtureTransactionRolledBack:true,privacyFullPurge:false}));}
finally{await logout(f.capability,f.adminSession);}
