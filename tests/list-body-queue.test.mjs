import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {MainOwnedP4Postgres, prepareCollectorInstallContext} from '../scripts/test-main-p4-integration.mjs';
import {CollectorListQueueV1} from '../workers/collectors/src/list-body-queue.ts';

const literal = value => value === null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
const json = value => literal(JSON.stringify(value)) + '::jsonb';
const queueSql = readFileSync(new URL('../workers/collectors/sql/list-body-queue-v1.sql', import.meta.url), 'utf8');

test('the isolated queue retains page, claim, proof and checkpoint through retries and restart', {timeout: 90_000}, async () => {
  const db = new MainOwnedP4Postgres('COLLECTOR_DB_CAPTURE_V1', 'workers/collectors/sql/collector_db_capture_v1.sql');
  try {
    await db.start();
    const {identity, local, installContext} = await prepareCollectorInstallContext(db);
    const expectedSqlSha256 = db.contractSha256;
    const verifiedResource = await local.verifyCollectorDbCaptureResourceV1(installContext, {
      stage: 'BEFORE_APPLY', expectedSqlSha256,
    });
    const installation = await local.applyCollectorDbCaptureSqlV1(installContext, {
      operation: 'APPLY_REVIEWED_COLLECTOR_SQL', expectedSqlSha256, verifiedResource,
    });
    assert.equal(installation.status, 'APPLIED');
    assert.throws(() => db.ownerSql(queueSql), /P4_DOCKER_COMMAND_FAILED/);
    db.ownerSql("select set_config('collector.queue_fixture_v1'," + literal(identity.resourceIdentityDigest) + ",false);\n" + queueSql);
    const executor = identity.testLoginPrincipals.executor;
    const reader = identity.testLoginPrincipals.reader;
    const binding = {grantId: randomUUID(), grantGeneration: '1', grantVersion: 'fixture-grant', sourcePolicyVersion: 'fixture-source'};
    const page = randomUUID(), first = randomUUID(), second = randomUUID(), original = randomUUID();
    const documentA = randomUUID(), documentB = randomUUID(), body = randomUUID();
    const epoch = installation.storeIdentity.storeEpoch;
    const firstText = {deliveryId: first, title: '\t', lead: '머리말'};
    const secondText = {deliveryId: second, title: '제목 둘', lead: ''};
    const bodyProof = 'b'.repeat(64);
    const stamp = "collector_private.stamp_v1(clock_timestamp()+interval '1 hour')";
    const loc = label => json({syntheticLocator:'https://queue.example.invalid/'+label,providerRevisionRef:'revision-one'});
    const seedDelivery = (delivery, document, native, sequence, kind, purpose) => {
      return '(' + [delivery, document, 'source', 'endpoint', native, randomUUID(), 0, sequence,
        binding.grantId, 1, 'delivery-'+delivery, kind, purpose].map(literal).join(',') +
        ',clock_timestamp(),clock_timestamp(),' + loc(native) + ",'{}'::jsonb)";
    };
    const seedBody = (bodyId, deliveryId, effect, proof) => `
      insert into collector_private.collector_body_v1 values
        (${literal(bodyId)},${literal(deliveryId)},${literal(binding.grantId)},1,${literal(effect)},'ORIGINAL_ACCESS','identity',
         'RAW_BYTES_SHA256_V1',repeat('a',64),'UTF8_BODY_BYTES_SHA256_V1',repeat('a',64),1,1,
         clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '10 minutes','{}');
      insert into collector_private.collector_body_payload_v1 values (${literal(bodyId)},decode('41','hex'),'A');
      insert into collector_private.collector_effect_v1 values
        (${literal(effect)},${epoch},'ATTACH_BODY','COLLECTOR_CANONICAL_UTF8_SHA256_V1',repeat('c',64),${literal(executor.name)},
         '{}','{}','[]',gen_random_uuid(),${literal(proof)},
         ${json({binding:{bodyId,deliveryId}})},clock_timestamp());
    `;
    db.ownerSql(`
      insert into collector_private.collector_grant_v1 values
        (${literal(binding.grantId)},1,'source','endpoint',${epoch},'ISSUE','fixture-grant','fixture-source',
         clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour',null,600000,
         jsonb_build_object('writePrincipal',${literal(executor.name)},'auditPrincipals',jsonb_build_array(${literal(executor.name)}),
           'auditRetentionUntil',${stamp},'purposes',jsonb_build_object('DISCOVERY','ALLOW','STORAGE','ALLOW','ORIGINAL_ACCESS','ALLOW')),
         'fixture');
      insert into collector_private.collector_grant_head_v1 values ('source','endpoint',${literal(binding.grantId)},1);
      insert into collector_private.collector_document_v1 values
        (${literal(documentA)},'source','one',1,clock_timestamp()),(${literal(documentB)},'source','two',2,clock_timestamp());
      insert into collector_private.collector_delivery_v1 values
        ${seedDelivery(first,documentA,'one',1,'DISCOVERY_METADATA','DISCOVERY')},
        ${seedDelivery(second,documentB,'two',1,'DISCOVERY_METADATA','DISCOVERY')},
        ${seedDelivery(original,documentB,'two',2,'ORIGINAL_ARTICLE','ORIGINAL_ACCESS')};
      ${seedBody(body,original,'body-effect',bodyProof)}
    `);
    const open = principal => db.openSession(principal.name, principal.roleName);
    let actor = await open(executor);
    const other = await open(executor);
    const observer = await open(reader);
    const call = async (session, name, args) => {
      try {
        const raw = await session.execute(`select collector_api.collector_list_queue_${name}_v1(${args.join(',')});`);
        return raw.trim() === '' ? null : JSON.parse(raw);
      } catch (error) {
        throw new Error(name + ': ' + error.message, {cause:error});
      }
    };
    const queueCall = (rpc, args) => {
      if (rpc === 'collector_store_identity_v1') {
        return actor.execute('select collector_api.collector_store_identity_v1();').then(JSON.parse);
      }
      const method = /^collector_list_queue_(stage|claim|settle|checkpoint)_v1$/.exec(rpc)?.[1];
      assert.ok(method);
      return call(actor, method, Object.entries(args).map(([key,value]) => {
        assert.match(key, /^p_[a-z_]+$/);
        return key+' => '+(key==='p_items'||key==='p_grant' ? json(value) : literal(value));
      }));
    };
    const queue = new CollectorListQueueV1(queueCall,installation.storeIdentity);
    const stage = (session, items = [firstText, secondText]) => call(session, 'stage', [
      "'partition'","'source'","'endpoint'",epoch,json(binding),"'policy-v1'",literal(page),0,'null',"'next-page'",json(items),
    ]);
    const claim = (session, lease, seconds) => call(session, 'claim', [literal(page),literal(lease),seconds]);
    const checkpoint = digest => call(actor, 'checkpoint', [literal(page),literal(digest)]);
    const settle = (delivery, token, outcome, proof, bodyId = null) => call(actor, 'settle', [
      literal(page),literal(delivery),literal(token),literal(outcome),literal(proof),literal(bodyId),
    ]);
    await assert.rejects(stage(observer));
    await assert.rejects(stage(actor,[]), /stage: INVALID_INPUT/);
    db.ownerSql(`insert into collector_private.collector_tombstone_v1 values
      ('source','one',${literal(documentA)},'TEST','fixture','{}',${epoch},clock_timestamp(),'blocked-one');`);
    await assert.rejects(stage(actor), /stage: TOMBSTONED/);
    db.ownerSql("delete from collector_private.collector_tombstone_v1 where native_id='one';");
    const staged = await queue.stage({partition:'partition',source:'source',endpoint:'endpoint',grant:binding,
      policyVersion:'policy-v1',pageId:page,version:'0',cursorRef:null,nextCursorRef:'next-page',items:[firstText,secondText]});
    const {manifestDigest} = staged;
    assert.deepEqual(await stage(actor), {manifestDigest});
    await assert.rejects(stage(actor,[{...firstText,title:'changed'}]));
    await assert.rejects(checkpoint(manifestDigest));
    const expiredToken = randomUUID(), secondToken = randomUUID(), currentToken = randomUUID();
    const leased = await queue.claim(page,expiredToken,1);
    assert.deepEqual(await claim(other,expiredToken,10),leased);
    assert.equal((await claim(other,secondToken,45)).deliveryId,second);
    await delay(1100);
    const currentClaim = await queue.claim(page,currentToken,30);
    assert.equal(currentClaim.deliveryId,first);
    await assert.rejects(claim(actor,expiredToken,30));
    const skipProof = db.ownerSql('select collector_private.digest_v1(' + json({
      decision:'SKIP_BODY',policyVersion:'policy-v1',...firstText,
    }) + ');');
    await assert.rejects(settle(first,expiredToken,'SKIP_BODY',skipProof));
    await assert.rejects(settle(first,currentToken,'SKIP_BODY','d'.repeat(64)));
    const skipped = await queue.skipBody(page,currentToken,currentClaim);
    assert.equal(skipped.proof,skipProof);
    assert.deepEqual(await settle(first,currentToken,'SKIP_BODY',skipProof), skipped);
    await assert.rejects(settle(second,secondToken,'BODY_STORED','d'.repeat(64),body));
    db.ownerSql(`update collector_private.collector_delivery_v1
      set data=data||'{"providerRevisionRef":"revision-two"}' where delivery_id=${literal(original)};`);
    await assert.rejects(settle(second,secondToken,'BODY_STORED',bodyProof,body), /settle: RIGHTS_HOLD/);
    db.ownerSql(`update collector_private.collector_delivery_v1
      set data=data||'{"providerRevisionRef":"revision-one"}' where delivery_id=${literal(original)};`);
    assert.equal((await queue.bodyStored(page,secondToken,second,body,bodyProof)).outcome,'BODY_STORED');
    await actor.close();
    await other.close();
    await observer.close();
    await db.restartServer();
    actor = await open(executor);
    db.ownerSql(`update collector_private.collector_body_v1 set retention_until=clock_timestamp()-interval '1 second'
      where body_id=${literal(body)};`);
    await assert.rejects(checkpoint(manifestDigest), /checkpoint: RIGHTS_HOLD/);
    const replacementDelivery = randomUUID(), replacementBody = randomUUID(), replacementToken = randomUUID();
    const replacementProof = 'e'.repeat(64);
    assert.equal((await claim(actor,replacementToken,30)).deliveryId,second);
    await assert.rejects(settle(second,secondToken,'BODY_STORED',bodyProof,body), /settle: EFFECT_CONFLICT/);
    await assert.rejects(settle(second,replacementToken,'SKIP_BODY','d'.repeat(64)), /settle: RIGHTS_HOLD/);
    db.ownerSql(`
      insert into collector_private.collector_delivery_v1 values
        ${seedDelivery(replacementDelivery,documentB,'two',3,'ORIGINAL_ARTICLE','ORIGINAL_ACCESS')};
      ${seedBody(replacementBody,replacementDelivery,'replacement-effect',replacementProof)}
    `);
    assert.equal((await settle(second,replacementToken,'BODY_STORED',replacementProof,replacementBody)).bodyId,replacementBody);
    assert.equal(db.ownerSql(`select receipt->>'bodyId' from collector_private.list_queue_lease_v1
      where lease_token=${literal(secondToken)};`),body);
    let acknowledgements = 0;
    const corruptReply = new CollectorListQueueV1(async (rpc, params) => {
      const result = await queueCall(rpc,params);
      if (rpc === 'collector_list_queue_checkpoint_v1') {
        acknowledgements++;
        return acknowledgements === 1 ? {...result,cursorRef:null} : {...result,version:'2'};
      }
      return result;
    },installation.storeIdentity);
    await assert.rejects(corruptReply.checkpoint(staged), {code:'COMMIT_UNKNOWN'});
    assert.equal(acknowledgements,1);
    await assert.rejects(corruptReply.checkpoint(staged), {code:'COMMIT_UNKNOWN'});
    assert.equal(acknowledgements,2);
    const saved = await queue.checkpoint(staged);
    assert.deepEqual(saved, {pageId:page,version:'1',cursorRef:'next-page',manifestDigest});
    assert.deepEqual(await checkpoint(manifestDigest),saved);
    const waitingPage = randomUUID();
    await call(actor, 'stage', ["'wait-partition'","'source'","'endpoint'",epoch,json(binding),"'policy-v1'",
      literal(waitingPage),0,'null','null',json([firstText])]);
    const lockOwner = await open(executor);
    const waitForBlock = async () => {
      for (let tries=0; tries<12; tries++) {
        if (db.ownerSql(`select cardinality(pg_blocking_pids(${actor.backendPid}));`) === '1') return;
        await delay(40);
      }
      assert.fail('Expected a blocked collector claim');
    };
    await lockOwner.execute('begin;');
    await lockOwner.execute("select pg_advisory_xact_lock(hashtextextended('collector/D/source/one',0));");
    db.ownerSql("update collector_private.collector_grant_v1 set expires_at=clock_timestamp()+interval '2 seconds';");
    const waiting = call(actor,'claim',[literal(waitingPage),literal(randomUUID()),30]).then(
      value => ({value}), error => ({error}));
    await waitForBlock();
    await delay(2100);
    await lockOwner.execute('commit;');
    assert.match((await waiting).error.message, /claim: RIGHTS_HOLD/);
    db.ownerSql("update collector_private.collector_grant_v1 set expires_at=clock_timestamp()+interval '1 hour';");
    const ownerPage = randomUUID(), sharedToken = randomUUID();
    await call(actor, 'stage', ["'token-holder'","'source'","'endpoint'",epoch,json(binding),"'policy-v1'",
      literal(ownerPage),0,'null','null',json([firstText])]);
    db.ownerSql("update collector_private.collector_grant_v1 set expires_at=clock_timestamp()+interval '2 seconds';");
    await lockOwner.execute('begin;');
    assert.equal((await call(lockOwner,'claim',[literal(ownerPage),literal(sharedToken),30])).deliveryId,first);
    const tokenWaiting = call(actor,'claim',[literal(waitingPage),literal(sharedToken),30]).then(
      value => ({value}), error => ({error}));
    await waitForBlock();
    await delay(2100);
    await lockOwner.execute('rollback;');
    assert.match((await tokenWaiting).error.message, /claim: RIGHTS_HOLD/);
    assert.equal(db.ownerSql(`select count(*) from collector_private.list_queue_lease_v1 where lease_token=${literal(sharedToken)};`),'0');
    db.ownerSql("update collector_private.collector_grant_v1 set event='REVOKE',revoked_at=clock_timestamp();");
    await assert.rejects(claim(actor,randomUUID(),30));
    await assert.rejects(checkpoint(manifestDigest));
  } finally {
    await db.close();
  }
});
