import {localClient} from './m0-test-client.mjs';
import {authFixtures} from './m1-auth-fixtures.mjs';
import {login,session} from '../apps/admin/lib/runtime.mjs';
import {docker,writePrivate} from './local-runtime.mjs';
const f=localClient(),fixtures=await authFixtures(),owner=fixtures.state.users.admin;
const opened=await login(owner.email,owner.password),admin=await session(opened.capability),claims=JSON.parse(Buffer.from(admin.accessToken.split('.')[1],'base64url').toString());
const query=`begin;
do $$declare install uuid:=gen_random_uuid();secret text:=encode(extensions.gen_random_bytes(32),'hex');ids uuid[];versions uuid[];n integer;t jsonb;r jsonb;
begin
 select array_agg(x.id order by x.id),array_agg(x.current_version_id order by x.id) into ids,versions from (
  select i.id,i.current_version_id from private.issues i join private.article_versions v on v.id=i.current_version_id
  where i.publication_state='PUBLISHED' and i.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1' and private.m1_current_evidence(i.id)
   and not exists(select 1 from private.issue_aliases where alias_id=i.id or canonical_issue_id=i.id)
   and not exists(select 1 from private.installation_qa_daily where issue_id=i.id)
   and not exists(select 1 from private.installation_qa_views where issue_id=i.id)
  order by i.id limit 2
 )x;
 if cardinality(ids)<>2 then raise exception 'TWO_UNUSED_CURRENT_ARTICLES_REQUIRED';end if;
 insert into private.installations(id,secret_hash,expires_at) values(install,private.installation_hash(secret),clock_timestamp()+interval '1 hour');
 insert into private.installation_settings(installation_id) values(install);
 for n in 1..2 loop
  t:=public.installation_view('TICKET',install,secret,1,jsonb_build_object('visit_id',gen_random_uuid(),'issue_id',ids[n],'version_id',versions[n]));
  update private.installation_view_tickets set issued_at=clock_timestamp()-interval '4 seconds' where id=(t->>'ticket_id')::uuid;
  r:=public.installation_view('ACCEPT',install,secret,1,jsonb_build_object('event_key',gen_random_uuid(),'ticket_id',t->>'ticket_id'));
  if r->>'state'<>'ACCEPTED' then raise exception 'FIXTURE_ACCEPT_FAILED';end if;
 end loop;
 insert into private.issue_aliases(alias_id,canonical_issue_id) values(ids[1],ids[2]);
 update private.installation_qa_views set accepted_at=statement_timestamp()-interval '1 minute' where installation_id=install;
 update private.installation_qa_coverage set started_at=statement_timestamp()-interval '1 day';
 perform set_config('request.jwt.claims',${f.quote(JSON.stringify(claims))},true);
 r:=public.installation_admin_stats(statement_timestamp()-interval '1 hour',statement_timestamp(),ids[2],null);
 if r->>'quality'<>'COMPLETE' or r->>'period_uv'<>'1' or jsonb_array_length(r->'items')<>1
  or r->'items'->0->>'pv'<>'2' or r->'items'->0->>'uv'<>'1' then raise exception 'ALIAS_PERIOD_UV_WAS_SUMMED';end if;
 r:=public.installation_admin_stats(statement_timestamp()-interval '30 days'+interval '1 hour',statement_timestamp(),ids[2],null);
 if r->>'quality'='UNSUPPORTED' then raise exception 'EXACT_RAW_WINDOW_BOUNDARY_REJECTED';end if;
 r:=public.installation_admin_stats(statement_timestamp()-interval '30 days'+interval '1 hour'-interval '1 microsecond',statement_timestamp(),ids[2],null);
 if r->>'quality'<>'UNSUPPORTED' then raise exception 'OUTSIDE_RAW_WINDOW_ACCEPTED';end if;
 perform set_config('request.jwt.claims','{}',true);
 update private.installation_qa_views set accepted_at=statement_timestamp()-interval '31 days' where installation_id=install;
 update private.installation_qa_daily set day=((statement_timestamp()-interval '31 days') at time zone 'Asia/Seoul')::date where issue_id=any(ids);
 perform public.installation_qa_purge();
 if exists(select 1 from private.installation_qa_views where installation_id=install) then raise exception 'EXPIRED_RAW_RETAINED';end if;
 perform set_config('request.jwt.claims',${f.quote(JSON.stringify(claims))},true);
 r:=public.installation_admin_stats(statement_timestamp()-interval '40 days',statement_timestamp(),ids[2],null);
 if r->>'quality'<>'UNSUPPORTED' or r->'period_uv'<>'null'::jsonb or jsonb_array_length(r->'daily_history')<>2
  or exists(select 1 from jsonb_array_elements(r->'daily_history') x where x->'daily_uv'<>'null'::jsonb or x->>'uv_quality'<>'UNAVAILABLE_MERGED_UV') then raise exception 'EXPIRED_ALIAS_UV_INVENTED';end if;
 if ((timestamptz '2026-11-14 14:59:59+00') at time zone 'Asia/Seoul')::date<>date '2026-11-14'
  or ((timestamptz '2026-11-14 15:00:00+00') at time zone 'Asia/Seoul')::date<>date '2026-11-15' then raise exception 'KST_DAY_BOUNDARY_FAILED';end if;
 perform set_config('request.jwt.claims','{}',true);
end$$;rollback;`;
const r=docker(['exec','-i','supabase_db_judoju-news-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:query});
if(r.code)throw new Error('STATS_WINDOW_TEST_FAILED: '+r.stderr.split('\n')[0].replace(/[0-9a-f]{32,}/gi,'[redacted]'));
const result={status:'PASS',fixtureTransactionsRolledBack:true,checks:['Two original issues merge to PV2 and distinct UV1 for one installation','Exact 30 days minus 1 hour boundary accepted; one microsecond outside unsupported','Expired raw is excluded/purged; daily historical rows remain separate','Merged long-period daily UV is unavailable and never summed','KST day changes at 15:00 UTC'],operationalAnalyticsEnabled:false};writePrivate('installation-stat-window-tests.json',result);console.log(JSON.stringify(result));
