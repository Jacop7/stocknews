import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTelegramPageWatch, openTelegramPageStore, renderTelegramLinks,
  runTelegramPageCycle, telegramPageLinks, telegramPageCandidates, telegramAuthorization,
  createTelegramTransport, telegramLinkExclusions, excludedTelegramLink, expireTelegramLinks, seedTelegramBaseline } from '../scripts/providers/telegram-link-worker.mjs';

const stamp = Date.parse('2026-11-21T00:00:00Z');
const minute = 60_000;
const id = 'E-fixture';
const channel = 'https://t.me/s/nhis_bio';
const link = 'https://publisher.co.kr/news/123?a=1&b=2';
const article = value => `<div class="tgme_widget_message" data-post="NHIS_BIO/123">
  <div class="tgme_widget_message_text">Unstored private fixture text
    <a href="${value.replaceAll('&', '&amp;')}">Publisher</a>
  </div></div>`;
const read = name => JSON.parse(readFileSync(new URL('../data/providers/' + name, import.meta.url), 'utf8'));

// Mocked pages carry post numbers; channels start from a recorded baseline (post 0) so newer posts are stored.
let postCounter = 0;
const posted = links => { const post = ++postCounter; return { valid: true, links, latestPost: post, linkPosts: Object.fromEntries(links.map(item => [item, post])) }; };
const seedAll = (db, config, at) => { for (const id of telegramPageCandidates(config, at).keys()) seedTelegramBaseline(db, config, id, 0, at); };

function fixture() {
  return {
    routes: [{ effective_kind: 'TELEGRAM', original_row: 41, endpoint_ids: [id] }],
    endpoints: [{
      endpoint_id: id, status: 'SHADOW', config_version: '1', max_rps: 0.1,
      url: channel, permission_profile_id: 'P-fixture', permission_profile_version: '1',
      enabled_scopes: ['MACHINE_ACCESS', 'DISCOVERY', 'LINK_EXTRACTION', 'STORAGE'],
    }],
    profiles: [{
      id: 'P-fixture', version: '1', endpoint_id: id, evidence: ['fixture'], status: 'VERIFIED',
      verified_at: '2026-11-20T00:00:00Z', expires_at: '2026-11-22T00:00:00Z',
      purposes: { MACHINE_ACCESS: 'ALLOW', DISCOVERY: 'ALLOW', LINK_EXTRACTION: 'ALLOW', STORAGE: 'ALLOW' },
      allowed_hosts: ['t.me'], methods: ['GET'], max_requests: 1, max_bytes: 16000, timeout_ms: 2000, retention_days: 1,
    }],
  };
}

test('extract HTTPS links inside matching public posts, without message text, dates, media or site navigation', () => {
  const html = article(link) + article(link + '&utm_source=telegram#other') +
    article('https://t.me/other/123') + article('https://127.0.0.1/news') +
    article('javascript:alert(1)') + article('https://person:secret@publisher.co.kr/') +
    article('https://other.co.kr/news').replace('NHIS_BIO/123', 'SomeOther/123') +
    '<a href="https://navigation.co.kr/">Outside posts</a>';
  assert.deepEqual(telegramPageLinks(html, channel), { valid: true, links: [link], latestPost: 123, linkPosts: { [link]: 123 } });
  assert.deepEqual(telegramPageLinks('<a href="https://publisher.co.kr/">Channel landing</a>', channel),
    { valid: false, links: [] });
  assert.deepEqual(telegramPageLinks(html, 'https://t.me/nhis_bio/123'), { valid: false, links: [] });
});

test('current production registry and the operator holds issue no web requests', async t => {
  const db = openTelegramPageStore(':memory:');
  t.after(() => db.close());
  const { routes, endpoints } = read('routes.json');
  const profiles = read('permission-profiles.json').profiles;
  const run = load => runTelegramPageCycle(db, { now: () => stamp, load, watch: () => assert.fail('Unexpected request') });
  const pending = new Set([16, 19, 32, 36, 43, 48]);
  const channels = routes.filter(item => item.effective_kind === 'TELEGRAM' && !pending.has(item.original_row));
  assert.equal(channels.length, 47);
  assert.ok(channels.some(route => route.original_row === 38));
  assert.ok(channels.some(route => route.original_row === 41));
  assert.deepEqual(await run(() => ({ routes, endpoints, profiles })), { status: 'RIGHTS_HOLD', links: 0 });
  for (const row of pending) {
    const config = fixture();
    config.routes[0].original_row = row;
    assert.equal((await run(() => config)).status, 'RIGHTS_HOLD');
  }
});

test('an authorized public page uses robots and persists only deduped clickable links', async t => {
  const db = openTelegramPageStore(':memory:');
  t.after(() => db.close());
  const seen = [];
  let now = stamp;
  const config = fixture();
  const watch = createTelegramPageWatch({ now: () => now, transport: async (url, limits) => {
    seen.push(url);
    assert.equal(limits.maxBytes, 16000);
    if (url.endsWith('/robots.txt')) return { status: 404 };
    assert.equal(url, channel);
    return { status: 200, contentType: 'text/html', body: Buffer.from(page) };
  } });
  const old = 'https://publisher.co.kr/news/old';
  const oldPost = article(old).replace('NHIS_BIO/123', 'NHIS_BIO/122');
  let page = oldPost;
  const run = () => runTelegramPageCycle(db, { now: () => now, load: () => config, watch });
  assert.deepEqual(await run(), { status: 'ROBOTS_READY', links: 0 });
  assert.deepEqual(await run(), { status: 'WAIT', links: 0 });
  now += minute;
  // Only posts published after the first visit are collected: the existing post sets the starting point.
  assert.deepEqual(await run(), { status: 'BASELINE_RECORDED', links: 0 });
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_page_links').get().n, 0);
  page = oldPost + article(link) + article(link);
  now += 11 * minute;
  assert.deepEqual(await run(), { status: 'LINKS_OBSERVED', links: 1 });
  assert.deepEqual(seen, ['https://t.me/robots.txt', channel, channel]);
  assert.deepEqual(db.prepare('SELECT url FROM telegram_page_links').all().map(row => row.url), [link]);
  const html = renderTelegramLinks(db, now);
  assert.match(html, /href="https:\/\/publisher\.co\.kr\/news\/123\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
  assert.ok(!html.includes('Unstored private fixture text'));
  assert.ok(!renderTelegramLinks(db, stamp + 1440 * minute).includes('<a href='));
  config.profiles[0].revoked_at = new Date(now).toISOString();
  assert.equal((await run()).status, 'RIGHTS_HOLD');
  assert.ok(!renderTelegramLinks(db, now).includes('<a href='));
});

test('a hold or redirect cannot become an external request, and in-flight revocation blocks storage', async t => {
  const db = openTelegramPageStore(':memory:');
  t.after(() => db.close());
  const config = fixture();
  let now = stamp;
  const watch = createTelegramPageWatch({ now: () => now, transport: async url => {
    if (url.endsWith('/robots.txt')) return { status: 404 };
    return { status: 302, location: link };
  } });
  const run = transport => runTelegramPageCycle(db, { now: () => now, load: () => config, watch: transport });
  assert.equal((await run(watch)).status, 'ROBOTS_READY');
  now += minute;
  assert.equal((await run(watch)).status, 'FAILED');
  now += 10 * minute;
  assert.equal((await run(async () => {
    config.profiles[0].revoked_at = new Date(now).toISOString();
    return { status: 'WATCH_INSPECTED', observation: { valid: true, links: [link] } };
  })).status, 'RIGHTS_HOLD');
  assert.ok(!renderTelegramLinks(db, now).includes('<a href='));
});

test('a verified profile cannot enable storage omitted by its Telegram endpoint', async t => {
  const db = openTelegramPageStore(':memory:');
  t.after(() => db.close());
  const config = fixture();
  config.endpoints[0].enabled_scopes.pop();
  const result = await runTelegramPageCycle(db, {
    now: () => stamp, load: () => config, watch: () => assert.fail('Missing endpoint scope'),
  });
  assert.deepEqual(result, { status: 'RIGHTS_HOLD', links: 0 });
});

test('the shared Telegram host waits for a Retry-After date across cycle restarts', async t => {
  const db = openTelegramPageStore(':memory:');
  t.after(() => db.close());
  const config = fixture();
  const retryAt = stamp + 59 * minute;
  let time = stamp; seedAll(db, config, stamp);
  const run = watch => runTelegramPageCycle(db, { now: () => time, load: () => config, watch });
  assert.equal((await run(() => ({
    status: 'FAILED', httpStatus: 429, retryAfter: new Date(retryAt).toUTCString(),
  }))).status, 'FAILED');
  time = retryAt - 1;
  assert.equal((await run(() => assert.fail('Retry-After still applies'))).status, 'WAIT');
  time = retryAt;
  assert.equal((await run(() => ({ status: 'WATCH_INSPECTED', observation: posted([link]) }))).links, 1);
});

function operatorFixture() {
  const config = fixture();
  const endpoint = config.endpoints[0];
  endpoint.status = 'RIGHTS_HOLD';
  endpoint.enabled_scopes = [];
  endpoint.telegram_link_collection = { mode: 'PUBLIC_EXTERNAL_LINKS_V1', endpoint_id: id,
    list_url: channel, authorization: telegramAuthorization, enabled_at: new Date(stamp).toISOString(), retention_days: 7 };
  config.profiles[0].status = 'UNVERIFIED';
  config.profiles[0].purposes = Object.fromEntries(Object.keys(config.profiles[0].purposes).map(key => [key, 'UNKNOWN']));
  return config;
}

test('operator URL-only opt-in is separate from publisher permission and remains exactly bound', () => {
  const config = operatorFixture();
  const before = JSON.stringify(config.profiles);
  assert.equal(telegramPageCandidates(config, stamp).size, 1);
  assert.equal(JSON.stringify(config.profiles), before);
  for (const mutate of [
    c => { c.endpoints[0].status = 'DISABLED'; },
    c => { c.endpoints[0].telegram_link_collection.list_url += 'x'; },
    c => { c.endpoints[0].telegram_link_collection.authorization = 'OTHER'; },
    c => { c.endpoints[0].telegram_link_collection.retention_days = 8; },
    c => { c.profiles[0].revoked_at = new Date(stamp).toISOString(); },
    c => { c.profiles[0].purposes.STORAGE = 'DENY'; },
    c => { c.profiles[0].version = 'changed'; },
    c => { c.routes[0].effective_kind = 'REPORT_BOT'; },
    c => { c.routes[0].original_row = 16; },
  ]) {
    const copy = JSON.parse(JSON.stringify(config)); mutate(copy);
    assert.equal(telegramPageCandidates(copy, stamp).size, 0);
  }
});

test('t.me transport pins only validated A records and bounds DNS time without changing the shared validator', async () => {
  const answers = [{ address: '149.154.167.99', family: 4 }];
  let requests = 0;
  const transport = createTelegramTransport({ lookupHost: async (host, options) => {
    assert.equal(host, 't.me'); assert.deepEqual(options, { all: true, family: 4 }); return answers;
  }, request: async (url, options) => {
    requests++; assert.equal(url, channel); assert.equal(options.resolvedAddresses, answers); return { status: 200 };
  } });
  assert.equal((await transport(channel, { timeoutMs: 100 })).status, 200);
  await assert.rejects(transport('https://publisher.co.kr/', { timeoutMs: 100 }), /UNSAFE_URL/);
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1']) {
    const reject = createTelegramTransport({ lookupHost: async () => [...answers, { address, family: 4 }], request: () => assert.fail('Private DNS') });
    await assert.rejects(reject(channel, { timeoutMs: 100 }), /NON_PUBLIC_DNS/);
  }
  const slow = createTelegramTransport({ lookupHost: () => new Promise(resolve => setTimeout(() => resolve(answers), 40)), request: () => assert.fail('Timed out DNS') });
  await assert.rejects(slow(channel, { timeoutMs: 5 }), /REQUEST_TIMEOUT/);
  assert.equal(requests, 1);
});

test('publisher exclusions are host boundaries; home references are exact URLs only', () => {
  const config = operatorFixture();
  const add = (row, url) => {
    config.routes.push({ original_row: row, endpoint_ids: ['e' + row] });
    config.endpoints.push({ endpoint_id: 'e' + row, status: 'DISABLED', url });
  };
  add(95, 'https://www.edaily.co.kr/articles/global/economy');
  add(89, 'https://www.moneytoring.ai/mv');
  const policy = telegramLinkExclusions(config);
  assert(excludedTelegramLink('https://m.edaily.co.kr/news/read?id=1', policy));
  assert(!excludedTelegramLink('https://edaily.co.kr.evil.co/news/1', policy));
  assert(excludedTelegramLink('https://www.moneytoring.ai/mv', policy));
  assert(!excludedTelegramLink('https://www.moneytoring.ai/mv/new', policy));
  assert(!excludedTelegramLink('https://naver.me/opaque', policy)); // Discovery only, never opened here.
  config.endpoints.at(-2).status = 'RIGHTS_HOLD';
  assert(!excludedTelegramLink('https://m.edaily.co.kr/news/read?id=1', telegramLinkExclusions(config)));
});

test('operator cycle reports PARTIAL, revalidates before requests and expires during config failures', async t => {
  const db = openTelegramPageStore(':memory:'); t.after(() => db.close());
  const config = operatorFixture(); let time = stamp, broken = false; seedAll(db, config, stamp);
  const load = () => { if (broken) throw new Error('Unreadable configuration'); return config; };
  const run = watch => runTelegramPageCycle(db, { load, now: () => time, watch });
  const many = Array.from({ length: 101 }, (_, index) => `https://publisher.co.kr/news/${index}`);
  assert.equal(telegramPageLinks(many.map(url => article(url)).join(''), channel).truncated, true);
  assert.deepEqual(await run(() => ({ status: 'WATCH_INSPECTED', httpStatus: 200,
    observation: posted(many) })), { status: 'PARTIAL', links: 100 });
  assert.equal(db.prepare('SELECT count(*) AS n FROM telegram_page_links').get().n, 100);
  assert.equal(db.prepare('SELECT status FROM telegram_page_diagnostics').get().status, 'PARTIAL');
  broken = true; time += minute;
  assert.equal((await run(() => assert.fail('Config unreadable'))).status, 'CONFIG_HOLD');
  assert.equal(db.prepare('SELECT count(*) AS n FROM telegram_page_links').get().n, 100);
  time = stamp + 7 * 1440 * minute;
  assert.equal((await run(() => assert.fail('Config unreadable'))).status, 'CONFIG_HOLD');
  assert.equal(db.prepare('SELECT count(*) AS n FROM telegram_page_links').get().n, 0);
  broken = false;
  assert.equal((await run(async (_endpoint, limits) => {
    config.endpoints[0].telegram_link_collection.enabled_at = '2026-11-20T00:00:00Z';
    assert.equal(limits.authorize(), false);
    return { status: 'WATCH_INSPECTED', observation: { valid: true, links: [link] } };
  })).status, 'RIGHTS_HOLD');
  expireTelegramLinks(db, time); // Same maintenance function used with collection flag OFF.
  assert.equal(db.prepare('SELECT count(*) AS n FROM telegram_page_links').get().n, 0);
});

test('changing one exclusion preserves unrelated links and other channels schedules', async t => {
  const db = openTelegramPageStore(':memory:'); t.after(() => db.close());
  const config = operatorFixture(); let time = stamp;
  const second = operatorFixture();
  second.endpoints[0].endpoint_id = 'second'; second.endpoints[0].permission_profile_id = 'second-profile';
  second.endpoints[0].telegram_link_collection.endpoint_id = 'second';
  second.profiles[0].id = 'second-profile'; second.profiles[0].endpoint_id = 'second';
  config.endpoints.push(second.endpoints[0]); config.profiles.push(second.profiles[0]);
  config.routes.push({ effective_kind: 'TELEGRAM', original_row: 42, endpoint_ids: ['second'] });
  const allowed = 'https://publisher.co.kr/allowed', excluded = 'https://m.edaily.co.kr/news/1';
  seedAll(db, config, time);
  const run = () => runTelegramPageCycle(db, { load: () => config, now: () => time,
    watch: () => ({ status: 'WATCH_INSPECTED', observation: posted([allowed, excluded]) }) });
  await run(); time += 5000; await run();
  const schedules = db.prepare('SELECT * FROM telegram_page_schedule ORDER BY endpoint_id').all();
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_page_links').get().n, 4);
  config.routes.push({ original_row: 95, endpoint_ids: ['excluded'] });
  config.endpoints.push({ endpoint_id: 'excluded', url: 'https://www.edaily.co.kr/articles/global/economy', status: 'DISABLED' });
  time += 5000; assert.equal((await run()).status, 'WAIT');
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_page_links').get().n, 2);
  assert(db.prepare('SELECT url FROM telegram_page_links').all().every(row => row.url === allowed));
  assert.deepEqual(db.prepare('SELECT * FROM telegram_page_schedule ORDER BY endpoint_id').all(), schedules);
  config.routes[1].effective_kind = 'REPORT';
  await run();
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_page_links').get().n, 1);
  assert.equal(db.prepare('SELECT endpoint_id FROM telegram_page_links').get().endpoint_id, id);
});

test('revocation during DNS blocks the actual HTTPS dispatch, including watcher context', async t => {
  let live = true, dispatched = 0;
  const transport = createTelegramTransport({ lookupHost: async () => {
    await Promise.resolve(); live = false; return [{ address: '149.154.167.99', family: 4 }];
  }, request: () => { dispatched++; assert.fail('Revoked while awaiting DNS'); } });
  const watch = createTelegramPageWatch({ transport });
  const result = await watch({ url: channel }, { authorize: () => live });
  assert.equal(result.status, 'WATCH_FAILED'); assert.equal(dispatched, 0);
  const db = openTelegramPageStore(':memory:'); t.after(() => db.close());
  const config = operatorFixture();
  const actualTransport = createTelegramTransport({ lookupHost: async () => {
    config.profiles[0].revoked_at = new Date(stamp).toISOString();
    return [{ address: '149.154.167.99', family: 4 }];
  }, request: () => assert.fail('Revoked DNS dispatched') });
  assert.equal((await runTelegramPageCycle(db, { load: () => config, now: () => stamp,
    watch: createTelegramPageWatch({ transport: actualTransport }) })).status, 'RIGHTS_HOLD');
});

test('the shared t.me slot adds the injected 0-3s jitter on top of its minimum gap', async t => {
  const db = openTelegramPageStore(':memory:');
  t.after(() => db.close());
  const config = fixture();
  const watch = createTelegramPageWatch({ now: () => stamp, transport: async () => ({ status: 404 }) });
  assert.equal((await runTelegramPageCycle(db, { now: () => stamp, load: () => config, watch, random: () => 0.5 })).status, 'ROBOTS_READY');
  // Fixture minimum is one minute (max_rps 0.1 is slower than the 60s floor): 60s + 1.5s.
  assert.equal(db.prepare('SELECT next_at FROM telegram_page_host').get().next_at, stamp + minute + 1500);
  await assert.rejects(runTelegramPageCycle(db, { now: () => stamp + 2 * minute, load: () => config, watch, random: () => 1 }), /INVALID_RANDOM/);
});

test('a page without a newer post writes no links and is revisited after 10, 20, then 30 minutes', async t => {
  const db = openTelegramPageStore(':memory:');
  t.after(() => db.close());
  const config = fixture();
  let now = stamp, page = article(link);
  const watch = createTelegramPageWatch({ now: () => now, transport: async url => url.endsWith('/robots.txt')
    ? { status: 404 } : { status: 200, contentType: 'text/html', body: Buffer.from(page) } });
  const run = () => runTelegramPageCycle(db, { now: () => now, load: () => config, watch });
  const next = () => db.prepare('SELECT next_at FROM telegram_page_schedule').get().next_at - now;
  const seen = () => db.prepare('SELECT last_seen FROM telegram_page_links').all().map(row => row.last_seen);
  assert.equal((await run()).status, 'ROBOTS_READY');
  now += minute;
  assert.deepEqual(await run(), { status: 'BASELINE_RECORDED', links: 0 });
  page = article(link).replace('NHIS_BIO/123', 'NHIS_BIO/123') + article('https://publisher.co.kr/news/first').replace('NHIS_BIO/123', 'NHIS_BIO/124');
  now += 11 * minute;
  assert.deepEqual(await run(), { status: 'LINKS_OBSERVED', links: 1 });
  assert.equal(next(), 10 * minute);
  const firstSeen = seen();
  for (const gap of [20, 30, 30]) {
    now += 31 * minute;
    assert.deepEqual(await run(), { status: 'NO_NEW_POSTS', links: 0 });
    assert.equal(next(), gap * minute);
    assert.deepEqual(seen(), firstSeen);
  }
  page += article('https://publisher.co.kr/news/456').replace('NHIS_BIO/123', 'NHIS_BIO/125');
  now += 31 * minute;
  assert.deepEqual(await run(), { status: 'LINKS_OBSERVED', links: 1 });
  assert.equal(next(), 10 * minute);
  assert.deepEqual({ ...db.prepare('SELECT latest_post, quiet_visits FROM telegram_page_activity').get() }, { latest_post: 125, quiet_visits: 0 });
  assert.deepEqual(db.prepare('SELECT url FROM telegram_page_links ORDER BY url').all().map(row => row.url),
    ['https://publisher.co.kr/news/456', 'https://publisher.co.kr/news/first']);
  // A binding change clears the remembered post, so the next visit is treated as new again.
  config.endpoints[0].config_version = '2';
  now += 31 * minute;
  await run();
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_page_activity WHERE binding LIKE ?').get('%"config_version":"1"%').n, 0);
});

test('without post numbers nothing is stored, and links beyond 100 are taken on the next visit', async t => {
  const db = openTelegramPageStore(':memory:');
  t.after(() => db.close());
  const config = operatorFixture(); let time = stamp; seedAll(db, config, stamp);
  const run = observation => runTelegramPageCycle(db, { load: () => config, now: () => time,
    watch: () => ({ status: 'WATCH_INSPECTED', httpStatus: 200, observation }) });
  assert.deepEqual(await run({ valid: true, links: [link] }), { status: 'PAGE_UNVERIFIED', links: 0 });
  assert.equal(db.prepare('SELECT count(*) n FROM telegram_page_links').get().n, 0);
  const links = Array.from({ length: 150 }, (_, index) => `https://publisher.co.kr/news/p${index + 1}`);
  const page = { valid: true, links: links.slice(0, 100), truncated: true, latestPost: 150,
    linkPosts: Object.fromEntries(links.map((item, index) => [item, index + 1])) };
  time += 11 * minute;
  assert.deepEqual(await run(page), { status: 'PARTIAL', links: 100 });
  assert.equal(db.prepare('SELECT latest_post FROM telegram_page_activity').get().latest_post, 100);
  time += 11 * minute;
  assert.deepEqual(await run(page), { status: 'PARTIAL', links: 50 });
  assert.equal(db.prepare('SELECT latest_post FROM telegram_page_activity').get().latest_post, 150);
  assert.equal(db.prepare('SELECT count(DISTINCT url) n FROM telegram_page_links').get().n, 150);
});
