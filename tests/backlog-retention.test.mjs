import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BacklogStore, EVIDENCE_DAYS, DRAFT_DAYS } from '../workers/ai-processing/runtime/store.mjs';
import { createBacklogProcessor } from '../workers/ai-processing/runtime/pipeline.mjs';
import { canonical } from '../workers/ai-processing/runtime/contracts.mjs';
import { stamp, url, config, triage, draft, verification, original, originalText } from './backlog-fixtures.mjs';

const day = 86_400_000;
function harness(t, { triageFor } = {}) {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  const settings = config(); let time = stamp; const calls = [];
  const processor = createBacklogProcessor({ store, loadConfig: () => settings, now: () => time,
    readOriginal: async request => original(originalText + (request.url.endsWith('two') ? ' 추가 사업장 검토가 공지됐다.' : ''), request.url),
    model: async request => {
      calls.push(request.stage);
      if (request.stage === 'triage') return triageFor ? triageFor(request) : triage(request.input.document.id, request.input.document.text.includes('추가 사업장'));
      if (request.stage === 'draft') return draft(request.input);
      return verification(request.input);
    } });
  const add = (target = url) => store.importLinks([{ url: target, sourceId: 'channel', lastSeen: time, expiresAt: time + 7 * day }], time);
  const drain = async (count = 4) => { const out = []; for (let i = 0; i < count; i++) out.push(await processor.step()); return out; };
  const row = sql => { const value = store.db.prepare(sql).get(); return value && { ...value }; };
  return { store, settings, calls, processor, add, drain, row, advance: ms => { time += ms; }, now: () => time };
}

test('a finished analysis deletes its original title, body and model responses but keeps facts and the draft', async t => {
  const h = harness(t); h.add();
  assert.equal((await h.drain()).at(-1).state, 'DRAFT_READY');
  assert.deepEqual(h.row('SELECT title, body FROM documents'), { title: '', body: '' });
  assert.equal(h.row('SELECT count(*) n FROM runs WHERE response IS NOT NULL').n, 0);
  assert.equal(h.row('SELECT count(*) n FROM triages').n, 1);
  const issue = h.row('SELECT expires_at, payload FROM issues');
  assert.equal(issue.expires_at, stamp + DRAFT_DAYS * day);
  assert(!issue.payload.includes(originalText.slice(0, 30)));
  assert.equal(h.row('SELECT expires_at FROM documents').expires_at, stamp + EVIDENCE_DAYS * day);
});

test('an excluded original is deleted at once', async t => {
  const h = harness(t, { triageFor: () => ({ ...triage('x'), classification: 'PURE_PROMOTION', newCatalyst: false, koreanImpact: false }) });
  h.add();
  const [, excluded] = await h.drain(2);
  assert.equal(excluded.state, 'EXCLUDED');
  assert.deepEqual(h.row('SELECT title, body FROM documents'), { title: '', body: '' });
});

test('originals stay while a draft or verification of the same story is still in flight', async t => {
  const h = harness(t); h.add(); await h.drain(1);
  const doc = h.row('SELECT id FROM documents').id;
  h.store.db.prepare("INSERT INTO triages VALUES (?,?,?,?,?)").run(doc, 'cfg', 'story-1', 'p', canonical({}));
  h.store.db.prepare("INSERT INTO jobs(id,url,state,next_at,payload,expires_at) VALUES ('other','https://news.publisher.co.kr/x','VERIFY',0,?,?)")
    .run(canonical({ storyKey: 'story-1', docId: 'another-doc' }), stamp + day);
  h.store.db.prepare("UPDATE jobs SET state='HOLD_TRIAGE' WHERE id<>'other'").run();
  assert.equal(h.store.releaseOriginals([doc]), 0);
  assert.notEqual(h.row('SELECT body FROM documents').body, '');
  h.store.db.prepare("UPDATE jobs SET state='DRAFT_READY' WHERE id='other'").run();
  assert.equal(h.store.releaseOriginals([doc]), 1);
  assert.equal(h.row('SELECT body FROM documents').body, '');
});

test('an unfinished original is deleted at its source deadline; facts and drafts follow their own 30-day clocks', async t => {
  const h = harness(t); h.add(); await h.drain();
  h.add('https://news.publisher.co.kr/article/two'); await h.drain(1);
  // The second original is fetched but left unfinished, then its 7-day source deadline passes.
  h.store.db.prepare("UPDATE jobs SET state='HOLD_TRIAGE'").run();
  assert.notEqual(h.row("SELECT body FROM documents WHERE body<>''")?.body, undefined);
  h.advance(7 * day + 1); h.store.maintain(h.settings, h.now());
  assert.equal(h.row("SELECT count(*) n FROM documents WHERE body<>''").n, 0);
  assert.equal(h.row('SELECT count(*) n FROM documents').n, 2);
  assert.equal(h.row('SELECT count(*) n FROM issues').n, 1);
  assert.equal(JSON.parse(h.row('SELECT payload FROM issues').payload).publication_state, 'DRAFT');
  h.advance(DRAFT_DAYS * day); h.store.maintain(h.settings, h.now());
  assert.equal(h.row('SELECT count(*) n FROM issues').n, 0);
  assert.equal(h.row('SELECT count(*) n FROM documents').n, 0);
  assert.equal(h.row('SELECT count(*) n FROM triages').n, 0);
});

test('a same-story update after the first original was deleted still verifies and keeps the draft ID', async t => {
  const h = harness(t); h.add(); const first = (await h.drain()).at(-1);
  assert.equal(h.row('SELECT body FROM documents').body, '');
  h.advance(60_000); h.add('https://news.publisher.co.kr/article/two');
  const update = (await h.drain()).at(-1);
  assert.equal(update.state, 'DRAFT_READY'); assert.equal(update.action, 'UPDATE'); assert.equal(update.issueId, first.issueId);
  assert.equal(h.row("SELECT count(*) n FROM documents WHERE body<>''").n, 0);
});

test('revocation still withdraws the draft immediately', async t => {
  const h = harness(t); h.add(); await h.drain();
  h.settings.sources[0].revokedAt = new Date(h.now()).toISOString();
  h.store.maintain(h.settings, h.now());
  assert.equal(JSON.parse(h.row('SELECT payload FROM issues').payload).state, 'HOLD_SOURCE_REVOKED');
});
