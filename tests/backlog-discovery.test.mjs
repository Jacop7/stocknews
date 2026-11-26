import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createBacklogProcessor } from '../workers/ai-processing/runtime/pipeline.mjs';
import { createOriginalReader } from '../workers/ai-processing/runtime/original.mjs';
import { readDiscoveryLeads, leadTtl, LEADS_VERSION } from '../workers/ai-processing/runtime/discovery.mjs';
import { readDiscoveryFile } from '../workers/ai-processing/runtime/cli.mjs';
import { digest } from '../workers/ai-processing/runtime/contracts.mjs';
import { stamp, url, config, triage, draft, verification, original, originalText } from './backlog-fixtures.mjs';

const providerSummary = 'PROVIDER SUMMARY MUST NOT BECOME EVIDENCE';
const hour = 3_600_000;
// Shape follows the TickerTick README example (stories[], time in milliseconds).
const tickertick = {
  last_id: '-1',
  stories: [
    { id: '1', title: '가상 오리온전자 설비투자 계획', url, site: 'news.publisher.co.kr', time: stamp - hour,
      favicon_url: 'https://static.tickertick.com/x.ico', description: providerSummary, tickers: ['orion'] },
    { id: '2', title: 'same story, tracking suffix', url: url + '#from-feed', time: stamp - hour },
    { id: '3', title: 'old story', url: 'https://news.publisher.co.kr/article/old', time: stamp - 4 * 24 * hour },
    { id: '4', title: 'future story', url: 'https://news.publisher.co.kr/article/future', time: stamp + hour },
    { id: '5', title: 'internal host', url: 'https://intranet.local/a', time: stamp - hour },
    { id: '6', title: 'no time', url: 'https://news.publisher.co.kr/article/untimed' },
    { id: '7', title: 'telegram', url: 'https://t.me/s/channel/1', time: stamp - hour },
  ],
};

test('TickerTick stories become bare FETCH leads: provider summaries are dropped and unsafe or stale items rejected', () => {
  const result = readDiscoveryLeads(tickertick, 'tickertick', stamp);
  assert.equal(result.provider, 'tickertick');
  assert.deepEqual(result.entries, [{ sourceId: 'discovery:tickertick', url, title: '가상 오리온전자 설비투자 계획',
    lastSeen: stamp, expiresAt: stamp + leadTtl }]);
  assert.deepEqual(result.reasons, { DUPLICATE_IN_RESPONSE: 1, STALE_LEAD: 1, PUBLISHED_IN_FUTURE: 1, UNSAFE_URL: 2, PUBLISHED_AT_REQUIRED: 1 });
  assert.equal(result.rejected, 6);
  assert(!JSON.stringify(result).includes(providerSummary));
  // The README also describes a bare array response.
  assert.equal(readDiscoveryLeads(tickertick.stories, 'tickertick', stamp).entries.length, 1);
});

test('provider-neutral lead files need the version, a safe provider name and ISO publish times', () => {
  const leads = { version: LEADS_VERSION, provider: 'finlight', items: [
    { url, title: '헤드라인', publishedAt: new Date(stamp - hour).toISOString(), summary: providerSummary },
    { url: 'https://news.publisher.co.kr/article/two', title: 'x', publishedAt: 'yesterday' },
  ] };
  const result = readDiscoveryLeads(leads, 'leads', stamp);
  assert.deepEqual(result.entries.map(entry => [entry.sourceId, entry.url]), [['discovery:finlight', url]]);
  assert.deepEqual(result.reasons, { PUBLISHED_AT_REQUIRED: 1 });
  assert(!JSON.stringify(result).includes(providerSummary));
  assert.throws(() => readDiscoveryLeads({ ...leads, version: 'OTHER' }, 'leads', stamp), /INVALID_DISCOVERY_RESPONSE/);
  assert.throws(() => readDiscoveryLeads({ ...leads, provider: '../x' }, 'leads', stamp), /INVALID_DISCOVERY_PROVIDER/);
  assert.throws(() => readDiscoveryLeads(leads, 'finlight', stamp), /INVALID_DISCOVERY_FORMAT/);
  assert.throws(() => readDiscoveryLeads({ stories: Array(1001).fill(tickertick.stories[0]) }, 'tickertick', stamp), /DISCOVERY_INPUT_LIMIT/);
});

test('saved discovery files are read from disk only and size-limited', t => {
  const folder = mkdtempSync(join(tmpdir(), 'discovery-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'feed.json'); writeFileSync(file, JSON.stringify(tickertick));
  assert.equal(readDiscoveryFile(file, 'tickertick', stamp).entries.length, 1);
  assert.throws(() => readDiscoveryFile(join(folder, 'missing.json'), 'tickertick', stamp), /DISCOVERY_FILE_NOT_FOUND/);
  const big = join(folder, 'big.json'); writeFileSync(big, ' '.repeat(5 * 1024 * 1024 + 1));
  assert.throws(() => readDiscoveryFile(big, 'tickertick', stamp), /DISCOVERY_INPUT_LIMIT/);
});

test('a discovered link to an unregistered host is never fetched', async t => {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  const settings = config(); const requests = [];
  const leads = readDiscoveryLeads({ stories: [{ id: '9', title: 'x', url: 'https://www.unregistered-news.com/a', time: stamp - hour }] }, 'tickertick', stamp);
  assert.equal(store.importLinks(leads.entries, stamp).added, 1);
  const read = createOriginalReader({ now: () => stamp, transport: async target => { requests.push(target); throw new Error('unexpected'); } });
  const processor = createBacklogProcessor({ store, loadConfig: () => settings, now: () => stamp, readOriginal: read,
    model: async () => { throw new Error('unexpected model call'); } });
  const result = await processor.step();
  assert.equal(result.state, 'HOLD_ORIGINAL'); assert.equal(result.reason, 'ORIGINAL_ACCESS_NOT_ENABLED');
  assert.equal(requests.length, 0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM documents').get().n, 0);
  assert.equal(digest(settings), digest(config()));
});

test('a discovered link to a granted host goes through the normal original read and the draft cites the original, not the feed', async t => {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  const settings = config(); const read = [], inputs = [];
  const leads = readDiscoveryLeads(tickertick, 'tickertick', stamp);
  store.importLinks(leads.entries, stamp);
  // The same URL also arrives from a saved channel: one job, two sightings.
  store.importLinks([{ url, sourceId: 'channel-one', lastSeen: stamp, expiresAt: stamp + 7 * 24 * hour }], stamp);
  assert.equal(store.db.prepare('SELECT count(*) n FROM jobs').get().n, 1);
  assert.deepEqual(store.db.prepare('SELECT source_id FROM sightings ORDER BY source_id').all().map(row => row.source_id), ['channel-one', 'discovery:tickertick']);
  const processor = createBacklogProcessor({ store, loadConfig: () => settings, now: () => stamp,
    readOriginal: async request => { read.push(request.url); return original(originalText, request.url); },
    model: async request => {
      inputs.push(JSON.stringify(request.input));
      if (request.stage === 'triage') return triage(request.input.document.id);
      if (request.stage === 'draft') return draft(request.input);
      return verification(request.input);
    } });
  const states = []; for (let index = 0; index < 4; index++) states.push((await processor.step()).state);
  assert.deepEqual(states, ['TRIAGE', 'DRAFT', 'VERIFY', 'DRAFT_READY']);
  assert.deepEqual(read, [url]);
  assert(inputs.every(input => !input.includes(providerSummary)));
  const saved = store.db.prepare('SELECT payload FROM issues').get().payload;
  assert(!saved.includes(providerSummary)); assert.equal(JSON.parse(saved).publication_state, 'DRAFT');
});
