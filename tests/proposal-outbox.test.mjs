import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {MainOwnedP4Postgres} from '../scripts/test-main-p4-integration.mjs';
import {AiProposalOutboxV1} from '../workers/ai-processing/src/proposal-outbox.ts';
import {createSyntheticAnalysisRunner} from '../workers/ai-processing/src/analysis-run.ts';
import {EVENT_ROUTING_SCHEMA} from '../workers/ai-processing/src/event-routing.ts';
import {createDurableSyntheticAnalysis} from '../workers/ai-processing/src/analysis-intent.ts';
import {collectAnalysisInput,collectorSql} from './fixtures/collected-analysis-input.mjs';

const source = 'workers/ai-processing/sql/proposal-outbox-v1.sql';
const sql = readFileSync(new URL('../' + source, import.meta.url), 'utf8');
const draftApply = readFileSync(new URL('../workers/ai-processing/sql/proposal-draft-apply-v1.sql', import.meta.url), 'utf8');
const intentSql = readFileSync(new URL('../workers/ai-processing/sql/analysis-intent-v1.sql', import.meta.url), 'utf8');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const json = value => quote(JSON.stringify(value)) + '::jsonb';
const draftBinding = {
  inputDigest:'a'.repeat(64), bodyDigest:'b'.repeat(64), policyDigest:'c'.repeat(64),
  catalogDigest:'d'.repeat(64), expectedDraftRevision:'4',
};

function definition(migration, name, replacement = name) {
  const text = readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url),'utf8');
  const prefix = 'function ' + name + '(';
  const at = text.indexOf(prefix);
  const end = text.indexOf('$$;',at);
  assert.ok(at >= 0 && end > at);
  return 'create ' + text.slice(at,end+3).replace(prefix,'function '+replacement+'(');
}

function installCatalogFixture(db, editorId, issueId) {
  db.ownerSql(`
    create schema private;
    create schema auth;
    revoke all on schema private,auth from public;
    create table private.catalog_head(singleton boolean primary key,version bigint);
    create table private.catalog_versions(version bigint primary key,active boolean);
    create table private.catalog_approvals(version bigint,state text);
    create table private.catalog_snapshots(version bigint,usage_scope text);
    create table private.policies(version bigint primary key,active boolean);
    create table private.issues(id uuid primary key,revision bigint,sample_kind text,
      publication_state text,manual_protected boolean default false);
    create table private.editor_drafts(issue_id uuid primary key,revision bigint,content jsonb,updated_at timestamptz,updated_by uuid);
    create table private.audits(actor_id text,action text,entity_id text);
    insert into private.catalog_head values(true,2);
    insert into private.catalog_versions values(2,true);
    insert into private.catalog_approvals values(2,'APPROVED');
    insert into private.catalog_snapshots values(2,'LOCAL_REFERENCE');
    insert into private.policies values(7,true);
    insert into private.issues values(${quote(issueId)},8,'SYNTHETIC','DRAFT_ONLY',false);
    insert into private.editor_drafts values(${quote(issueId)},4,'{}',clock_timestamp(),null);
    create function private.assert_initialized() returns void language plpgsql as $$begin return;end$$;
    create function private.is_admin() returns boolean language sql stable as $$select session_user='ai_outbox_editor'$$;
    create function auth.uid() returns uuid language sql stable as $$select ${quote(editorId)}::uuid$$;
    ${definition('20261114000013_m1_manual_publication.sql','private.m1_assert_editor')}
    ${definition('20261114000013_m1_manual_publication.sql','public.m1_save_draft','private.m1_save_draft_v1')}
    ${definition('20261114000019_m1_draft_shape.sql','private.m1_draft_shape')}
    ${definition('20261114000036_catalog_preserve_draft_shape.sql','public.m1_save_draft')}
    ${definition('20261114000025_catalog_read_contracts.sql','private.catalog_require_reference_head')}
    ${definition('20261114000038_catalog_recovery_targets.sql','public.catalog_save_draft')}
    revoke all on function public.catalog_save_draft(uuid,bigint,jsonb,bigint) from public;
    grant execute on function public.catalog_save_draft(uuid,bigint,jsonb,bigint) to authenticated;
    select set_config('judoju.ai_proposal_fixture_v1',current_database(),false);
    ${draftApply}
  `);
}

test('collected article flows to a proposal and editor draft with durable exact receipts', {timeout:120_000}, async () => {
  const db = new MainOwnedP4Postgres('COLLECTOR_DB_CAPTURE_V1', collectorSql);
  try {
    await db.start();
    const article = {title:'SYNTHETIC 전력 수요 계약',lead:'국내 전력 설비에 미치는 영향',body:'NO_RAW_BODY_COPY'};
    const collected = await collectAnalysisInput(db,article);
    const capturedDocuments = new Map([[collected.source.deliveryId,collected.documentId]]);
    const issueId = randomUUID();
    const comparison = {issueId,issueVersion:'8',sameDirection:true,updateSufficient:true};
    const versions = {analysisPolicyVersion:'policy-v1',catalogVersion:'catalog-v1',
      promptVersion:'prompt-v1',generatorVersion:'generator-v1'};
    const analysisRequest = {source:{source:collected.source,versions,sectorIds:['power']},routingKey:'event1'};
    const runner = createSyntheticAnalysisRunner(collected.port, {
      async metadata({request,requestDigest}) {
        assert.equal(request.source.title,article.title);
        assert.equal(request.source.lead,article.lead);
        assert.equal(request.source.sourceDocumentId,capturedDocuments.get(request.source.revisionId));
        assert.equal(Object.hasOwn(request.source,'body'),false);
        return {requestDigest,classification:'RELEVANT_EVENT',newCatalyst:'YES',koreanImpact:'SECTOR',
          sectorIds:['power'],confidence:'CLEAR',
          reasonSpans:[{field:'title',start:0,end:article.title.length,quote:article.title}]};
      },
      async routing({request,requestDigest,content}) {
        assert.equal(content.text,collected.text);
        assert.equal(request.revisions[0].contentHash,collected.source.expectedBodyHash);
        assert.equal(request.revisions[0].endpointId,
          'collector-id-sha256:' + createHash('sha256').update('fixture-analysis/articles').digest('hex'));
        return {requestDigest,proposedAction:'UPDATE',targetIssueId:issueId,angleCode:'results',
          claimIds:request.claims.map(claim=>claim.claimId),pathIds:[],comparisons:request.delta.comparisons,
          independentTitleSubstance:false,materialDifference:false,correctionClaimRefs:[]};
      },
    }, (_key, revision) => {
      const {contractVersion,sampleKind,policyVersion,catalogVersion,sourcePolicyVersion} = revision;
      const knownAt = revision.collectedAt;
      return {
        schema:EVENT_ROUTING_SCHEMA,deadlineAt:collected.expiresAt,storyId:'story1',storyVersion:'story-v1',
        canonicalEventKey:'event1',issueSetVersion:'issue-set-v1',completeIssueIds:[issueId],
        issues:[{issueId,issueVersion:'8',angleCode:'results',factKeys:['old-fact'],pathKeys:[],evidenceClaimIds:[]}],
        decision:{contractVersion,sampleKind,policyVersion,catalogVersion,sourcePolicyVersion,
          decisionId:'decision1',inputRevisionIds:[revision.revisionId],storyCandidateKey:'event1',issueCandidateKey:issueId,
          decision:'COLLECT',action:'UPDATE',reason:'SYNTHETIC new contract facts',wakeCondition:null,deadline:null,knownAt,
          evidence:['claim-two','claim-one'].map(claimId=>({claimId,revisionId:revision.revisionId,originId:revision.originId,
            groupId:revision.independenceGroupId,official:true,verified:true})),
          generatorVersion:versions.generatorVersion,promptVersion:versions.promptVersion,evidenceVersion:'evidence1'},
        claims:[
          {claimId:'claim-two',factKey:'contract-term',kind:'DETAIL',knownAt},
          {claimId:'claim-one',factKey:'contract-size',kind:'DETAIL',knownAt},
        ],
        paths:[],corrections:[],
        delta:{evidenceVersion:'evidence1',storyVersion:'story-v1',knownAt,independentTitleSubstance:false,
          materialDifference:false,comparisons:[comparison]},
        promptVersion:versions.promptVersion,generatorVersion:versions.generatorVersion,
      };
    });
    const analysis = await runner.run('proposal:fixture-one',analysisRequest);
    assert.equal(analysis.disposition,'PLAN',analysis.reason);
    assert.equal(analysis.routing.action,'UPDATE');
    const binding = {...draftBinding,bodyDigest:collected.source.expectedBodyHash};
    db.ownerSql(`
      create role ai_proposal_executor_v1 nologin nosuperuser nocreatedb nocreaterole nobypassrls;
      create role ai_outbox_writer login inherit;
      create role ai_outbox_observer login;
      create role authenticated nologin;
      create role ai_outbox_editor login inherit;
      create role ai_outbox_non_editor login inherit;
      grant ai_proposal_executor_v1 to ai_outbox_writer with inherit true,set false,admin false;
      grant authenticated to ai_outbox_editor,ai_outbox_non_editor with inherit true,set false,admin false;
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
      assert.ok(['ai_proposal_save_v1', 'ai_proposal_lookup_v1', 'ai_proposal_read_pending_v1',
        'ai_proposal_apply_draft_v1'].includes(name));
      const common = [quote(args.p_effect), quote(args.p_request_digest)];
      if (name === 'ai_proposal_save_v1') common.push(quote(JSON.stringify(args.p_proposal))+'::jsonb');
      return where.execute(`select ai_proposal_api.${name}(${common.join(',')});`).then(JSON.parse);
    };
    const client = new AiProposalOutboxV1((name,args) => sqlCall(session,name,args));
    const peerClient = new AiProposalOutboxV1((name,args) => sqlCall(peer,name,args));
    await assert.rejects(client.save({...analysis,disposition:'HOLD'},binding), /AI_PROPOSAL_OUTBOX_INVALID/);
    await assert.rejects(observer.execute(
      "select ai_proposal_api.ai_proposal_lookup_v1('proposal:fixture-one',repeat('a',64));"), {code:'FORBIDDEN'});
    await assert.rejects(session.execute('select * from ai_proposal_private.proposals;'), {code:'FORBIDDEN'});
    const [saved,replay] = await Promise.all([client.save(analysis,binding),peerClient.save(analysis,binding)]);
    assert.equal(saved.state,'PENDING_DRAFT');
    assert.deepEqual(replay,saved);
    assert.deepEqual(await client.lookup(saved.effectKey,saved.requestDigest),saved);
    const pending = await client.readPending(saved.effectKey,saved.requestDigest);
    assert.equal(pending.state,'PENDING_DRAFT');
    assert.equal(pending.proposal.expectedDraftRevision,'4');
    assert.equal(pending.proposal.bodyDigest,collected.source.expectedBodyHash);
    assert.equal(pending.proposal.analysisValidationDigest,analysis.validationRequestDigest);
    assert.deepEqual(pending.proposal.claimIds,['claim-two','claim-one']);
    assert.equal((await client.readPending(saved.effectKey,'0'.repeat(64))).state,'CONFLICT');
    await assert.rejects(observer.execute(
      "select ai_proposal_api.ai_proposal_read_pending_v1('proposal:fixture-one',repeat('a',64));"), {code:'FORBIDDEN'});
    const corruptRead = new AiProposalOutboxV1(async (name,args) => {
      const raw = await sqlCall(session,name,args);
      return {...raw,proposal:{...raw.proposal,expectedDraftRevision:'5'}};
    });
    assert.equal((await corruptRead.readPending(saved.effectKey,saved.requestDigest)).state,'UNKNOWN');
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
    assert.deepEqual(await client.readPending(saved.effectKey,saved.requestDigest),pending);

    db.ownerSql('alter table ai_proposal_private.draft_outbox add constraint fixture_reject_new check (false) not valid;');
    const failed = await client.save({...analysis,effectKey:'proposal:outbox-failed'},binding);
    assert.equal(failed.state,'UNKNOWN');
    assert.equal((await client.lookup(failed.effectKey,failed.requestDigest)).state,'NOT_FOUND');
    assert.equal(db.ownerSql('select count(*) from ai_proposal_private.proposals;'),'2');
    assert.equal(db.ownerSql('select count(*) from ai_proposal_private.draft_outbox;'),'2');

    db.ownerSql('alter table ai_proposal_private.draft_outbox drop constraint fixture_reject_new;');
    installCatalogFixture(db,randomUUID(),issueId);
    const editor = await db.openSession('ai_outbox_editor','authenticated');
    const notEditor = await db.openSession('ai_outbox_non_editor','authenticated');
    await assert.rejects(sqlCall(session,'ai_proposal_apply_draft_v1',
      {p_effect:saved.effectKey,p_request_digest:saved.requestDigest}),{code:'FORBIDDEN'});
    await assert.rejects(sqlCall(notEditor,'ai_proposal_apply_draft_v1',
      {p_effect:saved.effectKey,p_request_digest:saved.requestDigest}),{code:'FORBIDDEN'});
    await assert.rejects(editor.execute('select * from ai_proposal_private.draft_apply_context;'),{code:'FORBIDDEN'});
    const editorClient = new AiProposalOutboxV1((name,args) => sqlCall(editor,name,args));
    assert.equal((await editorClient.applyDraft(saved.effectKey,saved.requestDigest)).state,'STALE_CONTEXT');
    assert.equal((await editorClient.applyDraft(saved.effectKey,'0'.repeat(64))).state,'CONFLICT');

    const content = {title:'SYNTHETIC AI draft',summary:'요약',issue_analysis:'분석',article_kind:'MACRO',
      source_market:'SYNTHETIC',selection_market_basis:'KR',analysis_perspective:'KR_EQUITY',primary_sector_id:null,
      key_issues:[],risks:[],sources:[],impacts:[],scenarios:[],schedule:[]};
    const setContext = (proposalId,proposal,draftContent) => db.ownerSql(`
      insert into ai_proposal_private.draft_apply_context values
        (${quote(proposalId)},${json(proposal)},2,7,clock_timestamp()+interval '10 minutes',${json(draftContent)})
      on conflict (proposal_id) do update set current_proposal=excluded.current_proposal;
    `);
    setContext(saved.proposalId,{...pending.proposal,bodyDigest:'0'.repeat(64)},content);
    assert.equal((await editorClient.applyDraft(saved.effectKey,saved.requestDigest)).state,'STALE_CONTEXT');
    setContext(saved.proposalId,pending.proposal,content);
    db.ownerSql('alter table ai_proposal_private.draft_outbox add constraint fixture_reject_receipt check (applied_draft_revision is null) not valid;');
    assert.equal((await editorClient.applyDraft(saved.effectKey,saved.requestDigest)).state,'UNKNOWN');
    assert.equal(db.ownerSql('select revision from private.editor_drafts;'),'4');
    assert.equal(db.ownerSql('select count(*) from private.audits;'),'0');
    assert.deepEqual(await client.lookup(saved.effectKey,saved.requestDigest),saved);
    db.ownerSql('alter table ai_proposal_private.draft_outbox drop constraint fixture_reject_receipt;');

    const editorPeer = await db.openSession('ai_outbox_editor','authenticated');
    const lostDraftAck = new AiProposalOutboxV1(async (name,args) => {
      await sqlCall(editorPeer,name,args);
      throw new Error('draft reply lost');
    });
    const [applied,unknownDraft] = await Promise.all([
      editorClient.applyDraft(saved.effectKey,saved.requestDigest),
      lostDraftAck.applyDraft(saved.effectKey,saved.requestDigest),
    ]);
    assert.deepEqual(applied,{...saved,state:'DRAFT_APPLIED',draftRevision:'5'});
    assert.equal(unknownDraft.state,'UNKNOWN');
    assert.deepEqual(await client.lookup(unknownDraft.effectKey,unknownDraft.requestDigest),applied);
    assert.deepEqual(await editorClient.applyDraft(saved.effectKey,saved.requestDigest),applied);
    assert.deepEqual(await client.readPending(saved.effectKey,saved.requestDigest),applied);
    assert.deepEqual(await client.save(analysis,binding),applied);
    assert.deepEqual(JSON.parse(db.ownerSql('select content::text from private.editor_drafts;')),content);
    assert.equal(db.ownerSql('select count(*) from private.audits;'),'1');
    assert.equal(db.ownerSql('select publication_state from private.issues;'),'DRAFT_ONLY');

    const laterPending = await client.readPending(recovered.effectKey,recovered.requestDigest);
    setContext(recovered.proposalId,laterPending.proposal,content);
    const manual = {...content,title:'SYNTHETIC manual edit'};
    await editor.execute(`select public.catalog_save_draft(${quote(issueId)},5,${json(manual)},2);`);
    assert.equal((await editorClient.applyDraft(recovered.effectKey,recovered.requestDigest)).state,'REVISION_CONFLICT');
    assert.deepEqual(JSON.parse(db.ownerSql('select content::text from private.editor_drafts;')),manual);

    db.ownerSql(`
      select set_config('judoju.ai_proposal_fixture_v1',current_database(),false);
      ${intentSql}
    `);
    const intentPeer = await openWriter();
    const callIntent = (dbSession,args) => {
      const values = [args.p_operation,args.p_effect,args.p_work_digest,args.p_nonce,args.p_proposal_digest]
        .map(value=>value===null?'null':quote(value));
      values.push(args.p_proposal===null?'null':json(args.p_proposal));
      return dbSession.execute(`select ai_proposal_api.ai_analysis_intent_v1(${values.join(',')});`).then(JSON.parse);
    };
    const draft = {expectedDraftRevision:'6',policyDigest:binding.policyDigest,catalogDigest:binding.catalogDigest};
    const requestWithSectors = {...analysisRequest,source:{...analysisRequest.source,sectorIds:['technology','power']}};
    const reordered = {...analysisRequest,source:{...analysisRequest.source,sectorIds:['power','technology']}};
    let analysisInvocations = 0;
    const countedRunner = {async run(effect,request) {
      analysisInvocations++;
      return runner.run(effect,request);
    }};
    const durable = createDurableSyntheticAnalysis(countedRunner,args=>callIntent(session,args));
    const independent = createDurableSyntheticAnalysis(countedRunner,args=>callIntent(intentPeer,args));
    assert.equal((await durable.observe(requestWithSectors,draft)).state,'NOT_FOUND');
    const [one,two] = await Promise.all([durable.run(requestWithSectors,draft),independent.run(reordered,draft)]);
    const stored = [one,two].find(value=>value.state==='PROPOSAL_STORED');
    assert.ok(stored);
    assert.equal(analysisInvocations,1);
    assert.equal(one.effectKey,two.effectKey);
    assert.equal(one.workDigest,two.workDigest);
    assert.deepEqual(await independent.run(reordered,draft),stored);
    assert.equal((await independent.run(reordered,{...draft,expectedDraftRevision:'7'})).state,'CONFLICT');
    const storedProposal = await client.readPending(stored.effectKey,stored.proposalDigest);
    assert.equal(storedProposal.state,'PENDING_DRAFT');
    assert.equal(storedProposal.proposal.bodyDigest,collected.source.expectedBodyHash);

    const alternateRequests = new Map();
    for (const routingKey of ['lost-reserve','lost-finish','rolled-back','awaiting-evidence']) {
      const additional = await collected.capture();
      capturedDocuments.set(additional.source.deliveryId,additional.documentId);
      alternateRequests.set(routingKey,{source:{...analysisRequest.source,source:additional.source},routingKey});
    }
    const alternate = routingKey => alternateRequests.get(routingKey);
    const lostReserve = createDurableSyntheticAnalysis(countedRunner,async args=>{
      await callIntent(session,args);
      throw Error('Reservation reply lost');
    });
    assert.equal((await lostReserve.run(alternate('lost-reserve'),draft)).state,'UNKNOWN');
    assert.equal((await independent.run(alternate('lost-reserve'),draft)).state,'INDETERMINATE');
    const lost = alternate('lost-reserve');
    const differentPrompt = {...lost,source:{...lost.source,versions:{...versions,promptVersion:'prompt-v2'}}};
    assert.equal((await independent.run(differentPrompt,draft)).state,'CONFLICT');
    assert.equal((await independent.run({...lost,routingKey:'replacement-route'},draft)).state,'CONFLICT');
    assert.equal(analysisInvocations,1);

    const lostFinish = createDurableSyntheticAnalysis(countedRunner,async args=>{
      const reply = await callIntent(session,args);
      if (args.p_operation==='FINISH') throw Error('Finish reply lost');
      return reply;
    });
    assert.equal((await lostFinish.run(alternate('lost-finish'),draft)).state,'UNKNOWN');
    assert.equal((await independent.observe(alternate('lost-finish'),draft)).state,'PROPOSAL_STORED');
    assert.equal(analysisInvocations,2);

    db.ownerSql(`alter table ai_proposal_private.analysis_intents
      add constraint fixture_reject_finish check (state<>'PROPOSAL_STORED') not valid;`);
    const interrupted = await durable.run(alternate('rolled-back'),draft);
    assert.equal(interrupted.state,'UNKNOWN');
    assert.equal((await independent.observe(alternate('rolled-back'),draft)).state,'INDETERMINATE');
    assert.equal(db.ownerSql(`select count(*) from ai_proposal_private.proposals where effect_key=${quote(interrupted.effectKey)};`),'0');
    assert.equal((await independent.run(alternate('rolled-back'),draft)).state,'INDETERMINATE');
    assert.equal(analysisInvocations,3);
    await assert.rejects(session.execute('select * from ai_proposal_private.analysis_intents;'),{code:'FORBIDDEN'});
    await assert.rejects(callIntent(notEditor,{
      p_operation:'OBSERVE',p_effect:stored.effectKey,p_work_digest:stored.workDigest,p_nonce:null,
      p_proposal_digest:null,p_proposal:null,
    }),{code:'FORBIDDEN'});
    const awaitingEvidence = createDurableSyntheticAnalysis({async run(effectKey) {
      return {...analysis,effectKey,disposition:'REQUEST_EVIDENCE'};
    }},args=>callIntent(session,args));
    assert.equal((await awaitingEvidence.run(alternate('awaiting-evidence'),draft)).state,'HELD');
    assert.equal((await independent.run(alternate('awaiting-evidence'),draft)).state,'HELD');
    assert.equal(analysisInvocations,3);

    await Promise.all([session,editor,notEditor,editorPeer,intentPeer].map(open=>open.close()));
    await db.restartServer();
    session = await openWriter();
    const restarted = createDurableSyntheticAnalysis(countedRunner,args=>callIntent(session,args));
    assert.deepEqual(await restarted.run(reordered,draft),stored);
    assert.equal((await restarted.run(alternate('lost-reserve'),draft)).state,'INDETERMINATE');
    assert.equal((await restarted.run(differentPrompt,draft)).state,'CONFLICT');
    assert.equal((await restarted.observe(alternate('rolled-back'),draft)).state,'INDETERMINATE');
    assert.equal(analysisInvocations,3);
  } finally {
    await db.close();
  }
});
