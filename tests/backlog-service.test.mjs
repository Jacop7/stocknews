import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { effectiveConfig } from '../workers/ai-processing/runtime/service.mjs';
import { serverConfig } from '../scripts/backlog-server-config.mjs';
import { buildCandidates, readCompanyHosts } from '../scripts/backlog-source-candidates.mjs';
import { config } from './backlog-fixtures.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('the service runs reads and model calls only when both the config and JUDOJU_AI_EXECUTE allow them', () => {
  const on = { ...config(), readOriginals: true, callModels: true };
  assert.deepEqual([effectiveConfig(on, false).readOriginals, effectiveConfig(on, false).callModels], [false, false]);
  assert.deepEqual([effectiveConfig(on, true).readOriginals, effectiveConfig(on, true).callModels], [true, true]);
  const off = { ...config(), readOriginals: false, callModels: false };
  assert.deepEqual([effectiveConfig(off, true).readOriginals, effectiveConfig(off, true).callModels], [false, false]);
});

test('the server config carries the catalog and only DISABLED official/report sources, with everything off', () => {
  const companies = readCompanyHosts('gaoncable.com\tpr,ir\t가온전선\niprovest.com\tir\t교보증권\n');
  const candidates = buildCandidates({ hostCounts: { 'reuters.com': { telegram: 9, web: 0 }, 'iprovest.com': { telegram: 4, web: 0 } },
    companies, excludedDomains: [] });
  const value = serverConfig({ example: read('../workers/ai-processing/runtime/config.example.json'),
    registry: read('./fixtures/catalog/registry-v1.json'), candidates });
  assert.equal(value.catalog.sectors.length, 56); assert.equal(value.catalog.entities.length, 339);
  assert.deepEqual(value.sources.map(source => [source.host, source.kind]).sort(),
    [['gaoncable.com', 'OFFICIAL'], ['iprovest.com', 'REPORT'], ['www.iprovest.com', 'REPORT']]);
  assert(value.sources.every(source => source.status === 'DISABLED'));
  assert.deepEqual([value.readOriginals, value.callModels, value.maxDailyCalls, value.newsAsSignalOnly], [false, false, 0, true]);
});
