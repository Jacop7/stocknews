import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCandidates, classify, readCompanyHosts, summaryMarkdown } from '../scripts/backlog-source-candidates.mjs';
import { validateConfig } from '../workers/ai-processing/runtime/contracts.mjs';
import { config } from './backlog-fixtures.mjs';

const companies = readCompanyHosts('gaoncable.com\tpr,ir\t가온전선\niprovest.com\tir\t교보증권\nshinsegaegroupnewsroom.com\tpr\t신세계,신세계인터내셔날\n');
const excludedDomains = ['hankyung.com', 'edaily.co.kr'];

test('hosts are sorted into redirect, irrelevant, excluded, official, report and news', () => {
  const kind = host => { const result = classify(host, { companies, excludedDomains }); return result.kind ?? result.category; };
  assert.equal(kind('buly.kr'), 'REDIRECT');
  assert.equal(kind('news.google.com'), 'REDIRECT');
  assert.equal(kind('amazon.de'), 'IRRELEVANT');
  assert.equal(kind('www.youtube.com'), 'IRRELEVANT');
  assert.equal(kind('m.edaily.co.kr'), 'EXCLUDED');
  assert.equal(kind('www.gaoncable.com'), 'OFFICIAL');
  assert.equal(kind('dart.fss.or.kr'), 'OFFICIAL');
  assert.equal(kind('www.moef.go.kr'), 'OFFICIAL');
  // A broker's site is a research REPORT source even though the company sheet lists it as IR.
  assert.equal(kind('iprovest.com'), 'REPORT');
  assert.equal(kind('reuters.com'), 'NEWS');
});

test('every generated grant is DISABLED, claims no permission, has a www twin and passes the runtime contract', () => {
  const hostCounts = { 'reuters.com': { telegram: 72, web: 0 }, 'buly.kr': { telegram: 733, web: 0 }, 'gaoncable.com': { telegram: 0, web: 3 },
    'hankyung.com': { telegram: 0, web: 9 }, 'amazon.it': { telegram: 18, web: 0 } };
  const result = buildCandidates({ hostCounts, companies, excludedDomains });
  assert.deepEqual(result.groups.REDIRECT.map(item => item.host), ['buly.kr']);
  assert.deepEqual(result.groups.EXCLUDED.map(item => item.host), ['hankyung.com']);
  assert.deepEqual(result.groups.IRRELEVANT.map(item => item.host), ['amazon.it']);
  assert.deepEqual(result.groups.CANDIDATE.map(item => [item.host, item.kind, item.links]),
    [['reuters.com', 'NEWS', 72], ['gaoncable.com', 'OFFICIAL', 3], ['iprovest.com', 'REPORT', 0], ['shinsegaegroupnewsroom.com', 'OFFICIAL', 0]]);
  assert.equal(result.sources.length, 8);
  assert(result.sources.every(source => source.status === 'DISABLED' && source.publicationAuthorized === false &&
    source.provenanceVerified === false && source.evidence[0].startsWith('REVIEW_PENDING')));
  assert(result.sources.some(source => source.host === 'www.reuters.com'));
  assert.equal(result.sources.find(source => source.host === 'shinsegaegroupnewsroom.com').name, '신세계·신세계인터내셔날');
  assert.ok(validateConfig({ ...config(), sources: result.sources }));
  const summary = summaryMarkdown(result, '2026-11-26');
  assert.match(summary, /\| reuters\.com \| 72 \|/);
  assert.match(summary, /단축 주소/);
});
