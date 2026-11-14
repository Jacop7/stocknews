import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {localClient} from './m0-test-client.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=localClient(),checks=[];
async function until(query){const end=Date.now()+7000;while(Date.now()<end){if(f.sql(query)==='t')return;await new Promise(r=>setTimeout(r,50));}throw Error('EXPECTED_LOCK_NOT_OBSERVED');}
for(const saveFirst of [false,true]){
 const id=randomUUID(),generation=randomUUID(),secret=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex'),hash=randomBytes(32).toString('hex');
 const tag='s6d_'+randomUUID().replaceAll('-',''),a=tag+'a',b=tag+'b',head=Number(f.sql('select version from private.catalog_head where singleton;'));
 const request={kind:'REVOKE',transport:'NATIVE',pending:nonce,payload_hash:hash,installation_id:id,secret,version:1,prior_generation:randomUUID()};
 f.sql(`begin;insert into private.installations(id,secret_hash,expires_at) values('${id}',private.installation_hash('${secret}'),clock_timestamp()+interval '1 hour');insert into private.installation_settings(installation_id) values('${id}');select public.installation_operation('START','${generation}',${f.quote(JSON.stringify(request))}::jsonb);commit;`);
 const save=`select public.installation_settings_save('${id}','${secret}',1,${head},1,true,false,true,'{}');`;
 const revoke=`select public.installation_operation('COMMIT','${generation}',${f.quote(JSON.stringify(request))}::jsonb);`;
 try{
  const holder=f.asyncSql(`begin;set local application_name='${a}';set local statement_timeout='14s';${saveFirst?save:revoke}select pg_sleep(6);commit;`);
  await until(`select exists(select 1 from pg_stat_activity where application_name='${a}' and wait_event='PgSleep');`);
  const afterRevoke=`do $$begin begin perform public.installation_settings_save('${id}','${secret}',1,${head},1,true,false,true,'{}');raise exception 'STALE_SAVE_ACCEPTED';exception when insufficient_privilege then null;end;end$$;`;
  const waiter=f.asyncSql(`begin;set local application_name='${b}';set local lock_timeout='10s';set local statement_timeout='14s';${saveFirst?revoke:afterRevoke}commit;`);
  await until(`select exists(select 1 from pg_stat_activity w join pg_stat_activity a on a.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${b}' and a.application_name='${a}' and w.wait_event_type='Lock');`);
  await Promise.all([holder,waiter]);
  const result=JSON.parse(f.sql(`select json_build_object('revoked',i.revoked_at is not null,'morning',s.morning_issue,'closing',s.closing_issue,'favorite',s.favorite_sector_issue,'sectors',cardinality(s.sector_ids),'revision',s.settings_revision) from private.installations i join private.installation_settings s on s.installation_id=i.id where i.id='${id}';`));
  assert.deepEqual(result,{revoked:true,morning:false,closing:false,favorite:false,sectors:0,revision:saveFirst?3:1});
  checks.push({name:saveFirst?'Committed save then concurrent revoke clears preferences at revision3':'Committed no-op revoke then stale save rejects after capability recheck; defaults stay revision1',status:'PASS'});
 }finally{f.sql(`update private.installations set revoked_at=coalesce(revoked_at,clock_timestamp()) where id='${id}';`);}
}
const result={status:'PASS',checks,committedInterleavings:true,blockingObservedFromPgBlockingPids:true,onlyOwnedSyntheticFixtures:true,fixtureInstallationsRevoked:true};
writePrivate('installation-revocation-race-tests.json',result);console.log(JSON.stringify(result));
