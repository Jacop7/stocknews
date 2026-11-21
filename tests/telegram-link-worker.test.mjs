import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTelegramPageWatch, openTelegramPageStore, renderTelegramLinks,
  runTelegramPageCycle, telegramPageLinks } from '../scripts/providers/telegram-link-worker.mjs';

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
  assert.deepEqual(telegramPageLinks(html, channel), { valid: true, links: [link] });
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
    return { status: 200, contentType: 'text/html', body: Buffer.from(article(link) + article(link)) };
  } });
  const run = () => runTelegramPageCycle(db, { now: () => now, load: () => config, watch });
  assert.deepEqual(await run(), { status: 'ROBOTS_READY', links: 0 });
  assert.deepEqual(await run(), { status: 'WAIT', links: 0 });
  now += minute;
  assert.deepEqual(await run(), { status: 'LINKS_OBSERVED', links: 1 });
  assert.deepEqual(seen, ['https://t.me/robots.txt', channel]);
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
  let time = stamp;
  const run = watch => runTelegramPageCycle(db, { now: () => time, load: () => config, watch });
  assert.equal((await run(() => ({
    status: 'FAILED', httpStatus: 429, retryAfter: new Date(retryAt).toUTCString(),
  }))).status, 'FAILED');
  time = retryAt - 1;
  assert.equal((await run(() => assert.fail('Retry-After still applies'))).status, 'WAIT');
  time = retryAt;
  assert.equal((await run(() => ({ status: 'WATCH_INSPECTED', observation: { valid: true, links: [link] } }))).links, 1);
});
