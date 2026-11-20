import assert from 'node:assert/strict';
import {setImmediate, setTimeout} from 'node:timers/promises';
import test from 'node:test';
import {createPublicGateway} from '../scripts/public-read-gateway.mjs';
import {HOME_DATABASE_FLAGS} from '../workers/home-ranking/src/database-contracts.ts';

const cfg = {
  productId: 'judoju-news', environment: 'local', sampleKind: 'SYNTHETIC',
  bootstrapId: 'test-home-owned', apiUrl: 'http://127.0.0.1:62321', webOrigins: [],
};
const identity = {
  productId: cfg.productId, environment: cfg.environment, sampleKind: cfg.sampleKind,
  bootstrapId: cfg.bootstrapId, contract: 'M1',
};
const cutoff = '2026-11-20T08:00:00.000Z';
const previousCutoff = '2026-11-20T07:55:00.000Z';
const checkedAt = '2026-11-20T08:00:01.000Z';
const publishedAt = '2026-11-19T16:23:14.918265+00:00';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ref = n => ({issueId: uuid(n), articleVersionId: uuid(100 + n)});
const principal = {
  sessionUser: `h4_${uuid(500).replaceAll('-', '')}_read`, sessionUserOid: '1200',
  componentRole: 'home_v1_internal_reader', runId: uuid(500), resourceId: uuid(501),
};

function ranking(lanes = {A: [ref(2), ref(1)], B: [ref(3)], C: [ref(4)]}, overrides = {}) {
  return {
    ...HOME_DATABASE_FLAGS, principal, resourceId: principal.resourceId, namespaceId: uuid(502),
    backendGeneration: uuid(503), serverCheckedAt: checkedAt, operation: 'read_current_home',
    result: {
      state: 'FRESH', checkedAt, rankingCutoff: cutoff, snapshotId: uuid(504),
      sourceCutoff: cutoff, marketBasis: 'KR_COMBINED', targetKrTradingDay: '2026-11-20', lanes,
      ...overrides,
    },
  };
}

function article(issueId, overrides = {}) {
  const n = Number(issueId.slice(-4));
  return {
    issue_id: issueId, version_id: ref(n).articleVersionId, state: 'PUBLISHED', sample_kind: 'SYNTHETIC',
    title: `기사 ${n}`, summary: '근거를 확인한 공개 기사 요약', first_published_at: publishedAt,
    body: {hidden: 'MUST_NOT_LEAVE_GATEWAY'}, quote: 200, score: 91, views: 17, ...overrides,
  };
}

function empty(rankingCutoff = cutoff) {
  return {state: 'CALCULATING', ranking_cutoff: rankingCutoff, source_cutoff: null, lanes: {A: [], B: [], C: []}};
}

async function gateway(t, readHomeRanking, readArticle = article, onRequest) {
  const g = await createPublicGateway(cfg, {
    port: 0,
    readHomeRanking,
    transport: async (config, name, args, signal) => {
      if (name === 'm1_public_identity') return identity;
      if (name === 'm1_public_article') return readArticle(args.p_issue, signal);
      if (name === 'm1_public_articles') return [];
      assert.fail(`Unexpected RPC ${name}`);
    },
  });
  if (onRequest) g.server.on('request', onRequest);
  t.after(() => g.close());
  return `http://127.0.0.1:${g.port}`;
}

async function home(base) {
  const r = await fetch(base + '/v2/home');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const json = await r.json();
  assert.deepEqual(Object.keys(json).sort(), ['data', 'mode', 'productId']);
  assert.equal(json.productId, 'judoju-news');
  assert.equal(json.mode, 'LOCAL_SYNTHETIC');
  return json.data;
}

test('HTTP preserves rank order and exact public keys with at most four card RPCs in flight', async t => {
  const lanes = {A: [ref(6), ref(1)], B: [ref(5), ref(2)], C: [ref(4), ref(3), ref(7)]};
  const firstCard = Promise.withResolvers();
  const bothRequests = Promise.withResolvers();
  let requests = 0;
  let awaiting = 0;
  let peak = 0;
  let snapshots = 0;
  const base = await gateway(t, async () => {
    snapshots++;
    return ranking(lanes, {checkedAt: `2026-11-20T08:00:0${snapshots}.000Z`});
  }, async id => {
    awaiting++;
    peak = Math.max(peak, awaiting);
    firstCard.resolve();
    await bothRequests.promise;
    await setTimeout(12 - Number(id.slice(-2)));
    awaiting--;
    return article(id);
  }, () => { if (++requests === 2) bothRequests.resolve(); });
  const first = home(base);
  await firstCard.promise;
  const [data, joined] = await Promise.all([first, home(base)]);
  assert.deepEqual(joined, data);
  assert.equal(snapshots, 2);
  assert.equal(peak, 4);
  assert.deepEqual(data, {state: 'FRESH', ranking_cutoff: cutoff, source_cutoff: cutoff, lanes: {
    A: [6, 1].map(n => cardFor(n)), B: [5, 2].map(n => cardFor(n)), C: [4, 3, 7].map(n => cardFor(n)),
  }});
});

function cardFor(n) {
  return {issue_id: uuid(n), title: `기사 ${n}`, summary: '근거를 확인한 공개 기사 요약', first_published_at: publishedAt};
}

test('a stale version, correction, canonical alias, wrong sample kind or invalid card withholds the entire result', async t => {
  let overrides;
  const base = await gateway(t, async () => ranking(), async id => article(id, id === uuid(3) ? overrides : {}));
  for (const failure of [
    {version_id: uuid(999)}, {state: 'CORRECTION_PENDING'}, {state: 'WITHDRAWN'},
    {issue_id: uuid(99)}, {sample_kind: 'PERMITTED_REAL'}, {title: ' '},
    {first_published_at: 'yesterday'}, {first_published_at: '2026-02-31T12:00:00Z'},
    {first_published_at: '2026-11-19T24:00:00+00:00'},
  ]) {
    overrides = failure;
    assert.deepEqual(await home(base), empty());
  }
});

test('a changed market, snapshot, publication binding or rank order is withheld at recheck', async t => {
  let reads = 0;
  let next;
  const base = await gateway(t, async () => ++reads % 2 ? ranking() : next);
  for (const mismatch of [
    ranking(undefined, {marketBasis: 'FOREIGN_US'}),
    ranking(undefined, {snapshotId: uuid(999)}),
    ranking({A: [ref(1), ref(2)], B: [ref(3)], C: [ref(4)]}),
    ranking({A: [ref(2), {...ref(1), articleVersionId: uuid(999)}], B: [ref(3)], C: [ref(4)]}),
  ]) {
    next = mismatch;
    assert.deepEqual(await home(base), empty());
  }
  assert.equal(reads, 8);
});

test('delayed same-context results retain their snapshot time and malformed or calculating inputs make no card calls', async t => {
  let calls = 0;
  let snapshot = ranking({A: [], B: [], C: []}, {state: 'DELAYED', sourceCutoff: previousCutoff});
  const base = await gateway(t, async () => snapshot, () => { calls++; });
  assert.deepEqual(await home(base), {...empty(), state: 'DELAYED', source_cutoff: previousCutoff});
  snapshot = ranking({A: [], B: [], C: []}, {state: 'CALCULATING', sourceCutoff: null,
    marketBasis: null, targetKrTradingDay: null, snapshotId: null});
  assert.deepEqual(await home(base), empty());
  snapshot = ranking({A: [ref(1), ref(1)], B: [], C: []});
  assert.deepEqual(await home(base), empty(null));
  snapshot = ranking({A: [ref(1), ref(2), ref(3)], B: [], C: []});
  assert.deepEqual(await home(base), empty(null));
  assert.equal(calls, 0);
});

test('whole request deadline aborts card transport and does not overlap unsettled work', {timeout: 9500}, async t => {
  const held = Promise.withResolvers();
  const abortObserved = Promise.withResolvers();
  let rankingSignal;
  let reads = 0;
  let cards = 0;
  const base = await gateway(t, signal => {
    rankingSignal = signal;
    reads++;
    return ranking({A: [ref(1)], B: [], C: []});
  }, async (id, signal) => {
    if (++cards === 1) {
      signal.addEventListener('abort', () => abortObserved.resolve(), {once: true});
      await held.promise;
    }
    return article(id);
  });
  try {
    const start = performance.now();
    assert.deepEqual(await home(base), empty());
    assert.ok(performance.now() - start >= 5900);
    await abortObserved.promise;
    assert.equal(rankingSignal.aborted, true);
    assert.deepEqual(await home(base), empty());
    assert.equal(reads, 1);
    held.resolve();
    await setImmediate();
    assert.deepEqual((await home(base)).lanes.A, [cardFor(1)]);
    assert.equal(reads, 3);
    assert.equal(cards, 2);
  } finally {
    held.resolve();
  }
});

test('route defaults closed, refuses LAN and foreign configuration, and preserves existing reads', async t => {
  const base = await gateway(t);
  assert.equal((await fetch(base + '/v2/home')).status, 404);
  assert.equal((await fetch(base + '/articles')).status, 200);
  for (const [config, lan] of [[cfg, true], [{...cfg, apiUrl: 'https://example.invalid'}, false]]) {
    await assert.rejects(createPublicGateway(config, {lan, port: 0, readHomeRanking: () => ranking()}),
      /HOME_ROUTE_REQUIRES_LOCAL_SOURCE/);
  }
  const enabled = await gateway(t, () => ranking());
  assert.equal((await fetch(enabled + '/v2/home?version=1')).status, 404);
  assert.equal((await fetch(enabled + '/v2/home', {method: 'POST'})).status, 405);
  assert.equal((await fetch(enabled + '/v2/home', {headers: {Authorization: 'Bearer test-rejected'}})).status, 403);
});
