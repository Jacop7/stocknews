import {readFileSync} from 'node:fs';
import {localClient} from './m0-test-client.mjs';
import {docker,writePrivate} from './local-runtime.mjs';
localClient();
const ddl=process.argv.includes('--proposed')?readFileSync('supabase/migrations/20261115000044_installation_catalog_and_seals.sql','utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''):'';
const query=`begin;${ddl}
do $$declare i uuid:=gen_random_uuid();leaf uuid:=gen_random_uuid();parent uuid;h bigint;secret text:=encode(extensions.gen_random_bytes(32),'hex');
 g uuid:=gen_random_uuid();nonce text:=encode(extensions.gen_random_bytes(32),'hex');args jsonb;
begin
 select version into h from private.catalog_head;
 select id into parent from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED' and catalog_kind='PARENT' and active order by id limit 1;
 insert into private.installations(id,secret_hash,expires_at) values(i,private.installation_hash(secret),clock_timestamp()+interval '1 hour');
 insert into private.installation_settings(installation_id) values(i);
 insert into private.sectors(id,name,catalog_version,sample_kind,metadata_kind,catalog_kind,parent_id) values(leaf,'SYNTHETIC unpublished installation choice',h,null,'USER_REFERENCE_UNVERIFIED','LEAF',parent);
 begin perform public.installation_settings_save(i,secret,1,h,1,true,false,false,array[leaf]);raise exception 'EXPECTED_UNPUBLISHED_REJECT';exception when raise_exception then if sqlerrm<>'INACTIVE_SECTOR' then raise;end if;end;
 if (select settings_revision from private.installation_settings where installation_id=i)<>1 then raise exception 'REJECTED_SAVE_MUTATED';end if;
 args:=jsonb_build_object('kind','ROTATE','transport','NATIVE','pending',nonce,'payload_hash',encode(extensions.gen_random_bytes(32),'hex'),'installation_id',i,'secret',secret,'version',1);
 perform public.installation_operation('START',g,args);perform public.installation_operation('START_SEAL',g,'{}');
 if exists(select 1 from private.installation_operations where generation=g and (installation_id is not null or pending_hash is not null or prior_secret_hash is not null or payload_hash is not null or receipt_ciphertext is not null)) then raise exception 'SEALED_GENERATION_NOT_MINIMAL';end if;
 if not private.installation_active(i,secret,1) then raise exception 'START_SEAL_REVOKED_PRIOR_INSTALLATION';end if;
end$$;rollback;`;
const r=docker(['exec','-i','supabase_db_judoju-news-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:query});
if(r.code)throw new Error('CATALOG_SEAL_TEST_FAILED: '+r.stderr.split('\n')[0].replace(/[0-9a-f]{32,}/gi,'[redacted]'));
const result={status:'PASS',proposed:process.argv.includes('--proposed'),fixtureTransactionsRolledBack:true,checks:['Active unpublished private leaf is not a current published notification choice','Rejected choice leaves settings and revision unchanged','Sealed tombstone removes nonce/hash/installation association','Sealing a pending rotation does not revoke the prior installation']};writePrivate('installation-catalog-seal-tests.json',result);console.log(JSON.stringify(result));
