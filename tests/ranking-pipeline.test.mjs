// Home ranking v2 R1 through the pipeline: the issue-level ranking record (grades + caps, evidence institutions,
// material change), the V14 prompt key, the cloud request unchanged, signal links per version and the read-only preview.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createBacklogProcessor } from '../workers/ai-processing/runtime/pipeline.mjs';
import { toIntakePayload } from '../workers/ai-processing/runtime/publish-map.mjs';
import { linkSignals, homePreview, previewCandidates, linkState, attentionDiagnostics } from '../workers/ai-processing/runtime/ranking.mjs';
import { rankingRecord } from '../workers/ai-processing/runtime/pipeline.mjs';
import { digest, validateConfig } from '../workers/ai-processing/runtime/contracts.mjs';
import { day } from '../workers/ai-processing/runtime/contracts.mjs';
import { stamp, url, config, triage, draft, verification, original, originalText } from './backlog-fixtures.mjs';

function harness(t, { filename = ':memory:', grades, support, originalOverride, settingsPatch, damageFor } = {}) {
  const store = new BacklogStore(filename); t.after(() => { try { store.close(); } catch {} });
  const settings = config(); settingsPatch?.(settings); let time = stamp; const requests = [];
  const model = async request => {
    requests.push(request);
    if (request.stage === 'triage') return triage(request.input.document.id, request.input.document.text.includes('추가 사업장'), damageFor?.(request.input.document.text) ?? false);
    if (request.stage === 'draft') { const d = draft(request.input, (request.input.impacts ?? request.input.triage.impacts).some(i => i.direction === 'DAMAGE')); if (grades) d.impact_grades = grades(request.input); return d; }
    const v = verification(request.input); if (support) v.gradeSupport = support; return v;
  };
  const processor = createBacklogProcessor({ store, loadConfig: () => settings, model, now: () => time,
    readOriginal: async request => originalOverride ? originalOverride(request) : original(originalText, request.url) });
  const add = (sourceUrl = url) => store.importLinks([{ url: sourceUrl, sourceId: 'channel-one', lastSeen: time, expiresAt: time + 7 * day }], time);
  const drain = async (count = 4) => { const out = []; for (let i = 0; i < count; i++) out.push(await processor.step()); return out; };
  return { store, settings, requests, add, drain, advance: v => { time += v; }, now: () => time };
}
const ranking = store => JSON.parse(store.db.prepare('SELECT ranking FROM issues').get().ranking);

test('a committed issue carries its assessment: news-only magnitude is capped, scope by structure, institutions per source', async t => {
  const h = harness(t); h.add(); const results = await h.drain();
  assert.equal(results.at(-1).state, 'DRAFT_READY');
  const r = ranking(h.store);
  assert.equal(r.policy, "HOME_V2_R1"); assert.equal(r.assessment.promptVersion, "V14"); assert.equal(r.assessmentError, null);
  assert.deepEqual(r.institutionBasis, { catalogVersion: "fixture-v1", configHash: r.assessment.configHash }); assert.ok(r.assessment.docIds.length === 1 && r.assessment.factIds.length === 1 && r.assessment.assessedAt === h.now());
  // Fixture grades 3/3/3/2 on a news source with one company in one sector.
  assert.deepEqual(Object.fromEntries(Object.entries(r.assessment.grades).map(([k, v]) => [k, v.grade])), { transmission: 3, scope: 1, magnitude: 2, durability: 2 });
  assert.deepEqual(r.assessment.caps.map(c => c.reason).sort(), ['NO_PRIMARY_SOURCE', 'SCOPE_STRUCTURE']);
  assert.equal(r.assessment.effectiveI, 24 + 4 + 10 + 6); assert.equal(r.assessment.band, 'STANDARD');
  assert.deepEqual(r.evidence.map(e => e.institution), [null], 'a NEWS source is no institution');
  assert.equal(r.materialChangeAt, h.now());
  // The writer's grades never enter the article.
  assert.equal('impact_grades' in JSON.parse(h.store.db.prepare('SELECT payload FROM issues').get().payload), false);
  // V14 prompt key: every model run key differs from the V13 key for the same input.
  assert.equal(h.requests.length, 3);
});

test('an official company source counts as an institution and lifts the magnitude cap', async t => {
  const h = harness(t, { settingsPatch: s => { s.sources[0].kind = 'OFFICIAL'; s.sources[0].name = '오리온전자'; } });
  h.add(); await h.drain();
  const r = ranking(h.store);
  assert.equal(r.assessment.grades.magnitude.grade, 3);
  assert.deepEqual(r.evidence.map(e => e.institution), ['company:orion']);
});

test('missing or invalid grades leave the issue without I but still commit the draft', async t => {
  const h = harness(t, { grades: () => ({ transmission: { grade: 9, factIds: [] }, scope: { grade: 0, factIds: [] }, magnitude: { grade: 0, factIds: [] }, durability: { grade: 0, factIds: [] } }) });
  h.add(); const results = await h.drain();
  assert.equal(results.at(-1).state, 'DRAFT_READY');
  const r = ranking(h.store); assert.equal(r.assessment, null); assert.equal(r.assessmentError, 'IMPACT_GRADE_INVALID'); assert.deepEqual(r.evidence, []);
});

test('verifier UNSUPPORTED lowers grades; material change moves with added facts and survives an operator re-export', async t => {
  const h = harness(t, { support: { transmission: 'UNSUPPORTED', scope: 'SUPPORTED', magnitude: 'SUPPORTED', durability: 'SUPPORTED' },
    originalOverride: request => original(originalText + (request.url.endsWith('two') ? ' 추가 사업장 검토가 공지됐다.' : ''), request.url) });
  h.add(); await h.drain();
  const first = ranking(h.store); assert.equal(first.assessment.grades.transmission.grade, 2);
  h.advance(60000); h.add('https://news.publisher.co.kr/article/two'); const update = (await h.drain()).at(-1);
  assert.equal(update.action, 'UPDATE'); assert.equal(ranking(h.store).materialChangeAt, stamp + 60000);
  h.advance(60000);
  const issueId = h.store.db.prepare('SELECT id FROM issues').get().id;
  const job = h.store.db.prepare("SELECT id FROM jobs WHERE state='DRAFT_READY' AND json_extract(payload,'$.version')=2").get();
  h.store.requeueForExport(job.id, h.now()); const re = (await h.drain(4)).find(x => x.state === "DRAFT_READY");
  assert.equal(re.state, 'DRAFT_READY'); assert.equal(re.issueId, issueId);
  assert.equal(ranking(h.store).materialChangeAt, stamp + 60000, 're-export keeps the time');
});

test('the export snapshot holds ranking at top level and the cloud request is byte-identical without it', async t => {
  const h = harness(t); h.add(); await h.drain();
  const snapshot = JSON.parse(h.store.db.prepare('SELECT payload FROM draft_exports').get().payload);
  assert.ok(snapshot.ranking?.assessment); assert.equal('ranking' in snapshot.draft, false);
  const { ranking: _r, ...without } = snapshot;
  assert.equal(JSON.stringify(toIntakePayload(snapshot)), JSON.stringify(toIntakePayload(without)));
  const request = JSON.parse(h.store.db.prepare("SELECT request FROM deliveries WHERE operation='SUBMIT'").get().request);
  assert.equal(JSON.stringify(request).includes('impact_grades') || JSON.stringify(request).includes('"ranking"'), false);
});

test('signal links: one per current version, rebuilt when the version changes, ambiguous companies not linked', async t => {
  const h = harness(t, { originalOverride: request => original(originalText + (request.url.endsWith('two') ? ' 추가 사업장 검토가 공지됐다.' : ''), request.url) });
  h.add(); await h.drain();
  h.store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://www.mk.co.kr/a', title: '오리온전자, 장비투자 확대', lastSeen: h.now(), expiresAt: h.now() + 7 * day },
    { sourceId: 'gnews:kr', url: 'https://www.hankyung.com/b', title: '다른 회사 소식', lastSeen: h.now(), expiresAt: h.now() + 7 * day }], h.now());
  assert.deepEqual(linkSignals(h.store.db, h.settings, h.now()), { candidates: 1, links: 1, ambiguous: 0 });
  h.advance(60000); h.add('https://news.publisher.co.kr/article/two'); await h.drain();
  linkSignals(h.store.db, h.settings, h.now());
  assert.deepEqual(h.store.db.prepare('SELECT issue_version v FROM signal_issue_links').all().map(r => r.v), [2], 'old version links removed');
  const preview = homePreview(h.store.db, h.now());
  assert.equal(preview.diagnostic, true); assert.equal(preview.ranked.length, 1);
  assert.equal(preview.ranked[0].news.state, 'LINKED'); assert.equal(preview.ranked[0].news.outlets24, 1);
  assert.equal(JSON.stringify(preview).includes('https://'), false, 'no URLs in the preview');
  // A second story with the same company makes the company ambiguous.
  const second = previewCandidates(h.store.db, h.now())[0];
  h.store.db.prepare("UPDATE issues SET story_key='other' WHERE id=?").run(second.id);
  h.store.db.prepare("INSERT INTO issues(id,story_key,angle_key,version,payload,fact_ids,created_at,updated_at,expires_at,ranking) SELECT 'copy','story-b',angle_key,version,payload,fact_ids,created_at,updated_at,expires_at,ranking FROM issues WHERE id=?").run(second.id);
  h.store.db.prepare("INSERT INTO draft_exports SELECT 'copy',version,state,payload,created_at,expires_at FROM draft_exports WHERE issue_id=? AND version=?").run(second.id, second.version);
  h.store.db.prepare("INSERT INTO jobs(id,url,state,next_at,payload,expires_at) VALUES ('jc','https://x.example/c','DRAFT_READY',0,?,?)").run(JSON.stringify({ issueId: 'copy', version: second.version }), h.now() + day);
  const again = linkSignals(h.store.db, h.settings, h.now());
  assert.equal(again.links, 0); assert.ok(again.ambiguous >= 1);
  assert.equal(homePreview(h.store.db, h.now()).ranked.every(r => r.news.state === 'UNLINKABLE'), true);
});

test('home-preview opens the database read-only and changes nothing', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hp-')), file = join(dir, 'p.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new BacklogStore(file); store.close();
  const before = statSync(file).mtimeMs;
  const r = spawnSync(process.execPath, ['--experimental-strip-types', 'workers/ai-processing/runtime/cli.mjs', 'home-preview', '--db', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1)); assert.equal(out.diagnostic, true); assert.deepEqual(out.ranked, []);
  assert.equal(statSync(file).mtimeMs, before);
});

test('the verifier receives the writer grades; the V13 cache key is not reused', async t => {
  const h = harness(t); h.add(); await h.drain();
  const verify = h.requests.find(r => r.stage === 'verify');
  assert.deepEqual(Object.keys(verify.input.impact_grades).sort(), ['durability', 'magnitude', 'scope', 'transmission']);
  const triageInput = h.requests.find(r => r.stage === 'triage').input;
  // Seed a completed triage run in a fresh database, keyed as the run identity would be under a given prompt version.
  const seeded = async prompt => {
    const g = harness(t); g.add();
    const key = digest({ stage: 'triage', model: g.settings.models.triage, input: triageInput, config: digest(validateConfig(g.settings)), prompt });
    g.store.db.prepare("INSERT INTO runs VALUES (?,?,?,?,'COMPLETE',?,?,?)").run(key, 'seed:triage', 'triage', g.settings.models.triage,
      JSON.stringify(triage(triageInput.document.id)), g.now(), g.now() + day);
    await g.drain(2); return g.requests.filter(r => r.stage === 'triage').length;
  };
  assert.equal(await seeded('BACKLOG_PROMPTS_V14'), 0, 'control: the V14 key is the run identity and is reused');
  assert.equal(await seeded('BACKLOG_PROMPTS_V13'), 1, 'a V13 result is not reused');
});

test('a job drafted before V14 (no impactGrades in VERIFY) commits without I', async t => {
  const h = harness(t); h.add();
  await h.drain(3); // FETCH → TRIAGE → DRAFT → now in VERIFY
  const job = h.store.db.prepare("SELECT id,payload FROM jobs WHERE state='VERIFY'").get();
  const payload = JSON.parse(job.payload); delete payload.impactGrades;
  h.store.db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(payload), job.id);
  const result = (await h.drain(2)).find(r => r.state === 'DRAFT_READY');
  assert.ok(result); const r = ranking(h.store);
  assert.equal(r.assessment, null); assert.equal(r.assessmentError, 'IMPACT_GRADE_INVALID');
  assert.equal(h.requests.find(x => x.stage === 'verify').input.impact_grades, null);
});

test('a direction change is a new angle row with its own start; legacy issues fall back to created_at without a write', async t => {
  const h = harness(t, { damageFor: text => text.includes('비용 부담'),
    originalOverride: request => original(originalText + (request.url.endsWith('cost') ? ' 원가 비용 부담이 공지됐다.' : ''), request.url) });
  const store = h.store;
  h.add(); await h.drain();
  const firstRow = store.db.prepare('SELECT id,ranking FROM issues').get();
  h.advance(120000); h.add('https://news.publisher.co.kr/article/cost'); const steps = await h.drain(); const angle = steps.find(r => r.state === 'DRAFT_READY'); assert.ok(angle, JSON.stringify(steps.map(r => [r.state, r.reason])));
  assert.equal(angle?.action, 'NEW_ANGLE');
  const rows = store.db.prepare('SELECT id,ranking FROM issues ORDER BY created_at').all();
  assert.equal(rows.length, 2);
  assert.equal(JSON.parse(rows.find(r => r.id === firstRow.id).ranking).materialChangeAt, stamp, 'existing row unchanged');
  assert.equal(JSON.parse(rows.find(r => r.id !== firstRow.id).ranking).materialChangeAt, stamp + 120000);
  store.db.prepare('DELETE FROM issues WHERE id<>?').run(firstRow.id);
  const before = store.db.prepare('SELECT id,ranking FROM issues').get();
  // Legacy: an issue row without a ranking record.
  store.db.prepare('UPDATE issues SET ranking=NULL WHERE id=?').run(before.id);
  const c = previewCandidates(store.db, h.now());
  assert.equal(c[0].legacyTime, true); assert.equal(c[0].changedAt, store.db.prepare('SELECT created_at FROM issues').get().created_at);
  assert.equal(store.db.prepare('SELECT ranking FROM issues WHERE id=?').get(before.id).ranking, null, 'preview writes nothing');
});

test('E after body purge uses the institutions stored at commit; uncited story documents do not count', async t => {
  const h = harness(t, { settingsPatch: s => { s.sources[0].kind = 'OFFICIAL'; s.sources[0].name = '오리온전자'; } });
  h.add(); await h.drain();
  for (const row of h.store.db.prepare('SELECT id FROM documents').all()) h.store.purgeBody(row.id);
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM documents WHERE title=''").get().n, 1);
  const c = previewCandidates(h.store.db, h.now());
  assert.deepEqual(c[0].institutions, ['company:orion']);
});

test('only documents cited by the graded facts are evidence; a second Story document that is not cited does not count', async t => {
  const h = harness(t, { settingsPatch: s => { s.sources[0].kind = 'OFFICIAL'; s.sources[0].name = '오리온전자'; },
    grades: input => { const one = input.facts.find(f => f.statement.includes('추가 사업장')) ?? input.facts[0]; const first = [one.id]; return { transmission: { grade: 3, factIds: first }, scope: { grade: 1, factIds: first }, magnitude: { grade: 2, factIds: first }, durability: { grade: 2, factIds: first } }; },
    originalOverride: request => original(originalText + (request.url.endsWith('two') ? ' 추가 사업장 검토가 공지됐다.' : ''), request.url) });
  h.add(); await h.drain(); h.advance(60000); h.add('https://news.publisher.co.kr/article/two'); await h.drain();
  const r = ranking(h.store);
  assert.equal(r.assessment.docIds.length, 2, 'the assessment saw both documents');
  const cited = new Set(r.evidence.map(e => e.docId)); assert.equal(cited.size, 1, 'only the cited one is evidence');
});

test('evidence: one document with two sources of different companies is two institutions; report sources are none', () => {
  const settings = config();
  settings.sources.push({ ...settings.sources[0], host: 'ir.nano.example.com', id: 'nano', name: '나노장비', kind: 'OFFICIAL' },
    { ...settings.sources[0], host: 'research.example.com', id: 'rep', name: '오리온전자', kind: 'REPORT' });
  settings.sources[0] = { ...settings.sources[0], kind: 'OFFICIAL', name: '오리온전자' };
  settings.catalog.entities.push({ id: 'nano', name: '나노장비' });
  const facts = [{ id: 'f1', refs: [{ docId: 'd1', quote: 'q' }] }];
  const documents = [{ id: 'd1', title: 't', sources: [{ url: 'https://news.publisher.co.kr/a', kind: 'OFFICIAL' }, { url: 'https://ir.nano.example.com/b', kind: 'OFFICIAL' }, { url: 'https://research.example.com/c', kind: 'REPORT' }] }];
  const grades = { transmission: { grade: 3, factIds: ['f1'] }, scope: { grade: 1, factIds: ['f1'] }, magnitude: { grade: 1, factIds: ['f1'] }, durability: { grade: 1, factIds: ['f1'] } };
  const support = { transmission: 'SUPPORTED', scope: 'SUPPORTED', magnitude: 'SUPPORTED', durability: 'SUPPORTED' };
  const r = rankingRecord({ grades, support, facts, documents, triage: { articleKind: 'SECTOR' }, draft: { impacts: [] }, config: settings, configHash: 'h', now: 1 });
  assert.deepEqual(r.evidence.map(e => e.institution), ['company:orion', 'company:nano', null]);
});

test('preview candidates: revoked or expired exports and versions without a DRAFT_READY job are not candidates', async t => {
  const h = harness(t); h.add(); await h.drain();
  assert.equal(previewCandidates(h.store.db, h.now()).length, 1);
  const { id } = h.store.db.prepare('SELECT id FROM issues').get();
  h.store.db.prepare("UPDATE draft_exports SET state='REVOKED' WHERE issue_id=?").run(id);
  assert.equal(previewCandidates(h.store.db, h.now()).length, 0, 'revoked');
  h.store.db.prepare("UPDATE draft_exports SET state='READY',expires_at=? WHERE issue_id=?").run(h.now() - 1, id);
  assert.equal(previewCandidates(h.store.db, h.now()).length, 0, 'expired');
  h.store.db.prepare('UPDATE draft_exports SET expires_at=? WHERE issue_id=?').run(h.now() + day, id);
  h.store.db.prepare("UPDATE jobs SET state='HOLD_EDITOR' WHERE state='DRAFT_READY'").run();
  assert.equal(previewCandidates(h.store.db, h.now()).length, 0, 'no DRAFT_READY job');
});

test('link state: MACRO and company-less SECTOR are UNLINKABLE; publisher aliases merge outlets', async t => {
  const c = (id, kind, companies, story = id) => ({ id, storyKey: story, articleKind: kind, companies });
  assert.equal(linkState(c('m', 'MACRO', ['a']), [c('m', 'MACRO', ['a'])], 0), 'UNLINKABLE');
  assert.equal(linkState(c('s', 'SECTOR', []), [c('s', 'SECTOR', [])], 0), 'UNLINKABLE');
  assert.equal(linkState(c('s', 'SECTOR', ['a']), [c('s', 'SECTOR', ['a'])], 0), 'ZERO');
  assert.equal(linkState(c('s', 'SECTOR', ['a']), [c('s', 'SECTOR', ['a'])], 2), 'LINKED');
  const h = harness(t); h.add(); await h.drain();
  h.store.recordNewsSignals(['www.anews.com', 'm.bnews.com'].map((host, i) => ({ sourceId: 'gnews:kr', url: 'https://' + host + '/' + i, title: '오리온전자 투자', lastSeen: h.now(), expiresAt: h.now() + day })), h.now());
  linkSignals(h.store.db, h.settings, h.now());
  const { id, version } = previewCandidates(h.store.db, h.now())[0];
  assert.equal(attentionDiagnostics(h.store.db, id, version, h.now()).outlets24, 2);
  assert.equal(attentionDiagnostics(h.store.db, id, version, h.now(), new Map([['bnews.com', 'anews.com']])).outlets24, 1);
});

test('news diagnostics: Telegram-only links are never linked, velocity needs three recent outlets, the time window holds', async t => {
  const h = harness(t); h.add(); await h.drain();
  const at = h.now();
  // A Telegram news link (channel source, no title) recorded through the jobs path.
  h.store.db.prepare("INSERT INTO news_signals(url,host,first_seen,last_seen,sources,expires_at) VALUES ('https://www.yna.co.kr/t','www.yna.co.kr',?,?,'[\"channel-a\"]',?)").run(at, at, at + day);
  // Outside the window (5 days after first evidence).
  h.store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://www.mk.co.kr/late', title: '오리온전자 소식', lastSeen: at + 5 * day, expiresAt: at + 6 * day }], at + 5 * day);
  assert.equal(linkSignals(h.store.db, h.settings, at + 5 * day).links, 0);
  h.store.recordNewsSignals(['a', 'b'].map(x => ({ sourceId: 'gnews:kr', url: `https://www.${x}news.com/1`, title: '오리온전자 투자', lastSeen: at, expiresAt: at + day })), at);
  linkSignals(h.store.db, h.settings, at);
  const p = homePreview(h.store.db, at).ranked[0].news;
  assert.equal(p.state, 'LINKED'); assert.equal(p.outlets24, 2); assert.equal(p.velocity, null, 'fewer than three recent outlets');
  assert.equal(p.foreign, true, '.com outlets outside the Korean list');
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM signal_issue_links WHERE signal_url LIKE '%yna%'").get().n, 0);
});

test('a link becomes stale when the company turns ambiguous and is removed with its diagnostics', async t => {
  const h = harness(t); h.add(); await h.drain();
  h.store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://www.mk.co.kr/a', title: '오리온전자, 장비투자 확대', lastSeen: h.now(), expiresAt: h.now() + 7 * day }], h.now());
  assert.equal(linkSignals(h.store.db, h.settings, h.now()).links, 1);
  const c = previewCandidates(h.store.db, h.now())[0];
  h.store.db.prepare("INSERT INTO issues(id,story_key,angle_key,version,payload,fact_ids,created_at,updated_at,expires_at,ranking) SELECT 'copy','story-b',angle_key,version,payload,fact_ids,created_at,updated_at,expires_at,ranking FROM issues WHERE id=?").run(c.id);
  h.store.db.prepare("INSERT INTO draft_exports SELECT 'copy',version,state,payload,created_at,expires_at FROM draft_exports WHERE issue_id=? AND version=?").run(c.id, c.version);
  h.store.db.prepare("INSERT INTO jobs(id,url,state,next_at,payload,expires_at) VALUES ('jc','https://x.example/c','DRAFT_READY',0,?,?)").run(JSON.stringify({ issueId: 'copy', version: c.version }), h.now() + day);
  assert.equal(linkSignals(h.store.db, h.settings, h.now()).links, 0);
  assert.equal(h.store.db.prepare('SELECT count(*) n FROM signal_issue_links').get().n, 0);
  const row = homePreview(h.store.db, h.now()).ranked.find(r => r.id === c.id);
  assert.equal(row.news.state, 'UNLINKABLE'); assert.equal(row.news.linked, 0);
});
