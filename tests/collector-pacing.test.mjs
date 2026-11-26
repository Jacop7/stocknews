import assert from 'node:assert/strict';
import { test } from 'node:test';
import { betweenRequests, hostGap, noJitter } from '../scripts/providers/pacing.mjs';
import { openCollectorStore, runCollectorCycle } from '../scripts/providers/html-worker.mjs';
import { collectHtmlList, htmlListPurposes, htmlListVersion } from '../scripts/providers/html-list.mjs';

const start = Date.parse('2026-11-20T00:00:00Z');
const article = '<article><h2><a href="/articles/one">시장 기사</a></h2></article>';

function source(id, host) {
  const endpoint = {
    endpoint_id: id, url: `https://${host}/news/${id}`, status: 'ACTIVE',
    adapter_version: htmlListVersion, enabled_scopes: [...htmlListPurposes, 'STORAGE'],
    config_version: '1', permission_profile_id: `P-${id}`, permission_profile_version: '1', max_rps: 0.2,
  };
  const profile = {
    id: endpoint.permission_profile_id, version: '1', endpoint_id: id, status: 'VERIFIED', evidence: ['fixture'],
    verified_at: '2026-11-19T00:00:00Z', expires_at: '2027-01-01T00:00:00Z',
    purposes: Object.fromEntries(endpoint.enabled_scopes.map(purpose => [purpose, 'ALLOW'])),
    allowed_hosts: [host], methods: ['GET'], timeout_ms: 1000, max_bytes: 32768, max_requests: 1, retention_days: 1,
  };
  return { endpoint, profile };
}

test('host gap adds 0-3s on top of the minimum and the cross-host pause stays within 1-3s', () => {
  assert.equal(hostGap(5000), 5000);
  assert.equal(hostGap(5000, noJitter), 5000);
  assert.equal(hostGap(5000, () => 0.5), 6500);
  assert.equal(hostGap(5000, () => 0.9999), 7999);
  assert.equal(betweenRequests(() => 0), 1000);
  assert.equal(betweenRequests(() => 0.9999), 2999);
  for (const bad of [() => 1, () => -0.1, () => NaN]) {
    assert.throws(() => hostGap(5000, bad), /INVALID_RANDOM/);
    assert.throws(() => betweenRequests(bad), /INVALID_RANDOM/);
  }
});

test('requests to different hosts are separated by one random pause taken before the next reservation', async t => {
  const db = openCollectorStore(':memory:'); t.after(() => db.close());
  const sources = [source('one', 'one.example'), source('two', 'two.example')];
  let time = start; const pauses = [], requests = [];
  const stats = await runCollectorCycle(db, {
    endpoints: sources.map(item => item.endpoint), profiles: sources.map(item => item.profile),
    now: () => time, random: () => 0.5,
    pause: async ms => { pauses.push(ms); time += ms; },
    collect: input => collectHtmlList({
      ...input, lookupHost: async () => [{ address: '93.184.215.14', family: 4 }],
      transport: async url => { requests.push([new URL(url).hostname, time]); return { status: 200, contentType: 'text/html', body: Buffer.from(article) }; },
    }),
  });
  assert.equal(stats.requests, 2);
  assert.deepEqual(pauses, [2000]);
  assert.equal(requests[1][1] - requests[0][1], 2000);
  // Each host slot is reserved when its own request starts: 5s minimum (max_rps 0.2) + 1.5s jitter.
  const slots = Object.fromEntries(db.prepare('SELECT host,next_at FROM hosts').all().map(row => [row.host, row.next_at]));
  assert.equal(slots['one.example'], start + 6500);
  assert.equal(slots['two.example'], start + 2000 + 6500);
});

test('without an injected random source and pause the cycle keeps its previous fixed spacing', async t => {
  const db = openCollectorStore(':memory:'); t.after(() => db.close());
  const sources = [source('one', 'one.example')];
  await runCollectorCycle(db, {
    endpoints: sources.map(item => item.endpoint), profiles: sources.map(item => item.profile), now: () => start,
    collect: input => collectHtmlList({ ...input, lookupHost: async () => [{ address: '93.184.215.14', family: 4 }],
      transport: async () => ({ status: 200, contentType: 'text/html', body: Buffer.from(article) }) }),
  });
  assert.equal(db.prepare('SELECT next_at FROM hosts').get().next_at, start + 5000);
});
