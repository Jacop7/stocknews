import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPublicWatch } from '../scripts/providers/public-watch.mjs';
import { openCollectorStore, runCollectorCycle } from '../scripts/providers/html-worker.mjs';

const minute = 60_000;
const origin = 'https://publisher.example';
const endpoint = { endpoint_id: 'watch-1', config_version: '1', status: 'RIGHTS_HOLD', url: origin + '/market' };
const routes = [{ effective_kind: 'NEWS', endpoint_ids: [endpoint.endpoint_id] }];
const response = (body, contentType = 'text/html', status = 200) => ({ status, contentType, body: Buffer.from(body) });
const card = (title, url) => `<article><h2><a href="/${url}">${title}</a></h2></article>`;

test('only robots-authorized paths are fetched with an honest user agent and no redirect follow-up', async () => {
  const seen = [];
  const watch = createPublicWatch({ transport: async (url, options) => {
    seen.push(url);
    assert.match(options.userAgent, /^JudojuNewsMonitor\//);
    if (url.endsWith('/robots.txt')) return response('User-agent: *\nDisallow: /market\nAllow: /market/open\nCrawl-delay: 3', 'text/plain');
    return { ...response('', 'text/html', 302), location: origin + '/login?session=secret#fragment' };
  } });
  assert.equal((await watch(endpoint)).delayMs, 3000);
  assert.equal((await watch(endpoint)).status, 'ROBOTS_DENIED');
  const redirected = await watch({ ...endpoint, url: endpoint.url + '/open' });
  assert.equal(redirected.reason, 'REDIRECT_LIMIT');
  assert.equal(redirected.stage, 'PAGE');
  assert.equal(redirected.httpStatus, 302);
  assert.equal(redirected.redirectOrigin, origin);
  assert.ok(!JSON.stringify(redirected).includes('secret'));
  assert.deepEqual(seen, [origin + '/robots.txt', endpoint.url + '/open']);
});

test('a legacy byte in a robots comment does not block valid directives', async () => {
  const body = Buffer.concat([
    Buffer.from('User-agent: *\r\nDisallow: /market #'),
    Buffer.of(0xff),
    Buffer.from('\r\n'),
  ]);
  const requests = [];
  const watch = createPublicWatch({ transport: async url => {
    requests.push(url);
    return response(body, 'text/plain');
  } });
  assert.equal((await watch(endpoint)).status, 'ROBOTS_READY');
  assert.equal((await watch(endpoint)).reason, 'ROBOTS_RULE_DISALLOWED');
  assert.deepEqual(requests, [origin + '/robots.txt']);
});

test('invalid bytes in a robots directive keep the page on hold', async () => {
  const body = Buffer.concat([Buffer.from('User-agent: *\nDisallow: /'), Buffer.of(0xff)]);
  const watch = createPublicWatch({ transport: async url => {
    assert.equal(url, origin + '/robots.txt');
    return response(body, 'text/plain');
  } });
  const result = await watch(endpoint);
  assert.equal(result.stage, 'ROBOTS');
  assert.equal(result.reason, 'INVALID_UTF8');
  assert.equal(await watch.requiresRobots(endpoint), true);
});

test('declared Korean encoding enables watch-only recognition of Kyobo direct report links', async () => {
  const url = 'https://www.iprovest.com/weblogic/RSReportServlet?scr_id=34&mode=list&menuCode=3&pageNum=1';
  const detail = '/weblogic/RSReportServlet?scr_id=34&mode=detail&menuCode=3&sno=2053822';
  const body = Buffer.concat([
    Buffer.from(`<table><tr><td><a href="${detail}">`),
    Buffer.from([0xb0, 0xa1]),
    Buffer.from('</a></td></tr></table>'),
  ]);
  let html = body;
  let contentType = 'text/html;charset=EUC-KR';
  const requests = [];
  const watch = createPublicWatch({ transport: async requested => {
    requests.push(requested);
    return requested.endsWith('/robots.txt') ? response('', 'text/plain', 404) : response(html, contentType);
  } });
  const listing = { ...endpoint, url };
  assert.equal((await watch(listing)).status, 'ROBOTS_READY');
  const initial = await watch(listing);
  assert.equal(initial.status, 'WATCH_LIST_OK');
  assert.match(initial.digest, /^[a-f0-9]{64}$/);
  html = Buffer.concat([
    body,
    Buffer.from(`<a href="https://other.example${detail}">Outside</a>
      <a href="${detail}&sno=9">Duplicate ID</a>
      <a href="${detail.replace('mode=detail', 'mode=list')}">List</a>`),
  ]);
  assert.equal((await watch(listing)).digest, initial.digest);
  contentType = 'text/html;charset=UTF-8';
  assert.equal((await watch(listing)).reason, 'INVALID_UTF8');
  assert.deepEqual(requests, ['https://www.iprovest.com/robots.txt', url, url, url]);
});

test('worker observes unaffiliated public lists and stores only an operational fingerprint and times', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  let time = Date.parse('2026-11-20T00:00:00Z');
  let html = card('A', 'a') + card('B', 'b');
  const watch = createPublicWatch({ now: () => time, transport: async url => url.endsWith('/robots.txt') ?
    response('', 'text/plain', 404) : response(html) });
  const cycle = () => runCollectorCycle(db, { endpoints: [endpoint], routes, profiles: [], watch, now: () => time });
  assert.deepEqual(await cycle(), { registered: 1, eligible: 0, watchEligible: 1, requests: 1, observed: 0, watched: 0, changed: 0 });
  const robots = db.prepare('SELECT stage,http_status FROM watch_diagnostics').get();
  assert.deepEqual({ ...robots }, { stage: 'ROBOTS', http_status: 404 });
  time += minute;
  assert.deepEqual(await cycle(), { registered: 1, eligible: 0, watchEligible: 1, requests: 1, observed: 0, watched: 1, changed: 0 });
  time += 5 * minute;
  html = card('B', 'b') + card('A', 'a');
  assert.equal((await cycle()).changed, 0);
  time += 5 * minute;
  html = card('B 영업이익 증가', 'b');
  assert.equal((await cycle()).changed, 1);
  const operational = db.prepare('SELECT * FROM public_watch').get();
  assert.equal(operational.changed_at, time);
  assert.match(operational.digest, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(operational).includes('영업이익'));
  assert.equal(db.prepare('SELECT count(*) n FROM candidates').get().n, 0);
});

test('published registry queues public news and reports while keeping Telegram connectors separate', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const read = name => JSON.parse(readFileSync(new URL('../data/providers/' + name, import.meta.url), 'utf8'));
  const stats = await runCollectorCycle(db, { ...read('routes.json'), ...read('permission-profiles.json'),
    watch: async item => {
      assert.notEqual(new URL(item.url).hostname, 't.me');
      return { status: 'ROBOTS_READY', requests: 1 };
    } });
  assert.equal(stats.registered, 112);
  assert.equal(stats.watchEligible, 57);
  assert.equal(stats.eligible, 0);
  assert.equal(stats.requests, 8);
});

test('a grant denial for public machine access blocks even the robots request', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const held = { ...endpoint, permission_profile_id: 'fixture-denial' };
  const result = await runCollectorCycle(db, {
    endpoints: [held], routes,
    profiles: [{ id: 'fixture-denial', purposes: { MACHINE_ACCESS: 'DENY' } }],
    watch: () => assert.fail('unexpected public request'),
  });
  assert.equal(result.watchEligible, 0);
  assert.equal(result.requests, 0);
});

function granted() {
  const scopes = ['MACHINE_ACCESS', 'DISCOVERY', 'LINK_EXTRACTION', 'STORAGE'];
  const source = { ...endpoint, status: 'ACTIVE', permission_profile_id: 'profile', permission_profile_version: '1',
    adapter_version: 'html-list-v1', enabled_scopes: scopes, max_rps: 1 };
  const profile = { id: 'profile', endpoint_id: source.endpoint_id, version: '1', status: 'VERIFIED', evidence: ['fixture'],
    verified_at: '2026-11-19T00:00:00Z', expires_at: '2026-12-20T00:00:00Z',
    purposes: Object.fromEntries(scopes.map(scope => [scope, 'ALLOW'])), methods: ['GET'],
    allowed_hosts: [new URL(origin).hostname], max_bytes: 32768, timeout_ms: 1200, max_requests: 1, retention_days: 1 };
  return { source, profile };
}

test('an existing HTTP access hold survives a change from collection to public watch', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const { source, profile } = granted();
  let time = Date.parse('2026-11-20T00:00:00Z');
  const config = { endpoints: [source], routes, profiles: [profile], now: () => time,
    collect: async () => ({ status: 'FAILED', httpStatus: 403, requests: 1 }) };
  assert.equal((await runCollectorCycle(db, config)).requests, 1);
  profile.purposes.STORAGE = 'DENY';
  time += 10 * minute;
  const held = await runCollectorCycle(db, { ...config, watch: () => assert.fail('access hold lost') });
  assert.equal(held.watchEligible, 1);
  assert.equal(held.requests, 0);
});

test('public fallback inherits a verified host, spacing and response budget', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const { source, profile } = granted();
  source.max_rps = 0.001;
  profile.max_bytes = 64;
  profile.timeout_ms = 1000;
  profile.purposes.STORAGE = 'DENY';
  let time = Date.parse('2026-11-20T00:00:00Z');
  const config = { endpoints: [source], routes, profiles: [profile], now: () => time };
  const watch = createPublicWatch({ now: () => time, transport: async (url, limits) => {
    assert.equal(limits.maxBytes, 64);
    assert.equal(limits.timeoutMs, 1000);
    return url.endsWith('/robots.txt') ? response('', 'text/plain', 404) : response(card('A', 'a'));
  } });
  assert.equal((await runCollectorCycle(db, { ...config, watch })).requests, 1);
  time += 999_000;
  assert.equal((await runCollectorCycle(db, { ...config, watch })).requests, 0);
  time += 1000;
  assert.equal((await runCollectorCycle(db, { ...config, watch })).watched, 1);
});

test('daily recovery with stale robots rules holds across restarts instead of requesting robots repeatedly', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  const start = Date.parse('2026-11-20T00:00:00Z');
  let offset = 0;
  const now = () => start + offset * minute;
  const createWatch = () => createPublicWatch({ now, transport: async url => url.endsWith('/robots.txt') ?
    response('User-agent: *\nAllow: /', 'text/plain') : response('', 'text/html', 429) });
  let watch = createWatch();
  const cycle = () => runCollectorCycle(db, { endpoints: [endpoint], routes, profiles: [], watch, now });
  for (offset of [0, 1, 16, 31, 46]) assert.equal((await cycle()).requests, 1);
  offset = 24 * 60 + 46;
  watch = createWatch();
  assert.equal((await cycle()).requests, 0);
  offset += 15;
  assert.equal((await cycle()).requests, 0);
  offset += 24 * 60;
  assert.equal((await cycle()).requests, 0);
  assert.equal(db.prepare('SELECT status FROM schedules').get().status, 'WATCH_ROBOTS_FRESHNESS_HOLD');
});

test('worker holds a crawl delay that leaves too little freshness for its polling cadence', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  let time = Date.parse('2026-11-20T00:00:00Z');
  const watch = createPublicWatch({ now: () => time, transport: async url => {
    assert.equal(url, origin + '/robots.txt');
    return response('User-agent: *\nAllow: /\nCrawl-delay: 86399', 'text/plain');
  } });
  const cycle = () => runCollectorCycle(db, { endpoints: [endpoint], routes, profiles: [], watch, now: () => time });
  assert.equal((await cycle()).requests, 1);
  time += 2 * 24 * 60 * minute;
  assert.equal((await cycle()).requests, 0);
  assert.equal(db.prepare('SELECT status FROM schedules').get().status, 'ROBOTS_INTERVAL_CONFLICT');
});

test('larger pages are accepted only on the selected listings, within the source budget', async () => {
  const base = 'https://www.cnbc.com';
  const body = ' '.repeat(530_000) + card('News', 'article');
  const limits = [];
  const watch = createPublicWatch({ transport: async (url, options) => {
    limits.push(options.maxBytes);
    return url.endsWith('/robots.txt') ? response('', 'text/plain', 404) : response(body);
  } });
  const selected = { url: base + '/markets/' };
  assert.equal((await watch(selected)).status, 'ROBOTS_READY');
  assert.equal((await watch(selected)).status, 'WATCH_LIST_OK');
  assert.equal((await watch(selected, { maxBytes: 200_000 })).reason, 'RESPONSE_TOO_LARGE');
  assert.equal((await watch({ url: base + '/other/' })).reason, 'RESPONSE_TOO_LARGE');
  assert.deepEqual(limits, [524288, 2097152, 200000, 524288]);
});

test('title-only article reads keep the two MiB ceiling and the bounded longer transport deadline',async()=>{
  const calls=[];
  const watch=createPublicWatch({maxTimeoutMs:8000,transport:async(url,options)=>{
    calls.push([options.maxBytes,options.timeoutMs]);
    return url.endsWith('/robots.txt')?response('','text/plain',404):response(' '.repeat(600000)+card('Title','one'));
  }});
  const endpoint={url:'https://publisher.example/news/one'};
  await watch(endpoint);
  assert.equal((await watch(endpoint,{articleTitleOnly:true,maxBytes:2097152,timeoutMs:8000})).status,'WATCH_LIST_OK');
  assert.equal((await watch(endpoint,{articleTitleOnly:true,maxBytes:200000,timeoutMs:1000})).reason,'RESPONSE_TOO_LARGE');
  assert.deepEqual(calls,[[524288,4500],[2097152,8000],[200000,1000]]);
});

test('the worker records connection resets and pauses after three consecutive failures', async t => {
  const db = openCollectorStore(':memory:');
  t.after(() => db.close());
  let time = Date.parse('2026-11-20T00:00:00Z');
  const watch = createPublicWatch({ now: () => time, transport: async () => {
    throw Object.assign(new Error('Connection reset; example response withheld'), { code: 'ECONNRESET' });
  } });
  const cycle = () => runCollectorCycle(db, { endpoints: [endpoint], routes, profiles: [], watch, now: () => time });
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await cycle()).requests, 1);
    time += 15 * minute;
  }
  assert.equal((await cycle()).requests, 0);
  assert.equal(db.prepare('SELECT status FROM schedules').get().status, 'WATCH_CONNECTION_HOLD');
  assert.deepEqual({ ...db.prepare('SELECT stage,reason,connection_resets FROM watch_diagnostics').get() },
    { stage: 'ROBOTS', reason: 'CONNECTION_RESET', connection_resets: 3 });
});

test('certificate chain failures have a stable TLS code without exposing error details', async () => {
  for (const code of ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN']) {
    const watch = createPublicWatch({ transport: async () => {
      throw Object.assign(new Error('untrusted issuer detail'), { code });
    } });
    const result = await watch(endpoint);
    assert.equal(result.reason, 'TLS_FAILED');
    assert.ok(!JSON.stringify(result).includes('untrusted issuer detail'));
  }
});
