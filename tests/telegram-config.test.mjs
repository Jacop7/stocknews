import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { prepareTelegramConfig } from '../scripts/providers/telegram-config.mjs';
import { openTelegramPageStore, runTelegramPageCycle, telegramPageCandidates, telegramLinkExclusions } from '../scripts/providers/telegram-link-worker.mjs';

const registry = fileURLToPath(new URL('../data/providers/', import.meta.url));
const preparer = fileURLToPath(new URL('../../collector-first-live-source/prepare.mjs', import.meta.url));
const stamp = Date.parse('2026-11-21T00:00:00Z');

test('47 exact channels become eligible without changing 6 holds,37 web sources,20 exclusions or profiles', t => {
  const dir = mkdtempSync(join(tmpdir(), 'judoju-telegram-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prepared = spawnSync(process.execPath, [preparer, registry, dir], { encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr);
  const read = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const catalog = read(dir, 'routes.json'), profiles = read(dir, 'permission-profiles.json');
  const before = JSON.stringify({ catalog, profiles });
  const enabled = prepareTelegramConfig(catalog, profiles, read(registry, 'routes.json'), new Date(stamp).toISOString());
  assert.equal(JSON.stringify({ catalog, profiles }), before);
  const grants = telegramPageCandidates({ ...enabled, profiles: profiles.profiles }, stamp);
  const selected = enabled.routes.filter(route => route.endpoint_ids.some(id => grants.has(id)));
  assert.equal(grants.size, 47);
  assert.deepEqual(selected.map(route => route.original_row),
    catalog.routes.filter(route => route.effective_kind === 'TELEGRAM' && ![16,19,32,36,43,48].includes(route.original_row)).map(route => route.original_row));
  assert(selected.some(route => route.original_row === 38));
  assert(selected.some(route => route.original_row === 41));
  assert.deepEqual(telegramLinkExclusions(enabled).domains, ['benzinga.com','channelnewsasia.com','edaily.co.kr','ekn.kr',
    'fnnews.com','g-enews.com','hankyung.com','mbnmoney.mbn.co.kr','newspim.com','yna.co.kr']);
  assert.equal(telegramLinkExclusions(enabled).exact.length, 4);
  assert.equal(enabled.endpoints.filter(item => item.metadata_collection).length, 37);
  assert.equal(enabled.endpoints.filter(item => item.status === 'DISABLED').length, 20);
  assert.throws(() => prepareTelegramConfig(enabled, profiles, read(registry, 'routes.json'), new Date(stamp).toISOString()));
});

test('URL dedupe and global host Retry-After survive a real SQLite reopen', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'judoju-tg-restart-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prepared = spawnSync(process.execPath, [preparer, registry, dir], { encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr);
  const read = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const profiles = read('permission-profiles.json');
  const catalog = prepareTelegramConfig(read('routes.json'), profiles, JSON.parse(readFileSync(join(registry, 'routes.json'))), new Date(stamp).toISOString());
  const load = () => ({ ...catalog, profiles: profiles.profiles });
  const filename = join(dir, 'links.sqlite'); let db = openTelegramPageStore(filename), now = stamp;
  const cycle = watch => runTelegramPageCycle(db, { load, watch, now: () => now });
  const link = 'https://publisher.co.kr/news/one';
  try {
    assert.equal((await cycle(() => ({ status: 'WATCH_INSPECTED', httpStatus: 200,
      observation: { valid: true, links: [link, link] } }))).links, 1);
    now += 5000;
    await cycle(() => ({ status: 'WATCH_INSPECTED', httpStatus: 200, observation: { valid: true, links: [link] } }));
    assert.equal(db.prepare('SELECT count(*) n FROM telegram_page_links').get().n, 2); // Two source relations.
    assert.equal(db.prepare('SELECT count(DISTINCT url) n FROM telegram_page_links').get().n, 1);
    now += 5000;
    await cycle(() => ({ status: 'FAILED', httpStatus: 429, retryAfter: '3600' }));
    db.close(); db = openTelegramPageStore(filename);
    now += 3599_999;
    assert.equal((await cycle(() => assert.fail('Persisted host limit'))).status, 'WAIT');
    now++;
    let visited;
    assert.equal((await cycle(endpoint => { visited = endpoint.endpoint_id; return { status: 'WATCH_INSPECTED', observation: { valid: true, links: [link] } }; })).status, 'LINKS_OBSERVED');
    assert(visited);
  } finally { db.close(); }
});
