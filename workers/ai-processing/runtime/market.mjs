// News discovery market mode (docs/sector-news-plan.md §2.2, §3.5). KR only while a fresh, valid sector-move upload
// from the user's PC says the Korean market is OPEN; everything else (holidays, PC off, capture failure, any check
// failing) is US. The upload carries sector averages only — never company prices — and is trusted only when its
// membership and stock-master digests equal the pinned constants below, which equal the deployed data files.
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const SECTOR_MEMBERS_SHA256 = '88b6717ac4bb3275e957d0df6abd149fc11159efaef71bd47a7151f16a99453a';
export const STOCK_MASTER_SHA256 = 'a2a9b5da3028332b635dd7ffe3e181e695f84e2e37f777913be2b6d076319ae4';
export const MAX_BYTES = 32 * 1024, FRESH_MS = 15 * 60_000, MAX_ROUND_MS = 120_000;
const sha = text => createHash('sha256').update(text).digest('hex');
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const kstDate = ms => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

// Deployed data files, checked against the pinned constants. Returns null when either does not match.
export function loadMarketData(membersText, masterText) {
  if (sha(membersText) !== SECTOR_MEMBERS_SHA256 || sha(masterText) !== STOCK_MASTER_SHA256) return null;
  const members = JSON.parse(membersText);
  if (members?.format !== 'SECTOR_MEMBERS_V1' || !Array.isArray(members.sectors)) return null;
  return { membershipSha256: SECTOR_MEMBERS_SHA256, masterSha256: STOCK_MASTER_SHA256, sectors: new Map(members.sectors.map(s => [s.sectorId, s.companyIds.length])) };
}

// Validates one upload. receivedAt = the file's modification time on the server.
export function validateMoves(text, data, receivedAt, now) {
  if (!data) return { ok: false, reason: 'MARKET_DATA_UNTRUSTED' };
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) return { ok: false, reason: 'MOVES_SIZE' };
  let v; try { v = JSON.parse(text); } catch { return { ok: false, reason: 'MOVES_JSON' }; }
  if (v?.format !== 'SECTOR_MOVES_V1' || v.market !== 'KR' || v.session !== 'OPEN') return { ok: false, reason: 'MOVES_FORMAT' };
  if (v.membershipSha256 !== data.membershipSha256 || v.masterSha256 !== data.masterSha256) return { ok: false, reason: 'MOVES_DIGEST' };
  if (!iso.test(v.at ?? '') || !iso.test(v.finishedAt ?? '')) return { ok: false, reason: 'MOVES_TIME_FORMAT' };
  const at = Date.parse(v.at), finished = Date.parse(v.finishedAt);
  if (!(at <= finished && finished <= receivedAt + 1000 && receivedAt <= now + 1000)) return { ok: false, reason: 'MOVES_TIME_ORDER' };
  if (finished - at > MAX_ROUND_MS) return { ok: false, reason: 'MOVES_ROUND_TOO_LONG' };
  if (now - finished > FRESH_MS) return { ok: false, reason: 'MOVES_STALE' };
  if (v.kstDate !== kstDate(finished)) return { ok: false, reason: 'MOVES_DATE' };
  if (!Array.isArray(v.sectors) || v.sectors.length !== data.sectors.size) return { ok: false, reason: 'MOVES_SECTORS' };
  const moves = new Map();
  for (const s of v.sectors) {
    const members = data.sectors.get(s?.sectorId);
    if (members === undefined || moves.has(s.sectorId) || s.members !== members || !Number.isInteger(s.read) || s.read < 0 || s.read > members) return { ok: false, reason: 'MOVES_SECTORS' };
    const covered = s.read >= 0.7 * members && s.read >= Math.min(3, members);
    if (covered ? !(Number.isFinite(s.avgPct) && Math.abs(s.avgPct) <= 30) : s.avgPct !== null) return { ok: false, reason: 'MOVES_VALUE' };
    moves.set(s.sectorId, s.avgPct);
  }
  return { ok: true, moves, finishedAt: finished, coverage: Number.isFinite(v.coverage) ? v.coverage : null };
}

// The current mode from the mounted upload (missing file → US). Never follows a link.
export function readMarket(file, data, now = Date.now()) {
  let stat; try { stat = lstatSync(file); } catch { return { mode: 'US', reason: 'MOVES_ABSENT', moves: new Map() }; }
  if (!stat.isFile()) return { mode: 'US', reason: 'MOVES_NOT_FILE', moves: new Map() };
  if (stat.size > MAX_BYTES) return { mode: 'US', reason: 'MOVES_SIZE', moves: new Map() };
  const result = validateMoves(readFileSync(file, 'utf8'), data, stat.mtimeMs, now);
  return result.ok ? { mode: 'KR', reason: null, moves: result.moves, finishedAt: result.finishedAt, coverage: result.coverage, receivedAt: stat.mtimeMs }
    : { mode: 'US', reason: result.reason, moves: new Map(), receivedAt: stat.mtimeMs };
}
