// Market mode from sector-move uploads (docs/sector-news-plan.md §2.2, §3.5) and the generated data files
// (sector queries, sector members, stock master): pinned hashes, exact schema, deterministic regeneration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, utimesSync, symlinkSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMarketData, validateMoves, readMarket, SECTOR_MEMBERS_SHA256, STOCK_MASTER_SHA256 } from '../workers/ai-processing/runtime/market.mjs';
import { generate as generateQueries, query } from '../scripts/tools/sector-queries.mjs';
import { generate as generateMembers } from '../scripts/tools/sector-members.mjs';
import { buildMaster } from '../scripts/tools/stock-master.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
const membersText = read('data/sector-members.json'), masterText = read('data/stock-master.json');
const data = loadMarketData(membersText, masterText);
const members = JSON.parse(membersText).sectors;
const NOW = Date.parse('2026-11-28T03:00:00Z');
function payload(patch = {}) {
  const sectors = members.map(s => { const n = s.companyIds.length; return { sectorId: s.sectorId, members: n, read: n, avgPct: 1.25 }; });
  return { format: 'SECTOR_MOVES_V1', membershipSha256: SECTOR_MEMBERS_SHA256, masterSha256: STOCK_MASTER_SHA256,
    at: '2026-11-28T02:58:00.000Z', finishedAt: '2026-11-28T02:59:30.000Z', kstDate: '2026-11-28', market: 'KR', session: 'OPEN', coverage: 0.95, sectors, ...patch };
}
const check = (p, receivedAt = Date.parse('2026-11-28T02:59:40Z'), now = NOW) => validateMoves(JSON.stringify(p), data, receivedAt, now);

test('pinned hashes: the constants equal the deployed data files; a changed byte is untrusted', () => {
  assert.equal(sha(membersText), SECTOR_MEMBERS_SHA256); assert.equal(sha(masterText), STOCK_MASTER_SHA256);
  assert.ok(data); assert.equal(data.sectors.size, 56);
  assert.equal(loadMarketData(membersText + ' ', masterText), null);
  assert.equal(check(payload()).ok, true);
  assert.equal(validateMoves(JSON.stringify(payload()), null, NOW, NOW).reason, 'MARKET_DATA_UNTRUSTED');
});

test('valid upload → KR moves; covered sectors need numbers, uncovered ones need null', () => {
  const r = check(payload()); assert.equal(r.ok, true); assert.equal(r.moves.size, 56);
  const big = members.find(s => s.companyIds.length >= 4), n = big.companyIds.length;
  const low = Math.floor(0.7 * n) - (0.7 * n === Math.floor(0.7 * n) ? 1 : 0);
  const withNull = payload({ sectors: payload().sectors.map(s => s.sectorId === big.sectorId ? { ...s, read: low, avgPct: null } : s) });
  assert.equal(check(withNull).ok, true, 'below coverage with null is valid');
  assert.equal(check(payload({ sectors: payload().sectors.map(s => s.sectorId === big.sectorId ? { ...s, read: low, avgPct: 2 } : s) })).reason, 'MOVES_VALUE');
  assert.equal(check(payload({ sectors: payload().sectors.map(s => s.sectorId === big.sectorId ? { ...s, avgPct: null } : s) })).reason, 'MOVES_VALUE');
  assert.equal(check(payload({ sectors: payload().sectors.map((s, i) => i === 0 ? { ...s, avgPct: 31 } : s) })).reason, 'MOVES_VALUE');
});

test('rejections: digests, sector set, members, times, replay with a fresh mtime, size, session', () => {
  assert.equal(check(payload({ membershipSha256: '0'.repeat(64) })).reason, 'MOVES_DIGEST');
  assert.equal(check(payload({ masterSha256: '0'.repeat(64) })).reason, 'MOVES_DIGEST');
  assert.equal(check(payload({ sectors: payload().sectors.slice(1) })).reason, 'MOVES_SECTORS');
  assert.equal(check(payload({ sectors: [...payload().sectors.slice(1), payload().sectors[1]] })).reason, 'MOVES_SECTORS', 'duplicate');
  assert.equal(check(payload({ sectors: payload().sectors.map((s, i) => i === 0 ? { ...s, members: s.members + 1 } : s) })).reason, 'MOVES_SECTORS');
  assert.equal(check(payload({ sectors: payload().sectors.map((s, i) => i === 0 ? { ...s, sectorId: 'x' } : s) })).reason, 'MOVES_SECTORS');
  assert.equal(check(payload({ at: '2026-11-28T03:00:00.000Z' })).reason, 'MOVES_TIME_ORDER', 'at after finishedAt');
  assert.equal(check(payload({ at: '2026-11-28T02:55:00.000Z' })).reason, 'MOVES_ROUND_TOO_LONG');
  assert.equal(check(payload(), Date.parse('2026-11-28T02:59:00Z')).reason, 'MOVES_TIME_ORDER', 'finished after receipt');
  assert.equal(check(payload(), NOW, NOW + 20 * 60_000).reason, 'MOVES_STALE', 'an old payload re-sent gets a fresh mtime but stays stale');
  assert.equal(check(payload({ kstDate: '2026-11-27' })).reason, 'MOVES_DATE');
  assert.equal(check(payload({ at: '2026-11-28 02:58' })).reason, 'MOVES_TIME_FORMAT');
  assert.equal(check(payload({ session: 'CLOSED' })).reason, 'MOVES_FORMAT');
  assert.equal(validateMoves('x'.repeat(40000), data, NOW, NOW).reason, 'MOVES_SIZE');
  assert.equal(validateMoves('{', data, NOW, NOW).reason, 'MOVES_JSON');
});

test('readMarket: missing file → US, symlink or folder → US, valid file → KR', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mk-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'sector-moves.json');
  assert.equal(readMarket(file, data, NOW).mode, 'US');
  writeFileSync(file, JSON.stringify(payload())); utimesSync(file, new Date('2026-11-28T02:59:40Z'), new Date('2026-11-28T02:59:40Z'));
  const r = readMarket(file, data, NOW); assert.equal(r.mode, 'KR'); assert.equal(r.moves.size, 56);
  assert.equal(readMarket(file, null, NOW).mode, 'US', 'untrusted data files');
  mkdirSync(join(dir, 'folder.json')); assert.equal(readMarket(join(dir, 'folder.json'), data, NOW).reason, 'MOVES_NOT_FILE');
  try { symlinkSync(file, join(dir, 'link.json')); assert.equal(readMarket(join(dir, 'link.json'), data, NOW).reason, 'MOVES_NOT_FILE'); }
  catch (error) { if (error.code !== 'EPERM') throw error; } // Windows without symlink rights
});

test('generated files are deterministic and match the committed bytes', () => {
  assert.equal(generateQueries(), read('data/sector-queries.json'));
  assert.equal(generateMembers(), read('data/sector-members.json'));
  const q = JSON.parse(read('data/sector-queries.json'));
  assert.deepEqual(Object.keys(q), ['format', 'sourceSha256', 'registrySha256', 'parserSha256', 'queries']);
  for (const x of q.queries) { assert.ok(x.q.length <= 200); assert.match(x.q, /^"[^"]+"( OR "[^"]+")*$/); }
  assert.equal(new Set(q.queries.map(x => x.queryId)).size, q.queries.length);
  assert.throws(() => query(['', '"bad"']), /QUERY_INVALID/);
  const m = JSON.parse(masterText);
  assert.deepEqual(Object.keys(m), ['format', 'source', 'corpCodeXmlSha256', 'dartCorpCodesSha256', 'registrySha256', 'generatorSha256', 'companies', 'excluded']);
});

test('stock master: same input, same output; duplicate names and codes are excluded', () => {
  const xml = '<result><list><corp_code>00000001</corp_code><corp_name>가</corp_name><stock_code>000001</stock_code></list>'
    + '<list><corp_code>00000002</corp_code><corp_name>나</corp_name><stock_code>000001</stock_code></list>'
    + '<list><corp_code>00000003</corp_code><corp_name>다</corp_name><stock_code> </stock_code></list></result>';
  const tsv = '가\t00000001\n나\t00000002\n다\t00000003\n';
  const registry = { companies: [{ id: 'a', name: '가' }, { id: 'b', name: '나' }, { id: 'c', name: '다' }, { id: 'd', name: '라' }, { id: 'e', name: '마' }, { id: 'f', name: '마' }] };
  const one = buildMaster({ xml, corpCodesTsv: tsv, registry }), two = buildMaster({ xml, corpCodesTsv: tsv, registry });
  assert.deepEqual(one, two);
  assert.deepEqual(one.companies, []);
  assert.deepEqual(one.excluded.map(e => e.reason).sort(), ['DUPLICATE_NAME', 'DUPLICATE_NAME', 'DUPLICATE_STOCK_CODE', 'DUPLICATE_STOCK_CODE', 'NO_CORP_CODE', 'NO_STOCK_CODE']);
});
