import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openCollectorStore, runCollectorCycle } from '../scripts/providers/html-worker.mjs';
import { htmlListPurposes, htmlListVersion } from '../scripts/providers/html-list.mjs';

const start = Date.parse('2026-11-20T00:00:00Z');
const minute = 60_000;
const origin = 'https://publisher.example';
const purposes = [...htmlListPurposes, 'STORAGE'];
const titleFor = name => '기사 ' + name;
const row = (key, date = null, title = titleFor(key)) =>
  ({ url: origin + '/articles/' + key, title, publishedAt: date });

function fixture(id = 'fixture') {
  return {
    endpoint: {
      endpoint_id: id, url: origin + '/news/' + id, status: 'ACTIVE',
      adapter_version: htmlListVersion, enabled_scopes: purposes,
      config_version: '1', permission_profile_id: 'P-' + id, permission_profile_version: '1', max_rps: 1,
    },
    profile: {
      id: 'P-' + id, version: '1', endpoint_id: id, status: 'VERIFIED', evidence: ['test fixture only'],
      verified_at: '2026-11-19T00:00:00Z', expires_at: '2026-11-27T00:00:00Z',
      purposes: Object.fromEntries(purposes.map(p => [p, 'ALLOW'])), allowed_hosts: [new URL(origin).hostname],
      methods: ['GET'], max_requests: 1, max_bytes: 8192, timeout_ms: 1000, retention_days: 2,
    },
  };
}

const run = (db, sources, time, entries, status = 'CANDIDATES') => runCollectorCycle(db, {
  endpoints: sources.map(source => source.endpoint), profiles: sources.map(source => source.profile),
  now: () => time,
  collect: async () => ({ requests: 1, status, candidates: entries }),
});
const jobCount = db => db.prepare('SELECT count(*) AS n FROM listing_analysis_outbox').get().n;
const completedAt = db => db.prepare('SELECT completed_at FROM listing_checkpoint').get()?.completed_at;
const timeString = value => new Date(value).toISOString();

test('baseline does not backfill and a restart preserves the article, checkpoint and initial job', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'judoju-listing-'));
  const path = join(folder, 'collection.sqlite');
  let db = openCollectorStore(path);
  t.after(() => {
    if (db) db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const source = fixture();
  const baseline = [row('old-1'), row('old-2')];
  assert.equal((await run(db, [source], start, baseline)).observed, 0);
  assert.equal(jobCount(db), 0);
  assert.equal(completedAt(db), start);
  const secondVisit = [row('new'), ...baseline];
  const later = start + 5 * minute;
  assert.equal((await run(db, [source], later, secondVisit)).observed, 1);
  db.close();
  db = openCollectorStore(path);
  assert.equal(completedAt(db), later);
  assert.equal((await run(db, [source], later + 5 * minute, secondVisit)).observed, 0);
  assert.equal(jobCount(db), 1);
  const fixed = [row('new', null, ' 수정한  기사 제목 '), ...baseline];
  await run(db, [source], later + 10 * minute, fixed);
  assert.deepEqual(db.prepare('SELECT revision,title FROM listing_analysis_outbox ORDER BY revision').all().map(x => [x.revision, x.title]),
    [[0, '기사 new'], [1, '수정한 기사 제목']]);
  await run(db, [source], later + 15 * minute, [row('new', null, '수정한 기사 제목'), ...baseline]);
  assert.equal(jobCount(db), 2);
});

test('a shared origin URL creates one initial job with a source observation per listing', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const first = fixture('morning');
  const second = fixture('market');
  const baseline = [row('old-1'), row('old-2')];
  await run(db, [first, second], start, baseline);
  await run(db, [first, second], start + minute, baseline);
  await run(db, [first, second], start + 5 * minute,
    [row('same?utm_source=morning', timeString(start + minute), titleFor('same')), ...baseline]);
  await run(db, [first, second], start + 6 * minute, [row('same'), ...baseline]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM candidates WHERE url=?').get(origin + '/articles/same').n, 2);
  assert.equal(jobCount(db), 1);
  const originalKey = db.prepare('SELECT job_key FROM listing_analysis_outbox').get().job_key;
  first.profile.purposes.STORAGE = 'DENY';
  await run(db, [first, second], start + 7 * minute, [row('same'), ...baseline]);
  assert.deepEqual({ ...db.prepare('SELECT job_key,endpoint_id,published_at FROM listing_analysis_outbox').get() },
    { job_key: originalKey, endpoint_id: second.endpoint.endpoint_id, published_at: null });
});

test('one revisit saves every new link in the head page, including a delayed listing', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  const baseline = [row('old-1'), row('old-2')];
  await run(db, [source], start, baseline);
  const entries = [row('new-1'), row('new-2'), ...baseline, row('late-3'), row('new-2?utm_source=duplicate')];
  assert.equal((await run(db, [source], start + 5 * minute, entries)).observed, 3);
  assert.equal(jobCount(db), 3);
  assert.equal((await run(db, [source], start + 10 * minute, entries)).observed, 0);
});

test('gaps preserve the old checkpoint and a validated head can resume with a recorded coverage gap', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  await run(db, [source], start, [row('old-1'), row('old-2')]);
  const fresh = row('first-new', timeString(start + minute));
  await run(db, [source], start + 5 * minute, [fresh, row('old-1')], 'PARTIAL');
  assert.equal(completedAt(db), start);
  assert.equal(jobCount(db), 0);
  await run(db, [source], start + 10 * minute, [row('unknown-date')]);
  assert.equal(completedAt(db), start);
  await run(db, [source], start + 15 * minute,
    [row('head-new', timeString(start + 12 * minute)), row('unknown-date'), row('first-new')]);
  assert.equal(completedAt(db), start + 15 * minute);
  const gap = db.prepare('SELECT from_at,until_at,reason FROM listing_gap_report').get();
  assert.deepEqual([gap.from_at, gap.until_at, gap.reason], [start, start + 15 * minute, 'HEAD_SCOPE_RESUMED']);
  assert.deepEqual(db.prepare('SELECT title FROM listing_analysis_outbox ORDER BY title').all().map(x => x.title),
    [titleFor('first-new'), titleFor('head-new')]);
  const initial = db.prepare('SELECT expires_at FROM listing_analysis_outbox WHERE title=?').get(titleFor('first-new'));
  assert.equal(initial.expires_at, start + 5 * minute + 2 * 1440 * minute);
  await run(db, [source], start + 20 * minute, [row('head-new', timeString(start + 12 * minute)), row('unknown-date')]);
  assert.equal(jobCount(db), 2);
  await run(db, [source], start + 25 * minute,
    [row('head-new', timeString(start + 12 * minute)), row('unknown-date', timeString(start + 18 * minute))]);
  assert.equal(jobCount(db), 3);
});

test('partial scans update evidence without letting overrepresented old URLs consume staging slots', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  const baseline = [row('old-1'), row('old-2')];
  await run(db, [source], start, baseline);
  const observedAt = start + minute;
  const bulk = Array.from({ length: 398 }, (_, index) => row('bulk-' + index, timeString(observedAt)));
  await run(db, [source], start + 5 * minute, [row('date-updated'), ...bulk], 'PARTIAL');
  await run(db, [source], start + 10 * minute, [
    row('date-updated', timeString(observedAt), '개정 기사'), row('last-slot', timeString(observedAt)),
  ], 'PARTIAL');
  assert.equal(db.prepare('SELECT count(*) AS n FROM listing_pending').get().n, 400);
  await run(db, [source], start + 15 * minute, [row('head', timeString(observedAt)), ...baseline]);
  assert.equal(jobCount(db), 401);
  assert.equal(db.prepare('SELECT title FROM listing_analysis_outbox WHERE url=?').get(row('date-updated').url).title, '개정 기사');
});

test('an acquisition revocation before settlement immediately removes all bound collector state', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  const baseline = [row('old-1'), row('old-2')];
  const update = [row('new'), ...baseline];
  await run(db, [source], start, baseline);
  await run(db, [source], start + 5 * minute, update);
  await runCollectorCycle(db, {
    endpoints: [source.endpoint], profiles: [source.profile], now: () => start + 10 * minute,
    collect: async () => {
      source.profile.purposes.STORAGE = 'DENY';
      return { requests: 1, status: 'CANDIDATES', candidates: update };
    },
  });
  for (const table of ['candidates', 'listing_analysis_outbox', 'listing_checkpoint', 'listing_seen', 'listing_pending']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  }
});

test('a continuously observed undated listing can collect at and beyond the earliest retention deadline', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  const archive = row('rotated', timeString(start - minute));
  const baseline = [row('old-1'), row('old-2'), archive];
  await run(db, [source], start, baseline);
  const current = baseline.slice(0, 2);
  await run(db, [source], start + 1440 * minute, current);
  assert.equal((await run(db, [source], start + 2 * 1440 * minute + 1, [row('new-undated'), ...current, archive])).observed, 1);
  assert.equal(jobCount(db), 1);
});

test('a still-authorized correction establishes continuity after its candidate expires', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  source.profile.retention_days = 1;
  const baseline = [row('old-1'), row('old-2')];
  await run(db, [source], start, baseline);
  await run(db, [source], start + 5 * minute, [row('article'), ...baseline]);
  await run(db, [source], start + 1000 * minute, [row('article', null, '수정 하나'), ...baseline]);
  await run(db, [source], start + 1450 * minute, [row('article', null, '수정 둘'), ...baseline]);
  await run(db, [source], start + 1455 * minute, [row('article', null, '수정 둘'), ...baseline]);
  assert.deepEqual(db.prepare('SELECT revision,title FROM listing_analysis_outbox ORDER BY revision').all().map(x => [x.revision, x.title]),
    [[1, '수정 하나'], [2, '수정 둘']]);
});

test('overflow and a later recovery keep separate gap records', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  const baseline = [row('old-1'), row('old-2')];
  await run(db, [source], start, baseline);
  for (let page = 1; page <= 5; page++) {
    const batch = Array.from({ length: 100 }, (_, index) => row(`p${page}-${index}`));
    await run(db, [source], start + page * 5 * minute, batch, 'PARTIAL');
  }
  await run(db, [source], start + 30 * minute, baseline);
  assert.equal(jobCount(db), 400);
  await run(db, [source], start + 35 * minute, baseline);
  for (const elapsed of [40, 45, 50]) await run(db, [source], start + elapsed * minute, [row('later-a'), row('later-b')]);
  const gaps = db.prepare('SELECT from_at,until_at,reason FROM listing_gap_report ORDER BY until_at').all();
  assert.deepEqual(gaps.map(g => [g.from_at, g.until_at, g.reason]), [
    [start, start + 30 * minute, 'STAGING_LIMIT_REACHED'],
    [start + 35 * minute, start + 50 * minute, 'HEAD_SCOPE_RESUMED'],
  ]);
});

test('an undated listing can re-establish a head after a loss without queuing unresolved old items', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  await run(db, [source], start, [row('old-1'), row('old-2')]);
  const head = [row('held-1'), row('held-2')];
  for (const clock of [5, 10, 15, 20]) await run(db, [source], start + clock * minute, head);
  assert.equal(jobCount(db), 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM listing_hold').get().n, 2);
  assert.equal(completedAt(db), start + 20 * minute);
  assert.equal((await run(db, [source], start + 25 * minute, [row('arrived-after-recovery'), ...head])).observed, 1);
});

test('a local outbox insert failure rolls back the new candidate and confirmation point', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const source = fixture();
  const baseline = [row('old-1'), row('old-2')];
  await run(db, [source], start, baseline);
  db.exec("CREATE TRIGGER test_fail BEFORE INSERT ON listing_analysis_outbox BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  const next = [row('new'), ...baseline];
  await assert.rejects(run(db, [source], start + 5 * minute, next), /test rollback/);
  assert.equal(completedAt(db), start);
  assert.equal(db.prepare('SELECT count(*) AS n FROM candidates').get().n, 0);
  db.exec('DROP TRIGGER test_fail;');
  await run(db, [source], start + 10 * minute, next);
  assert.equal(jobCount(db), 1);
  source.profile.purposes.STORAGE = 'DENY';
  assert.equal((await run(db, [source], start + 11 * minute, next)).eligible, 0);
  assert.equal(jobCount(db), 0);
  assert.equal(completedAt(db), undefined);
});
