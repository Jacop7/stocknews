import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createBacklogProcessor } from '../workers/ai-processing/runtime/pipeline.mjs';
import { validateTriage, evidenceSufficient, validateDraft } from '../workers/ai-processing/runtime/editorial.mjs';
import { validateConfig, digest, day } from '../workers/ai-processing/runtime/contracts.mjs';
import { stamp, url, config, triage, draft, verification, original, originalText } from './backlog-fixtures.mjs';

function harness(t, { filename = ':memory:', modelOverride, originalOverride } = {}) {
  const store = new BacklogStore(filename); t.after(() => store.close());
  const settings = config(); let time = stamp; const calls = [], originals = [];
  const model = async request => {
    calls.push(request.stage);
    if (modelOverride) return modelOverride(request, { settings, store });
    if (request.stage === 'triage') return triage(request.input.document.id, request.input.document.text.includes('추가 사업장'));
    if (request.stage === 'draft') return draft(request.input);
    return verification(request.input);
  };
  const processor = createBacklogProcessor({ store, loadConfig: () => settings, model, now: () => time,
    readOriginal: async request => { originals.push(request.url); return originalOverride ? originalOverride(request) : original(originalText, request.url); } });
  const add = (sourceUrl = url, sourceId = 'channel-one') => store.importLinks([{ url: sourceUrl, sourceId, lastSeen: time, expiresAt: time + 7 * day }], time);
  const drain = async (count = 4) => { const results = []; for (let index = 0; index < count; index++) results.push(await processor.step()); return results; };
  return { store, settings, calls, originals, processor, add, drain, advance: value => { time += value; } };
}

test('saved links reach a verified internal detail draft without publication and URL repeats do not reset progress', async t => {
  const h = harness(t); assert.equal(h.add().added, 1); h.add(url + '#tracking', 'channel-two');
  const results = await h.drain();
  assert.deepEqual(results.map(result => result.state), ['TRIAGE', 'DRAFT', 'VERIFY', 'DRAFT_READY']);
  assert.equal(results[3].action, 'NEW_STORY'); assert.equal(results[3].publicationAuthorized, false);
  const saved = JSON.parse(h.store.db.prepare('SELECT payload FROM issues').get().payload);
  assert.equal(saved.publication_state, 'DRAFT'); assert.equal(saved.analysis_perspective, 'KR_EQUITY');
  assert(saved.visible_sections.includes('SCENARIOS')); assert(!saved.visible_sections.includes('SCHEDULE'));
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM sightings').get().n, 2);
  assert.deepEqual(h.calls, ['triage', 'draft', 'verify']);
  assert.equal(h.add().added, 0); assert.equal((await h.processor.step()).state, 'IDLE'); assert.equal(h.calls.length, 3);
});

test('another URL with the identical body reuses extraction and does not dispatch AI again', async t => {
  const h = harness(t); h.add(); await h.drain();
  h.add('https://news.publisher.co.kr/article/copy');
  const results = await h.drain(3);
  assert.equal(results[2].state, 'DUPLICATE'); assert.equal(h.calls.length, 3);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM documents').get().n, 1);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM document_sources').get().n, 2);
});

test('an additional grounded fact updates the same draft ID and preserves its first timestamp', async t => {
  const h = harness(t, { originalOverride: request => original(originalText + (request.url.endsWith('two') ? ' 추가 사업장 검토가 공지됐다.' : ''), request.url) });
  h.add(); await h.drain(); const first = h.store.db.prepare('SELECT * FROM issues').get();
  h.advance(60000); h.add('https://news.publisher.co.kr/article/two'); const result = (await h.drain()).at(-1);
  assert.equal(result.state, 'DRAFT_READY'); assert.equal(result.action, 'UPDATE'); assert.equal(result.issueId, first.id); assert.equal(result.version, 2);
  assert.equal(h.store.db.prepare('SELECT created_at FROM issues').get().created_at, first.created_at);
});

test('manual protection leaves a proposal and never overwrites the editor draft', async t => {
  const h = harness(t, { originalOverride: request => original(originalText + (request.url.endsWith('two') ? ' 추가 사업장 검토가 공지됐다.' : ''), request.url) });
  h.add(); await h.drain(); const before = h.store.db.prepare('SELECT payload FROM issues').get().payload;
  h.store.db.exec('UPDATE issues SET manual_protected=1'); h.add('https://news.publisher.co.kr/article/two');
  const result = (await h.drain()).at(-1);
  assert.equal(result.state, 'HOLD_EDITOR'); assert.equal(h.store.db.prepare('SELECT payload FROM issues').get().payload, before);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM proposals').get().n, 1);
});

test('a verified change of Korean impact creates a separate angle instead of overwriting the original', async t => {
  const h = harness(t, {
    originalOverride: request => original(originalText + (request.url.endsWith('damage') ? ' 추가 비용 부담을 별도로 점검한다.' : ''), request.url),
    modelOverride: request => request.stage === 'triage' ? triage(request.input.document.id, false, request.input.document.text.includes('추가 비용')) :
      request.stage === 'draft' ? draft(request.input, request.input.triage.impacts[0].direction === 'DAMAGE') : verification(request.input),
  });
  h.add(); await h.drain(); const first = h.store.db.prepare('SELECT id,payload FROM issues').get();
  h.add('https://news.publisher.co.kr/article/damage'); const result = (await h.drain()).at(-1);
  assert.equal(result.action, 'NEW_ANGLE'); assert.notEqual(result.issueId, first.id);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM issues').get().n, 2);
  assert.equal(h.store.db.prepare('SELECT payload FROM issues WHERE id=?').get(first.id).payload, first.payload);
});

test('an uncertain AI dispatch remains blocked after reopen and even a changed model cannot redispatch it', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'judoju-backlog-'));
  const filename = join(directory, 'processing.sqlite'); let count = 0;
  const h = harness(t, { filename, modelOverride: async () => { count++; throw new Error('response connection lost'); } });
  h.add(); await h.processor.step(); assert.equal((await h.processor.step()).state, 'HOLD_MODEL');
  const peer = new BacklogStore(filename); t.after(() => { peer.close(); rmSync(directory, { recursive: true, force: true }); });
  peer.db.exec("UPDATE jobs SET state='TRIAGE',lease=NULL,lease_until=0");
  h.settings.models.triage = 'changed-model';
  const processor = createBacklogProcessor({ store: peer, loadConfig: () => h.settings, model: async () => { count++; assert.fail('Must not redispatch'); }, readOriginal: () => assert.fail(), now: () => stamp });
  assert.equal((await processor.step()).reason, 'MODEL_RESPONSE_UNKNOWN'); assert.equal(count, 1);
});

test('expired ownership, revoked source and expired bodies cannot create a draft', async t => {
  const h = harness(t); h.add(); await h.processor.step(); h.settings.sources[0].revokedAt = new Date(stamp).toISOString();
  await h.processor.step(); assert.equal(h.store.db.prepare('SELECT state FROM jobs').get().state, 'HOLD_SOURCE_CHANGED'); assert.equal(h.calls.length, 0);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM documents').get().n, 0);
  h.advance(8 * day); await h.processor.step(); assert.equal(h.store.db.prepare('SELECT count(*) n FROM jobs').get().n, 0);
});

test('paused execution does not claim jobs or call any source or model; budget exhaustion does not spend a call', async t => {
  const h = harness(t); h.add(); h.settings.readOriginals = false; h.settings.callModels = false;
  assert.equal((await h.processor.step()).state, 'PAUSED'); assert.equal(h.originals.length, 0); assert.equal(h.calls.length, 0);
  h.settings.readOriginals = true; h.settings.callModels = true; h.settings.maxDailyCalls = 0;
  await h.processor.step(); assert.equal((await h.processor.step()).reason, 'MODEL_DAILY_BUDGET'); assert.equal(h.calls.length, 0);
});

test('a lease prevents concurrent claims and a stale holder cannot settle a reclaimed job', t => {
  const directory = mkdtempSync(join(tmpdir(), 'judoju-backlog-lease-'));
  const h = harness(t, { filename: join(directory, 'db.sqlite') }); h.add();
  const peer = new BacklogStore(join(directory, 'db.sqlite')); t.after(() => { peer.close(); rmSync(directory, { recursive: true, force: true }); });
  const first = h.store.claim(stamp); assert.equal(peer.claim(stamp), null);
  const next = peer.claim(stamp + 120001); assert(next);
  assert.throws(() => h.store.settle(first, 'EXCLUDED', {}, stamp + 120001), /LEASE_STALE/);
});

test('advertisements and unrelated price recaps are excluded but mixed or uncertain news are held', () => {
  const c = config(), doc = { id: 'd', text: originalText };
  for (const classification of ['PURE_PROMOTION', 'PRICE_RECAP_ONLY', 'UNRELATED']) {
    const raw = triage('d'); Object.assign(raw, { classification, newCatalyst: false, koreanImpact: false });
    assert.equal(validateTriage(raw, [doc], c.catalog).state, 'EXCLUDED');
    raw.newCatalyst = true; assert.equal(validateTriage(raw, [doc], c.catalog).state, 'HOLD');
  }
  const raw = triage('d'); raw.facts[0].refs[0].quote = 'Invented source claim';
  assert.throws(() => validateTriage(raw, [doc], c.catalog), /FABRICATED_EVIDENCE/);
});

test('three reprints or unknown groups never satisfy systemic macro corroboration', () => {
  const fact = { verificationClass: 'SYSTEMIC_MACRO', refs: [{ docId: 'a' }, { docId: 'b' }, { docId: 'c' }] };
  const documents = ['a', 'b', 'c'].map((id, n) => ({ id, sources: [{ ...config().sources[0], articleOriginVerified: true, originGroupId: 'o' + n, newsroomId: 'n' + n, ownerGroupId: 'g' + n }] }));
  assert(evidenceSufficient(fact, documents)); documents[2].sources[0].originGroupId = 'o1';
  assert(!evidenceSufficient(fact, documents)); documents[2].sources[0].originGroupId = null;
  assert(!evidenceSufficient(fact, documents)); documents[0].sources[0].kind = 'OFFICIAL'; assert(evidenceSufficient(fact, documents));
});

test('host-level origin assertions cannot certify article-level independence', async t => {
  const h = harness(t); h.add(); await h.processor.step();
  const id = h.store.db.prepare('SELECT id FROM documents').get().id;
  let doc = h.store.documents([id], h.settings, stamp)[0];
  assert.equal(doc.sources[0].articleOriginVerified, false); assert.equal(doc.sources[0].originGroupId, null);
  h.settings.documentOrigins = [{ url, bodyHash: id, originGroupId: 'actual-wire', quote: originalText.slice(0, 30), verified: true }];
  doc = h.store.documents([id], validateConfig(h.settings), stamp)[0];
  assert.equal(doc.sources[0].articleOriginVerified, true); assert.equal(doc.sources[0].originGroupId, 'actual-wire');
  h.settings.documentOrigins[0].bodyHash = digest('different article');
  assert.equal(h.store.documents([id], h.settings, stamp)[0].sources[0].articleOriginVerified, false);
});

test('unknown publication time is held before the first model call', async t => {
  const h = harness(t, { originalOverride: request => ({ ...original(originalText, request.url), publishedAt: null }) });
  h.add(); await h.processor.step(); assert.equal((await h.processor.step()).state, 'HOLD_DATE');
  assert.equal(h.calls.length, 0); assert.equal(h.store.db.prepare('SELECT count(*) n FROM runs').get().n, 0);
});

test('revocation removes exact quotes and drafts from jobs, proposals and dependent model responses', async t => {
  const h = harness(t); h.add(); await h.drain();
  const id = h.store.db.prepare('SELECT id FROM documents').get().id;
  h.store.db.prepare('INSERT INTO proposals VALUES (?,?,?,?,?)').run('proposal', 'job', JSON.stringify({ text: originalText, source_refs: [{ docId: id }] }), 'fixture', stamp + day);
  h.store.db.prepare('INSERT INTO proposals VALUES (?,?,?,?,?)').run('unrelated-proposal', 'other', JSON.stringify({ source_refs: [{ docId: 'unrelated-doc' }] }), 'fixture', stamp + day);
  h.settings.sources[0].revokedAt = new Date(stamp).toISOString(); await h.processor.step();
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM documents').get().n, 0);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM proposals').get().n, 1);
  assert.equal(h.store.db.prepare('SELECT id FROM proposals').get().id, 'unrelated-proposal');
  for (const row of h.store.db.prepare('SELECT payload FROM jobs UNION ALL SELECT payload FROM issues').all()) {
    assert(!row.payload.includes('장비투자')); assert(!row.payload.includes('국내 장비 공급망'));
  }
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM runs WHERE response IS NOT NULL').get().n, 0);
});

test('same-event same-fact rewritten reports append sources before paying for draft or verification', async t => {
  const h = harness(t, { originalOverride: request => original(originalText + (request.url.endsWith('rewrite') ? ' 별도의 취재 문구다.' : ''), request.url) });
  h.add(); await h.drain(); const first = h.store.db.prepare('SELECT id,version,updated_at FROM issues').get();
  h.advance(60000); h.add('https://news.publisher.co.kr/article/rewrite');
  assert.equal((await h.drain(3)).at(-1).state, 'DUPLICATE');
  assert.deepEqual(h.calls, ['triage', 'draft', 'verify', 'triage']);
  assert.deepEqual({ ...h.store.db.prepare('SELECT id,version,updated_at FROM issues').get() }, { ...first });
  assert.equal(JSON.parse(h.store.db.prepare('SELECT payload FROM issues').get().payload).source_refs.length, 2);
});

test('nine originals cannot silently replace a verified issue with an eight-document subset', async t => {
  const h = harness(t); h.add(); await h.drain();
  const before = h.store.db.prepare('SELECT payload FROM issues').get().payload;
  const row = h.store.db.prepare('SELECT * FROM triages').get();
  for (let i = 0; i < 8; i++) {
    const id = digest('extra-' + i);
    h.store.db.prepare('INSERT INTO documents VALUES (?,?,?,?,?)').run(id, '추가 원문', originalText, new Date(stamp).toISOString(), stamp + day);
    h.store.db.prepare('INSERT INTO document_sources VALUES (?,?,?,?)').run(id, url + '?item=' + i, JSON.stringify(h.settings.sources[0]), stamp + day);
    h.store.db.prepare('INSERT INTO triages VALUES (?,?,?,?,?)').run(id, row.config_hash, row.story_key, row.partition_key, row.payload);
  }
  h.store.db.exec("UPDATE jobs SET state='DRAFT'");
  assert.equal((await h.processor.step()).state, 'HOLD_CONTEXT_LIMIT');
  assert.equal(h.store.db.prepare('SELECT payload FROM issues').get().payload, before); assert.equal(h.calls.length, 3);
});

test('structured quantities, RELATED direction and scheduled dates must be supported by cited evidence', () => {
  const c = config(), doc = { id: 'd', title: '가상 원문', text: originalText, sources: [{ ...c.sources[0], url }] };
  const invalid = triage('d'); invalid.facts[0].value = '799';
  assert.throws(() => validateTriage(invalid, [doc], c.catalog), /FACT_VALUE_MISMATCH|FACT_UNIT_MISMATCH/);
  invalid.facts[0].value = '799%'; assert.throws(() => validateTriage(invalid, [doc], c.catalog), /FACT_VALUE_MISMATCH/);
  const shares = triage('d'); shares.facts[0].value = '700'; shares.facts[0].unit = 'USD';
  shares.facts[0].statement = '700주를 취득했다.'; shares.facts[0].refs = [{ docId: 'd', quote: shares.facts[0].statement }];
  assert.throws(() => validateTriage(shares, [{ ...doc, text: originalText + shares.facts[0].statement }], c.catalog), /FACT_UNIT_MISMATCH/);
  const related = triage('d'); related.impacts[0].direction = 'RELATED';
  assert.throws(() => validateTriage(related, [doc], c.catalog), /RELATED_CONDITION_REQUIRED/);
  const accepted = validateTriage(triage('d'), [doc], c.catalog).value, raw = draft({ facts: accepted.facts, triage: accepted });
  raw.schedule = [{ title: '근거 없는 회의', eventAt: '2031-04-10T09:00:00+09:00', timezone: 'Asia/Seoul', factIds: [accepted.facts[0].id] }];
  assert.throws(() => validateDraft(raw, { facts: accepted.facts, documents: [doc], triage: accepted, catalog: c.catalog, now: stamp }), /SCHEDULE_SOURCE_ZONE_UNVERIFIED|UNSUPPORTED_SCHEDULE_TIME/);
});

test('catalog changes cannot replace an existing detail with a subset of its supported facts', async t => {
  const h = harness(t, { originalOverride: request => original(originalText + (request.url.endsWith('first') ? ' 추가 사업장 검토가 공지됐다.' : ''), request.url),
    modelOverride: request => {
      if (request.stage === 'triage') {
        const value = triage(request.input.document.id, request.input.document.text.includes('추가 사업장'));
        if (!request.input.document.text.includes('추가 사업장')) value.facts[0].predicate = 'NEW_SPENDING_DETAIL';
        return value;
      }
      return request.stage === 'draft' ? draft(request.input) : verification(request.input);
    } });
  h.add('https://news.publisher.co.kr/article/first'); await h.drain();
  const before = h.store.db.prepare('SELECT payload FROM issues').get().payload;
  h.settings.catalog.version = 'fixture-v2'; h.add('https://news.publisher.co.kr/article/new-report');
  assert.equal((await h.drain(3)).at(-1).state, 'HOLD_INCOMPLETE_UPDATE');
  assert.equal(h.store.db.prepare('SELECT payload FROM issues').get().payload, before);
  assert.deepEqual(h.calls, ['triage', 'draft', 'verify', 'triage']);
});

test('a sourced local schedule cannot silently change its instant through a mismatched timezone', () => {
  const c = config(), scheduled = '한국 시간(KST) 2026년 11월 22일 09:00에 설명회가 열린다.';
  const doc = { id: 'd', title: '가상 원문', text: originalText + scheduled, sources: [{ ...c.sources[0], url }] };
  const raw = triage('d'); raw.facts.push({ ...raw.facts[0], id: 'schedule', predicate: 'MEETING', value: 'meeting', unit: '',
    statement: scheduled, refs: [{ docId: 'd', quote: scheduled }] });
  const accepted = validateTriage(raw, [doc], c.catalog).value, output = draft({ facts: accepted.facts, triage: accepted });
  output.schedule = [{ title: '설명회', eventAt: '2026-11-22T09:00:00Z', timezone: 'Asia/Seoul', factIds: [accepted.facts[1].id] }];
  const context = { facts: accepted.facts, documents: [doc], triage: accepted, catalog: c.catalog, now: stamp };
  assert.throws(() => validateDraft(output, context), /SCHEDULE_ZONE_MISMATCH/);
  output.schedule[0].timezone = 'UTC'; assert.throws(() => validateDraft(output, context), /SCHEDULE_SOURCE_ZONE_UNVERIFIED/);
  output.schedule[0].timezone = 'Asia/Seoul';
  output.schedule[0].eventAt = '2026-11-22T09:00:00+09:00';
  assert(validateDraft(output, context).visible_sections.includes('SCHEDULE'));
  context.facts[1].refs[0].quote = '2026-11-22 09:00 (UTC+9) 설명회';
  output.schedule[0].eventAt = '2026-11-22T09:00:00Z'; output.schedule[0].timezone = 'UTC';
  assert.throws(() => validateDraft(output, context), /SCHEDULE_SOURCE_ZONE_UNVERIFIED/);
  context.facts[1].refs[0].quote = '한국시간 9일 발표 … 2026-11-22 09:00(현지시간) 뉴욕 회의';
  output.schedule[0].eventAt = '2026-11-22T09:00:00+09:00'; output.schedule[0].timezone = 'Asia/Seoul';
  assert.throws(() => validateDraft(output, context), /SCHEDULE_SOURCE_ZONE_UNVERIFIED/);
});

test('quantity types preserve percent-point distinction, USD aliases and categorical HBM4', () => {
  const c = config();
  function check(value, unit, quote, statement = quote) {
    const input = triage('d'); input.facts[0] = { ...input.facts[0], value, unit, statement, refs: [{ docId: 'd', quote }] };
    return validateTriage(input, [{ id: 'd', text: originalText + quote }], c.catalog);
  }
  assert.throws(() => check('20', '%', '비중이 20%p 늘었다.'), /FACT_UNIT_MISMATCH/);
  assert.equal(check('20', '%p', '비중이 20%p 늘었다.').state, 'RELEVANT');
  assert.equal(check('700', 'USD', '투자액은 700달러다.').state, 'RELEVANT');
  assert.equal(check('700', 'USD', '투자액은 $700이다.').state, 'RELEVANT');
  assert.equal(check('700', 'USD', 'The company paid $700.').state, 'RELEVANT');
  assert.throws(() => check('20', '%', '투자비는 -20% 변했다.'), /FACT_UNIT_MISMATCH/);
  assert.throws(() => check('20', '%', '투자비는 −20% 변했다.'), /FACT_UNIT_MISMATCH/);
  assert.throws(() => check('700', 'USD', 'HK$700 today'), /FACT_UNIT_MISMATCH/);
  assert.throws(() => check('HBM4', '', '제품은 HBM4E다.'), /FACT_VALUE_MISMATCH/);
  assert.throws(() => check('20', 'percent', '20 percentage points 증가'), /FACT_UNIT_UNSUPPORTED/);
  assert.throws(() => check('20', '퍼센트', '20퍼센트포인트 증가'), /FACT_UNIT_UNSUPPORTED/);
  assert.equal(check('20', '%p', '20 percentage points 증가').state, 'RELEVANT');
  assert.throws(() => check('700', '억', '700억달러 투자'), /FACT_UNIT_UNSUPPORTED/);
  assert.throws(() => check('700', 'USD', '50억 달러 700억원'), /FACT_UNIT_MISMATCH/);
  assert.throws(() => check('USD700', '', 'USD700 투자'), /FACT_VALUE_MISMATCH/);
  assert.equal(check('HBM4', '', '제품은 HBM4다.').state, 'RELEVANT');
  assert.throws(() => check('700', '', '700주를 취득했다.'), /FACT_UNIT_REQUIRED/);
  assert.throws(() => check('3', 'shares', '3주 안에 완료한다.'), /FACT_UNIT_MISMATCH|FACT_SHARE_CONTEXT_REQUIRED/);
  assert.throws(() => check('3700', 'USD', '항목은 3, 700달러다.'), /FACT_UNIT_MISMATCH/);
  assert.equal(check('3700', 'USD', '금액은 3,700달러다.').state, 'RELEVANT');
  assert.throws(() => check('약799', '', '증가율은 20%다.'), /FACT_VALUE_MISMATCH/);
});

test('damage-only drafts suppress scenarios, reject invented IDs/numbers and require risks', () => {
  const c = config(), doc = { id: 'd', title: '가상 원문 제목', text: originalText, sources: [{ ...c.sources[0], url }] };
  const accepted = validateTriage(triage('d', false, true), [doc], c.catalog);
  const input = { facts: accepted.value.facts, triage: accepted.value }; const raw = draft(input, true);
  const context = { ...input, documents: [doc], catalog: c.catalog, now: stamp };
  const value = validateDraft(raw, context);
  assert.equal(value.impact_profile, 'DAMAGE_ONLY'); assert(!value.visible_sections.includes('SCENARIOS')); assert(value.visible_sections.includes('RISKS'));
  const bad = structuredClone(raw); bad.scenarios = draft(input).scenarios;
  assert.throws(() => validateDraft(bad, context), /NEGATIVE_ONLY_SCENARIO/);
  const wrongNumber = structuredClone(raw); wrongNumber.summary = '예산이 999% 늘어난다.';
  assert.throws(() => validateDraft(wrongNumber, context), /DRAFT_NUMBER_MISMATCH/);
  const wrongEntity = structuredClone(raw); wrongEntity.impacts[0].companyIds = ['invented-company'];
  assert.throws(() => validateDraft(wrongEntity, context), /UNKNOWN_REFERENCE/);
});
