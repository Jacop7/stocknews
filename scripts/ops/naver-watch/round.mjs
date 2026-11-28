// One capture round on the PC (docs/sector-news-plan.md §3.3–3.4): parsed screenshots → merged company changes →
// market state against the single allowed baseline file → sector averages → the SECTOR_MOVES_V1 payload.
// Company prices never leave this process except in the one baseline file (last-round.json).
// Usage (called by capture.ps1): node round.mjs --ocr-dir DIR --state FILE --out FILE --started ISO --finished ISO
import { readFileSync, writeFileSync, renameSync, rmSync, lstatSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { parseWatchlist, mergeRound, indexMaster } from './parse.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
export const kstDate = ms => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const day = 86400000;

// Market state (plan §3.4). previous: { kstDate, prices } or null; rows: merged company rows of this round.
export function marketState(previous, rows, masterSize, finishedAt) {
  if (!previous) return 'BASELINE';
  const today = kstDate(finishedAt), common = rows.filter(r => Number.isInteger(previous.prices[r.companyId]));
  if (common.length < 0.5 * masterSize) return 'UNKNOWN';
  const same = common.filter(r => previous.prices[r.companyId] === r.price).length;
  if (previous.kstDate === today) return same === common.length ? 'CLOSED' : 'OPEN';
  return same >= 0.95 * common.length ? 'CLOSED' : 'OPEN';
}

// Sector averages (plan §3.4): equal weight; a number only with ≥70% and ≥min(3,N) members read, otherwise null.
export function sectorMoves(rows, members) {
  const pct = new Map(rows.map(r => [r.companyId, r.pct]));
  return members.sectors.map(s => {
    const values = s.companyIds.filter(id => pct.has(id)).map(id => pct.get(id)), n = s.companyIds.length;
    const covered = values.length >= 0.7 * n && values.length >= Math.min(3, n);
    return { sectorId: s.sectorId, avgPct: covered ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 : null, read: values.length, members: n };
  });
}

// Baseline file: one regular file; never follows a link or folder; a damaged file is replaced by a new baseline.
export function readBaseline(file, master, now) {
  // A temporary copy left by a crash between write and rename is removed (only one baseline file may exist).
  try { for (const f of readdirSync(dirname(file))) if (f.startsWith('last-round.json.tmp-')) rmSync(join(dirname(file), f), { force: true }); } catch {}
  let stat; try { stat = lstatSync(file); } catch { return { state: 'ABSENT', value: null }; }
  if (!stat.isFile()) return { state: 'NOT_FILE', value: null };
  if (now - stat.mtimeMs > 7 * day) { rmSync(file, { force: true }); return { state: 'EXPIRED', value: null }; }
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')), ids = new Set(master.companies.map(c => c.companyId));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v?.kstDate ?? '') || !v.prices || typeof v.prices !== 'object' || Array.isArray(v.prices)) throw new Error('SCHEMA');
    for (const [id, price] of Object.entries(v.prices)) if (!ids.has(id) || !Number.isInteger(price) || price <= 0) throw new Error('SCHEMA');
    return { state: 'OK', value: v };
  } catch { rmSync(file, { force: true }); return { state: 'DAMAGED', value: null }; }
}
export function writeBaseline(file, rows, finishedAt) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid;
  writeFileSync(temp, JSON.stringify({ kstDate: kstDate(finishedAt), prices: Object.fromEntries(rows.map(r => [r.companyId, r.price])) }), { mode: 0o600 });
  renameSync(temp, file);
}

// Watchlist ↔ master reconciliation for the first setup (-Check): companies missing from every list, companies in more
// than one list, and rows whose code is not in the master. Company IDs and names only, no prices.
export function reconcile(ocrPages, master, parse = parseWatchlist) {
  const index = indexMaster(master), lists = new Map(), unknown = new Map();
  for (const page of ocrPages) {
    const p = parse(page.ocr, index); if (!p.ok) continue;
    for (const r of p.rows) lists.set(r.companyId, new Set([...(lists.get(r.companyId) ?? []), page.list]));
    // Rows that are not catalog companies (or could not be identified): the observed code and name, so the user can fix the list.
    for (const d of p.dropped) if (d.reason === 'CODE_NOT_IN_MASTER' || d.reason === 'UNIDENTIFIED') unknown.set((d.code ?? '') + '|' + (d.name ?? ''), { reason: d.reason, code: d.code ?? null, name: d.name ?? null, list: page.list });
  }
  const name = id => master.companies.find(c => c.companyId === id)?.name ?? id;
  return { check: 'WATCHLIST_RECONCILIATION', master: master.companies.length, found: lists.size,
    missing: master.companies.filter(c => !lists.has(c.companyId)).map(c => c.name),
    inSeveralLists: [...lists].filter(([, l]) => l.size > 1).map(([id, l]) => ({ name: name(id), lists: [...l].sort() })),
    unreadableOrOutside: [...unknown.values()] };
}

// Whole round. ocrPages: [{ list, page, ocr }] in capture order; expected: { list → expected row count }.
export function runRound({ ocrPages, expected, master, members, membersText, masterText, baseline, startedAt, finishedAt, parse = parseWatchlist }) {
  const index = indexMaster(master), parts = [], incomplete = [];
  for (const page of ocrPages) { const p = parse(page.ocr, index); if (!p.ok) return { upload: null, reason: 'HEADER_NOT_FOUND', rows: [], baselineOk: false }; parts.push({ ...p, list: page.list }); }
  for (const [list, count] of Object.entries(expected ?? {})) {
    const read = new Set(parts.filter(p => p.list === list).flatMap(p => p.rows.map(r => r.companyId)));
    if (read.size < 0.5 * count) incomplete.push(list);
  }
  const { rows } = mergeRound(parts);
  const coverage = rows.length / index.size;
  const state = marketState(baseline, rows, index.size, finishedAt);
  // Only a complete round within the time limit and with ≥80% coverage may become the next baseline.
  const valid = !incomplete.length && finishedAt >= startedAt && finishedAt - startedAt <= 120_000 && coverage >= 0.8;
  const base = { rows, state, coverage: Math.round(coverage * 1000) / 1000, baselineOk: valid };
  if (incomplete.length) return { ...base, upload: null, reason: 'LIST_INCOMPLETE' };
  if (finishedAt - startedAt > 120_000 || finishedAt < startedAt) return { ...base, upload: null, reason: 'ROUND_TIME' };
  if (state !== 'OPEN') return { ...base, upload: null, reason: 'MARKET_' + state };
  if (coverage < 0.8) return { ...base, upload: null, reason: 'COVERAGE_LOW' };
  const upload = { format: 'SECTOR_MOVES_V1', membershipSha256: sha(membersText), masterSha256: sha(masterText),
    at: new Date(startedAt).toISOString(), finishedAt: new Date(finishedAt).toISOString(), kstDate: kstDate(finishedAt), market: 'KR', session: 'OPEN',
    coverage: base.coverage, sectors: sectorMoves(rows, members) };
  return { ...base, upload, reason: null };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('naver-watch/round.mjs')) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const repo = new URL('../../../', import.meta.url);
  const membersText = readFileSync(new URL('data/sector-members.json', repo), 'utf8'), masterText = readFileSync(new URL('data/stock-master.json', repo), 'utf8');
  const master = JSON.parse(masterText), members = JSON.parse(membersText);
  const dir = arg('--ocr-dir'), state = arg('--state'), out = arg('--out'), startedAt = Date.parse(arg('--started')), finishedAt = Date.parse(arg('--finished'));
  const expected = arg('--expected') ? JSON.parse(arg('--expected')) : {};
  const ocrPages = readdirSync(dir).filter(f => /^\d+-\d+\.json$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map(f => ({ list: f.split('-')[0], page: Number(f.split('-')[1].split('.')[0]), ocr: JSON.parse(readFileSync(join(dir, f), 'utf8').replace(/^﻿/, '')) }));
  const baseline = readBaseline(state, master, Date.now());
  if (baseline.state === 'NOT_FILE') { console.log(JSON.stringify({ upload: false, reason: 'BASELINE_NOT_FILE' })); process.exit(2); }
  const r = runRound({ ocrPages, expected, master, members, membersText, masterText, baseline: baseline.value, startedAt, finishedAt });
  // A readable round always becomes the next baseline (damaged or missing files are replaced here).
  if (r.baselineOk) writeBaseline(state, r.rows, finishedAt);
  if (r.upload && !process.argv.includes('--check')) writeFileSync(out, JSON.stringify(r.upload));
  if (process.argv.includes('--check')) console.log(JSON.stringify(reconcile(ocrPages, master)));
  console.log(JSON.stringify({ upload: Boolean(r.upload), reason: r.reason, state: r.state ?? null, coverage: r.coverage ?? 0, rows: r.rows.length, baseline: baseline.state }));
}
