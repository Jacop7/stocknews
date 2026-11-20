import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parseSecSubmissions } from '../workers/collectors/src/adapters/sec-submissions.ts';

const cik = '0001045810';
const baseAccession = '0001045810-26-000075';
const amendment = '0000000000-26-000076';
const baseTime = '2026-08-26T20:30:15.000Z';
const amendmentTime = '2026-08-27T20:30:15Z';

const payload = (overrides = {}) => JSON.stringify({
  cik: 1045810,
  filings: {
    recent: {
      accessionNumber: [baseAccession, amendment, '0001045810-26-000077', baseAccession],
      form: ['10-Q', '10-Q/A', '4', '10-Q'],
      filingDate: ['2026-08-26', '2026-08-27', '2026-08-27', '2026-08-26'],
      acceptanceDateTime: [baseTime, amendmentTime, amendmentTime, baseTime],
      ...overrides,
    },
  },
});

test('selects relevant filings, deduplicates, orders, and builds official accession index URLs', () => {
  const filings = parseSecSubmissions(payload(), cik);
  assert.deepEqual(filings.map(filing => filing.accession), [amendment, baseAccession]);
  assert.deepEqual(filings[0], {
    accession: amendment, form: '10-Q/A', filedOn: '2026-08-27',
    acceptedAt: '2026-08-27T20:30:15.000Z', amendment: true,
    url: 'https://www.sec.gov/Archives/edgar/data/1045810/000000000026000076/0000000000-26-000076-index.html',
  });
  assert.equal(filings[1].amendment, false);
});

test('rejects mismatched issuers, damaged columns, invalid dates and conflicting accessions', () => {
  assert.throws(() => parseSecSubmissions(payload(), '0000001234'), /WRONG_COMPANY/);
  assert.throws(() => parseSecSubmissions(payload({ form: [] }), cik), /COLUMNS/);
  assert.throws(() => parseSecSubmissions(payload({
    filingDate: ['2026-02-30', '2026-08-27', '2026-08-27', '2026-08-26'],
  }), cik), /ROW_TIME/);
  assert.throws(() => parseSecSubmissions(payload({
    form: ['10-Q', '10-Q/A', '4', '8-K'],
  }), cik), /CONFLICTING_ACCESSION/);
  for (const [first, last] of [['4', '8-K'], ['8-K', '4']]) {
    assert.throws(() => parseSecSubmissions(payload({
      form: [first, '10-Q/A', '4', last],
    }), cik), /CONFLICTING_ACCESSION/);
  }
  assert.deepEqual(parseSecSubmissions(payload({ form: ['4', '4', '4', '4'] }), cik), []);
});

test('stdin command publishes metadata only and emits no partial data on invalid input', () => {
  const args = ['--experimental-strip-types', 'scripts/normalize-sec-submissions.mjs', cik];
  const good = spawnSync(process.execPath, args, { input: payload(), encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout), { source: 'SEC_EDGAR', cik, filings: parseSecSubmissions(payload(), cik) });
  const bad = spawnSync(process.execPath, args, { input: '{"private":"do-not-print"', encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.doesNotMatch(bad.stderr, /do-not-print/);
});
