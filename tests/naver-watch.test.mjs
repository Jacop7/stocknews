// Naver watchlist capture → OCR → sector moves (docs/sector-news-plan.md §3): the parser on the user's real screenshot
// OCR (identity from the verified stock master only, no wrong rows), merging, market state, the baseline file,
// sector averages and the upload payload (no company prices).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWatchlist, indexMaster, mergeRound, signOf, columns } from '../scripts/ops/naver-watch/parse.mjs';
import { marketState, sectorMoves, readBaseline, writeBaseline, runRound } from '../scripts/ops/naver-watch/round.mjs';
import { validateMoves, loadMarketData } from '../workers/ai-processing/runtime/market.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const masterText = read('data/stock-master.json'), membersText = read('data/sector-members.json');
const master = JSON.parse(masterText), members = JSON.parse(membersText), index = indexMaster(master);
const ocr = JSON.parse(read('tests/fixtures/naver-watch/ocr-sample.json'));
const id = name => master.companies.find(c => c.name === name).companyId;
const T = Date.parse('2026-11-28T02:00:00Z');

test('the real screenshot: all nine rows exact, identity from the master, no wrong row', () => {
  const r = parseWatchlist(ocr, index);
  const got = Object.fromEntries(r.rows.map(x => [master.companies.find(c => c.companyId === x.companyId).name, [x.price, x.change, x.pct]]));
  assert.deepEqual(got, { 클로봇: [23650, 5440, 29.87], 태성: [51900, 7900, 17.95], 키움증권: [238500, 34500, 16.91], 큐리옥스바이오시스템즈: [47350, 6800, 16.77],
    현대무벡스: [19180, 2560, 15.4], 토모큐브: [23400, 3000, 14.71], 한국금융지주: [144000, 18000, 14.29], 피에스케이홀딩스: [133600, 16400, 13.99], 한화시스템: [55600, 6550, 13.35] });
  assert.deepEqual(r.dropped, []);
});

test('doubtful rows are dropped: code not in the master, name/code conflict, % mismatch or unreadable, mixed sign; header required', () => {
  const clone = () => JSON.parse(JSON.stringify(ocr));
  const byText = (o, text) => o.words.find(w => w.text === text);
  let o = clone(); byText(o, '466100').text = '999999';
  assert.ok(parseWatchlist(o, index).dropped.some(d => d.reason === 'CODE_NOT_IN_MASTER'));
  o = clone(); byText(o, '466100').text = '323280'; // 클로봇's row now carries 태성's code
  const conflict = parseWatchlist(o, index); assert.ok(conflict.dropped.some(d => d.reason === 'NAME_CODE_CONFLICT'));
  assert.ok(!conflict.rows.some(r => r.companyId === id('클로봇') && r.price !== 23650));
  o = clone(); byText(o, '(+29.870%)').text = '(+27.10%)';
  assert.ok(parseWatchlist(o, index).dropped.some(d => d.reason === 'PCT_MISMATCH' && d.companyId === id('클로봇')));
  o = clone(); byText(o, '(+29.870%)').text = '(+)';
  assert.ok(parseWatchlist(o, index).dropped.some(d => d.reason === 'PCT_UNREADABLE'));
  o = clone(); byText(o, '(+29.870%)').color = [40, 80, 230];
  assert.ok(parseWatchlist(o, index).dropped.some(d => d.reason === 'SIGN_UNREADABLE'));
  o = clone(); byText(o, '현재가').text = '현 재';
  assert.equal(parseWatchlist(o, index).ok, false);
  assert.equal(signOf([241, 108, 105]), 1); assert.equal(signOf([40, 80, 230]), -1); assert.equal(signOf([90, 90, 90]), 0); assert.equal(signOf([200, 160, 60]), null);
  assert.ok(columns(ocr.words));
});

test('merge: the same company on two screenshots must agree', () => {
  const a = { rows: [{ companyId: 'x', price: 10, change: 1, pct: 11.11 }] };
  assert.equal(mergeRound([a, a]).rows.length, 1);
  assert.deepEqual(mergeRound([a, { rows: [{ companyId: 'x', price: 11, change: 1, pct: 10 }] }]), { rows: [], conflicts: ['x'] });
});

test('market state: first run baseline, same day unchanged closed, new day 95% same closed, too few common unknown', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ companyId: 'c' + i, price: 100 + i }));
  const prices = Object.fromEntries(rows.map(r => [r.companyId, r.price]));
  assert.equal(marketState(null, rows, 10, T), 'BASELINE');
  assert.equal(marketState({ kstDate: '2026-11-28', prices }, rows, 10, T), 'CLOSED');
  assert.equal(marketState({ kstDate: '2026-11-28', prices }, rows.map((r, i) => i ? r : { ...r, price: 1 }), 10, T), 'OPEN');
  assert.equal(marketState({ kstDate: '2026-11-27', prices }, rows, 10, T), 'CLOSED', 'holiday morning: unchanged since the last session');
  assert.equal(marketState({ kstDate: '2026-11-27', prices }, rows.map((r, i) => i < 2 ? { ...r, price: 1 } : r), 10, T), 'OPEN');
  assert.equal(marketState({ kstDate: '2026-11-28', prices: { c0: 100 } }, rows, 10, T), 'UNKNOWN');
});

test('sector averages: equal weight, 70% and min(3,N) coverage, otherwise null; no company values', () => {
  const s = { sectors: [{ sectorId: 'a', companyIds: ['1', '2', '3', '4'] }, { sectorId: 'b', companyIds: ['5'] }, { sectorId: 'c', companyIds: ['6', '7', '8'] }] };
  const out = sectorMoves([{ companyId: '1', pct: 2 }, { companyId: '2', pct: 4 }, { companyId: '3', pct: -3 }, { companyId: '5', pct: 1 }, { companyId: '6', pct: 5 }, { companyId: '7', pct: 5 }], s);
  assert.deepEqual(out, [{ sectorId: 'a', avgPct: 1, read: 3, members: 4 }, { sectorId: 'b', avgPct: 1, read: 1, members: 1 }, { sectorId: 'c', avgPct: null, read: 2, members: 3 }]);
});

test('baseline file: one regular file, atomic write, damaged → removed, expired → removed, folder → refused', t => {
  const dir = mkdtempSync(join(tmpdir(), 'nw-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'state', 'last-round.json'), now = Date.now();
  assert.equal(readBaseline(file, master, now).state, 'ABSENT');
  writeBaseline(file, [{ companyId: id('클로봇'), price: 23650 }], now);
  writeFileSync(file + '.tmp-999', '{}'); // left by a crash
  assert.equal(readBaseline(file, master, now).state, 'OK');
  assert.deepEqual(require_dir(join(dir, 'state')), ['last-round.json'], 'no temporary file left');
  writeFileSync(file, '{"kstDate":"2026-11-28","prices":{'); assert.equal(readBaseline(file, master, now).state, 'DAMAGED'); assert.equal(existsSync(file), false);
  writeFileSync(file, JSON.stringify({ kstDate: '2026-11-28', prices: { unknown: 5 } })); assert.equal(readBaseline(file, master, now).state, 'DAMAGED');
  writeFileSync(file, JSON.stringify({ kstDate: '2026-11-28', prices: { [id('클로봇')]: 0 } })); assert.equal(readBaseline(file, master, now).state, 'DAMAGED');
  writeBaseline(file, [], now); const old = new Date(now - 8 * 86400000); utimesSync(file, old, old);
  assert.equal(readBaseline(file, master, now).state, 'EXPIRED'); assert.equal(existsSync(file), false);
  mkdirSync(file); assert.equal(readBaseline(file, master, now).state, 'NOT_FILE'); assert.equal(existsSync(file), true, 'a folder is not removed');
});
import { readdirSync } from 'node:fs';
function require_dir(p) { return readdirSync(p); }

test('a full round: OPEN → the upload passes the server checks and carries no company price', () => {
  const rows = master.companies.map(c => ({ companyId: c.companyId, price: 1010, change: 10, pct: 0.99 }));
  const baseline = { kstDate: '2026-11-28', prices: Object.fromEntries(master.companies.map(c => [c.companyId, 1000])) };
  const started = Date.parse('2026-11-28T01:00:00Z'), finished = started + 90_000;
  const r = runRound({ ocrPages: [{ list: '1', page: 1, ocr: {} }], expected: { 1: 339 }, master, members, membersText, masterText, baseline,
    startedAt: started, finishedAt: finished, parse: () => ({ ok: true, rows, dropped: [] }) });
  assert.equal(r.state, 'OPEN'); assert.equal(r.reason, null);
  const text = JSON.stringify(r.upload);
  assert.equal(validateMoves(text, loadMarketData(membersText, masterText), finished + 5000, finished + 10000).ok, true);
  assert.ok(!text.includes('1010') && !text.includes('"price"') && !text.includes(master.companies[0].companyId), 'no company values in the upload');
  const closed = runRound({ ocrPages: [{ list: '1', page: 1, ocr: {} }], expected: {}, master, members, membersText, masterText,
    baseline: { kstDate: '2026-11-28', prices: Object.fromEntries(rows.map(x => [x.companyId, x.price])) }, startedAt: started, finishedAt: finished, parse: () => ({ ok: true, rows, dropped: [] }) });
  assert.equal(closed.upload, null); assert.equal(closed.reason, 'MARKET_CLOSED');
});

test('a round with the real screenshot only: too little coverage, nothing uploaded, baseline rows available', () => {
  const started = Date.parse('2026-11-28T01:00:00Z');
  const r = runRound({ ocrPages: [{ list: '3', page: 1, ocr }], expected: {}, master, members, membersText, masterText, baseline: null, startedAt: started, finishedAt: started + 30_000 });
  assert.equal(r.upload, null); assert.equal(r.state, 'BASELINE'); assert.equal(r.rows.length, 9);
  const long = runRound({ ocrPages: [{ list: '3', page: 1, ocr }], expected: {}, master, members, membersText, masterText, baseline: { kstDate: '2026-11-28', prices: {} }, startedAt: started, finishedAt: started + 200_000 });
  assert.equal(long.upload, null);
  const incomplete = runRound({ ocrPages: [{ list: '3', page: 1, ocr }], expected: { 3: 100 }, master, members, membersText, masterText, baseline: null, startedAt: started, finishedAt: started + 30_000 });
  assert.equal(incomplete.reason, 'LIST_INCOMPLETE');
});

test('only a complete, valid round may become the baseline; reconciliation lists missing and repeated companies', async () => {
  const { reconcile } = await import('../scripts/ops/naver-watch/round.mjs');
  const started = Date.parse('2026-11-28T01:00:00Z');
  const all = master.companies.map(c => ({ companyId: c.companyId, price: 1000, change: 0, pct: 0 }));
  const run = (rows, extra = {}) => runRound({ ocrPages: [{ list: '1', page: 1, ocr: {} }], expected: {}, master, members, membersText, masterText, baseline: null,
    startedAt: started, finishedAt: started + 60_000, parse: () => ({ ok: true, rows, dropped: [] }), ...extra });
  assert.equal(run(all).baselineOk, true);
  assert.equal(run(all.slice(0, 100)).baselineOk, false, 'low coverage');
  assert.equal(run(all, { finishedAt: started + 200_000 }).baselineOk, false, 'too long');
  assert.equal(run(all, { expected: { 1: 339, 2: 100 } }).baselineOk, false, 'a list was not read');
  const r = reconcile([{ list: '1', ocr: {} }, { list: '2', ocr: {} }], master, () => ({ ok: true, rows: all.slice(0, 3), dropped: [{ reason: 'CODE_NOT_IN_MASTER', code: '999999', name: '외부종목' }] }));
  assert.equal(r.found, 3); assert.equal(r.missing.length, master.companies.length - 3);
  assert.equal(r.inSeveralLists.length, 3);
  assert.deepEqual(r.unreadableOrOutside.map(x => [x.code, x.name]), [['999999', '외부종목']], 'the outside entry is named so the user can remove it');
  // The real parser reports the observed code and name of an outside row.
  const o = JSON.parse(JSON.stringify(ocr)); o.words.find(w => w.text === '466100').text = '999999';
  assert.deepEqual(parseWatchlist(o, index).dropped.find(d => d.reason === 'CODE_NOT_IN_MASTER'), { reason: 'CODE_NOT_IN_MASTER', code: '999999', name: '클로봇' });
  assert.ok(!JSON.stringify(r).includes('1000'), 'no prices');
});
