import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openCollectorStore, runCollectorCycle } from '../scripts/providers/html-worker.mjs';
import { collectHtmlList, htmlListPurposes, htmlListVersion } from '../scripts/providers/html-list.mjs';

const start = Date.parse('2026-11-20T00:00:00Z');
const minute = 60_000;
const article = '<article><h2><a href="/articles/one">시장 기사</a></h2></article>';

function source(id = 'fixture-1', host = 'publisher.example') {
  const endpoint = {
    endpoint_id: id, url: `https://${host}/news/${id}`, status: 'ACTIVE',
    adapter_version: htmlListVersion, enabled_scopes: [...htmlListPurposes, 'STORAGE'],
    config_version: '1', permission_profile_id: `P-${id}`, permission_profile_version: '1', max_rps: 1,
  };
  const profile = {
    id: endpoint.permission_profile_id, version: '1', endpoint_id: id, status: 'VERIFIED', evidence: ['fixture'],
    verified_at: '2026-11-19T00:00:00Z', expires_at: '2027-01-01T00:00:00Z',
    purposes: Object.fromEntries(endpoint.enabled_scopes.map(purpose => [purpose, 'ALLOW'])),
    allowed_hosts: [host], methods: ['GET'], timeout_ms: 1000, max_bytes: 32768, max_requests: 1, retention_days: 1,
  };
  return { endpoint, profile };
}

function setup(t, sources) {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  let time = start;
  let status = 200;
  let retryAfter = '3600';
  let body = Buffer.from(article);
  return {
    db,
    clock(value) { time = value; },
    response(value, retry = '3600', content = Buffer.from(article)) { status = value; retryAfter = retry; body = content; },
    cycle() {
      return runCollectorCycle(db, {
        endpoints: sources.map(item => item.endpoint),
        profiles: sources.map(item => item.profile),
        now: () => time,
        collect: input => collectHtmlList({
          ...input, lookupHost: async () => [{ address: '93.184.215.14', family: 4 }],
          transport: async url => ({ status: typeof status === 'function' ? status(url) : status,
            contentType: 'text/html', body, retryAfter }),
        }),
      });
    },
  };
}

test('worker loads all registered sources with zero unauthorized requests', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const read = name => JSON.parse(readFileSync(new URL('../data/providers/' + name, import.meta.url), 'utf8'));
  const { endpoints } = read('routes.json');
  const { profiles } = read('permission-profiles.json');
  assert.deepEqual(await runCollectorCycle(db, { endpoints, profiles, now: () => start, collect: () => assert.fail() }),
    { registered: 112, eligible: 0, requests: 0, observed: 0 });
});

test('the web worker rejects Telegram channels and report bots even with HTML permissions', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const channels = [source('on-hold', 't.me'), source('bot'), source('unmapped', 'www.telegram.me')];
  const routes = [
    { effective_kind: 'TELEGRAM', original_row: 19, endpoint_ids: ['on-hold'] },
    { effective_kind: 'REPORT_BOT', original_row: 16, endpoint_ids: ['bot'] },
  ];
  assert.deepEqual(await runCollectorCycle(db, {
    endpoints: channels.map(item => item.endpoint), profiles: channels.map(item => item.profile), routes,
    now: () => start, collect: () => assert.fail('Telegram must not dispatch through the web worker'),
  }), { registered: 3, eligible: 0, requests: 0, observed: 0 });
});

test('worker sets an initial baseline, enforces due times, deduplicates articles, and removes revoked storage', async t => {
  const first = source();
  const run = setup(t, [first]);
  assert.deepEqual(await run.cycle(), { registered: 1, eligible: 1, requests: 1, observed: 0 });
  assert.equal((await run.cycle()).requests, 0);
  run.clock(start + 5 * minute);
  run.response(200, '3600', Buffer.from(article.replace('/one', '/two') + article));
  assert.deepEqual(await run.cycle(), { registered: 1, eligible: 1, requests: 1, observed: 1 });
  assert.deepEqual({ ...run.db.prepare('SELECT title,first_seen FROM candidates').get() }, { title: '시장 기사', first_seen: start + 5 * minute });
  run.clock(start + 10 * minute);
  assert.equal((await run.cycle()).observed, 0);
  assert.equal(run.db.prepare('SELECT count(*) AS n FROM candidates').get().n, 1);
  first.profile.purposes.STORAGE = 'DENY';
  assert.equal((await run.cycle()).eligible, 0);
  assert.equal(run.db.prepare('SELECT count(*) AS n FROM candidates').get().n, 0);
});

test('host cooldown honors Retry-After and an access denial suspends its route', async t => {
  const first = source();
  const second = source('fixture-2');
  const run = setup(t, [first, second]);
  run.response(429, '3600', Buffer.alloc(first.profile.max_bytes + 1));
  assert.equal((await run.cycle()).requests, 1);
  run.clock(start + 59 * minute);
  assert.equal((await run.cycle()).requests, 0);
  run.clock(start + 60 * minute);
  run.response(402);
  assert.equal((await run.cycle()).requests, 1);
  assert.equal(run.db.prepare('SELECT status FROM schedules WHERE endpoint_id=?').get(first.endpoint.endpoint_id).status, 'ACCESS_HOLD');
  run.clock(start + 120 * minute);
  run.response(200);
  assert.equal((await run.cycle()).requests, 1);
  assert.equal(run.db.prepare('SELECT count(*) n FROM host_rate_episodes').get().n, 0);
  run.clock(start + 121 * minute);
  assert.equal((await run.cycle()).requests, 0);
});

test('worker prioritizes unvisited sources when the per-cycle cap is reached', async t => {
  const run = setup(t, Array.from({ length: 9 }, (_, i) => source(`fixture-${i}`, `publisher-${i}.example`)));
  assert.equal((await run.cycle()).requests, 8);
  run.clock(start + 5 * minute);
  assert.equal((await run.cycle()).requests, 8);
  assert.ok(run.db.prepare('SELECT 1 FROM schedules WHERE endpoint_id=?').get('fixture-8'));
});

test('rate-limited hosts have at most three fast rechecks before daily cooldown', async t => {
  const run = setup(t, [source(), source('fixture-2')]);
  run.response(429, '0');
  for (const offset of [0, 15, 30, 45]) {
    run.clock(start + offset * minute);
    assert.equal((await run.cycle()).requests, 1);
  }
  for (const offset of [60, 120, 24 * 60 + 44]) {
    run.clock(start + offset * minute);
    assert.equal((await run.cycle()).requests, 0);
  }
  run.clock(start + (24 * 60 + 45) * minute);
  assert.equal((await run.cycle()).requests, 1);
});

test('daily probes for an unrecovered host stop after fourteen days', async t => {
  const run = setup(t, [source(), source('fixture-2'), source('fixture-3')]);
  run.response(429, '0');
  for (const offset of [0, 15, 30, 45]) {
    run.clock(start + offset * minute);
    assert.equal((await run.cycle()).requests, 1);
  }
  run.clock(start + 180 * minute);
  assert.equal((await run.cycle()).requests, 0);
  run.clock(start + (14 * 24 * 60 + 45) * minute);
  const stopped = await run.cycle();
  assert.equal(stopped.eligible, 3);
  assert.equal(stopped.requests, 0);
});

test('two spaced healthy results on the affected route resume normal scheduling', async t => {
  const run = setup(t, [source(), ...Array.from({ length: 22 }, (_, i) => source(`sibling-${i}`))]);
  run.response(429, '0');
  assert.equal((await run.cycle()).requests, 1);
  const recovered = [];
  run.response(url => { recovered.push(url); return 200; }, '0');
  for (const offset of [15, 30, 45]) {
    run.clock(start + offset * minute);
    assert.equal((await run.cycle()).requests, 1);
  }
  assert.equal(run.db.prepare('SELECT count(*) n FROM host_rate_episodes').get().n, 0);
  assert.ok(recovered.slice(0, 2).every(url => url.endsWith('/fixture-1')));
  assert.ok(recovered.at(-1).endsWith('/sibling-0'));
});

test('removing a route ends its recovery episode after the existing Retry-After deadline', async t => {
  const sources = [source(), source('fixture-2')];
  const run = setup(t, sources);
  run.response(429, '3600');
  assert.equal((await run.cycle()).requests, 1);
  sources.shift();
  run.response(200, '0');
  run.clock(start + 59 * minute);
  assert.equal((await run.cycle()).requests, 0);
  run.clock(start + 60 * minute);
  assert.equal((await run.cycle()).requests, 1);
  assert.equal(run.db.prepare('SELECT count(*) n FROM host_rate_episodes').get().n, 0);
});
