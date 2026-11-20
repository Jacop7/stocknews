import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {MainOwnedP4Postgres} from '../scripts/test-main-p4-integration.mjs';
import {AiProposalOutboxV1} from '../workers/ai-processing/src/proposal-outbox.ts';

const source = 'workers/ai-processing/sql/proposal-outbox-v1.sql';
const sql = readFileSync(new URL('../' + source, import.meta.url), 'utf8');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const binding = {
  inputDigest:'a'.repeat(64), bodyDigest:'b'.repeat(64), policyDigest:'c'.repeat(64),
  catalogDigest:'d'.repeat(64), expectedDraftRevision:'4',
};

test('proposal and draft outbox commit together and exact receipts survive restart', {timeout:90_000}, async () => {
  const db = new MainOwnedP4Postgres('COLLECTOR_DB_CAPTURE_V1', source);
  try {
    await db.start();
    db.ownerSql(`
      create role ai_proposal_executor_v1 nologin nosuperuser nocreatedb nocreaterole nobypassrls;
      create role ai_outbox_writer login inherit;
      create role ai_outbox_observer login;
      grant ai_proposal_executor_v1 to ai_outbox_writer with inherit true,set false,admin false;
    `);
    const withoutStopOnError = await db.openSession('postgres', 'ai_outbox_fixture_bootstrap');
    try {
      // The harness deliberately continues past errors in this session, as plain psql -f does.
      await withoutStopOnError.execute(sql);
    } finally {
      await withoutStopOnError.close();
    }
    assert.equal(db.ownerSql(`select count(*) from pg_namespace
      where nspname in ('ai_proposal_private','ai_proposal_api');`),'0');
    db.ownerSql(`
      select set_config('judoju.ai_proposal_fixture_v1',current_database(),false);
      ${sql}
    `);
    const openWriter = () => db.openSession('ai_outbox_writer', 'ai_proposal_executor_v1');
    let session = await openWriter();
    const peer = await openWriter();
    const observer = await db.openSession('ai_outbox_observer', 'ai_outbox_observer');
    const sqlCall = (where, name, args) => {
      assert.ok(['ai_proposal_save_v1', 'ai_proposal_lookup_v1'].includes(name));
      const common = [quote(args.p_effect), quote(args.p_request_digest)];
      if (name === 'ai_proposal_save_v1') common.push(quote(JSON.stringify(args.p_proposal))+'::jsonb');
      return where.execute(`select ai_proposal_api.${name}(${common.join(',')});`).then(JSON.parse);
    };
    const client = new AiProposalOutboxV1((name,args) => sqlCall(session,name,args));
    const peerClient = new AiProposalOutboxV1((name,args) => sqlCall(peer,name,args));
    const issueId = randomUUID();
    const analysis = {
      schema:'SYNTHETIC_ANALYSIS_RUN_V1', sampleKind:'SYNTHETIC', disposition:'PLAN',
      fixtureAssertionOnly:true, providerExecutionEnabled:false, persistence:'MEMORY_FIXTURE_ONLY',
      publicationAuthorized:false, changesPublicTimestamps:false,
      effectKey:'proposal:fixture-one', validationRequestDigest:'e'.repeat(64),
      metadata:{body:'NO_RAW_BODY_COPY'},
      routing:{
        schema:'SYNTHETIC_EVENT_ROUTING_A2', sampleKind:'SYNTHETIC', disposition:'PLAN',
        fixtureAssertionOnly:true, executionEnabled:false, publicationAuthorized:false,
        changesPublicTimestamps:false, action:'UPDATE', angleCode:'results', targetIssueId:issueId,
        expectedIssueVersions:[{issueId,issueVersion:'v8'}], claimIds:['claim-two','claim-one'],
        pathIds:[], requestDigest:'f'.repeat(64),
      },
    };
    await assert.rejects(client.save({...analysis,disposition:'HOLD'},binding), /AI_PROPOSAL_OUTBOX_INVALID/);
    await assert.rejects(observer.execute(
      "select ai_proposal_api.ai_proposal_lookup_v1('proposal:fixture-one',repeat('a',64));"), {code:'FORBIDDEN'});
    await assert.rejects(session.execute('select * from ai_proposal_private.proposals;'), {code:'FORBIDDEN'});
    const [saved,replay] = await Promise.all([client.save(analysis,binding),peerClient.save(analysis,binding)]);
    assert.equal(saved.state,'PENDING_DRAFT');
    assert.deepEqual(replay,saved);
    assert.deepEqual(await client.lookup(saved.effectKey,saved.requestDigest),saved);
    assert.equal((await client.save(analysis,{...binding,expectedDraftRevision:'5'})).state,'CONFLICT');
    assert.equal(db.ownerSql('select count(*) from ai_proposal_private.proposals;'),'1');
    assert.equal(db.ownerSql('select count(*) from ai_proposal_private.draft_outbox;'),'1');
    assert.doesNotMatch(db.ownerSql('select proposal::text from ai_proposal_private.proposals;'),/NO_RAW_BODY_COPY/);

    let captured;
    const modifiedTransport = new AiProposalOutboxV1((name,args) => {
      captured = args;
      return sqlCall(session,name,{...args,p_proposal:{...args.p_proposal,angleCode:'changed'}});
    });
    const invalid = await modifiedTransport.save({...analysis,effectKey:'proposal:tampered'},binding);
    assert.equal(invalid.state,'UNKNOWN');
    assert.equal((await client.lookup(captured.p_effect,captured.p_request_digest)).state,'NOT_FOUND');

    const lostAck = new AiProposalOutboxV1(async (name,args) => {
      await sqlCall(session,name,args);
      throw new Error('reply lost');
    });
    const unknown = await lostAck.save({...analysis,effectKey:'proposal:lost-ack'},binding);
    assert.equal(unknown.state,'UNKNOWN');
    const recovered = await client.lookup(unknown.effectKey,unknown.requestDigest);
    assert.equal(recovered.state,'PENDING_DRAFT');
    await session.close();
    await peer.close();
    await observer.close();
    await db.restartServer();
    session = await openWriter();
    assert.deepEqual(await client.lookup(unknown.effectKey,unknown.requestDigest),recovered);

    db.ownerSql('alter table ai_proposal_private.draft_outbox add constraint fixture_reject_new check (false) not valid;');
    const failed = await client.save({...analysis,effectKey:'proposal:outbox-failed'},binding);
    assert.equal(failed.state,'UNKNOWN');
    assert.equal((await client.lookup(failed.effectKey,failed.requestDigest)).state,'NOT_FOUND');
    assert.equal(db.ownerSql('select count(*) from ai_proposal_private.proposals;'),'2');
    assert.equal(db.ownerSql('select count(*) from ai_proposal_private.draft_outbox;'),'2');
  } finally {
    await db.close();
  }
});
