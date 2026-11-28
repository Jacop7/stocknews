// GNews Essential (owner subscribed 2026-11-28): market news discovery. Decision B: news is a signal only — article
// URL, title, source query and publication time go straight to news signals (store.recordNewsSignals: no job, no
// fetch path, no body); the description/content fields GNews returns are dropped here.
// Sector news (docs/sector-news-plan.md §2, 2026-11-28): every 15 minutes, two business headline requests and four
// search slots. In KR mode (a fresh sector-move upload says the Korean market is open) three Korean sector queries
// ordered by the size of the sector move and, every other round, a Korean macro query; otherwise English sector
// queries, the legacy English theme rotation and, every other round, an English macro query. A query not tried for
// six hours goes first. Each call is recorded as soon as it returns; a failed slot is skipped, a spent budget stops
// the round. Budget: the plan allows 1,000 requests a day; at most 900 a UTC day, counted in the processor database.
// The API key travels only in the X-Api-Key header to gnews.io (never in a URL), redirects are refused, errors carry
// only a status code. Requests stop with the service (abort) or after 15 seconds.
import { createHash } from 'node:crypto';

const API = 'https://gnews.io/api/v4/';
export const QUERIES = [
  'stock market OR "S&P 500" OR Nasdaq',
  'semiconductor OR chipmaker OR Nvidia OR TSMC',
  '"electric vehicle" OR "EV battery" OR lithium',
  '"data center" OR "artificial intelligence" OR hyperscaler',
  'biotech OR FDA OR "clinical trial"',
  '"defense contract" OR Pentagon OR shipbuilding',
  '"Federal Reserve" OR "interest rate" OR inflation',
  'earnings OR guidance OR "quarterly results"',
];
export const EVERY = 15 * 60_000, MAX_PER_DAY = 900, STARVE_MS = 6 * 3600_000;
// The reviewed query file (data/sector-queries.json) is used only when its bytes hash to this constant.
export const SECTOR_QUERIES_SHA256 = 'f437bedf957a5ed7958beff861318342b7447980b96756bb146e9af65c87a0bb';

export function loadSectorQueries(text) {
  if (typeof text !== 'string' || createHash('sha256').update(text).digest('hex') !== SECTOR_QUERIES_SHA256) return null;
  const body = JSON.parse(text);
  if (body?.format !== 'SECTOR_QUERIES_V1' || !Array.isArray(body.queries)) return null;
  return body.queries.filter(q => /^[A-Za-z0-9-]+:(ko|en)$/.test(q.queryId) && typeof q.q === 'string' && q.q.length <= 200);
}

export function createGnewsClient({ apiKey, db, fetchImpl = fetch, now = Date.now, signal, queries = null, market = () => ({ mode: 'US', moves: new Map() }) }) {
  if (typeof apiKey !== 'string' || !/^[a-f0-9]{32}$/.test(apiKey)) throw new Error('GNEWS_KEY_INVALID');
  db.exec('CREATE TABLE IF NOT EXISTS gnews_ledger(day TEXT PRIMARY KEY,used INTEGER NOT NULL,turn INTEGER NOT NULL) STRICT');
  db.exec('CREATE TABLE IF NOT EXISTS gnews_queries(query_id TEXT PRIMARY KEY,last_attempted INTEGER NOT NULL DEFAULT 0,last_succeeded INTEGER NOT NULL DEFAULT 0) STRICT');
  db.exec('CREATE TABLE IF NOT EXISTS gnews_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL) STRICT');
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const used = () => db.prepare('SELECT used FROM gnews_ledger WHERE day=?').get(today())?.used ?? 0;
  // Reserves one request before it is sent (a crash never under-counts). The legacy theme query advances its cursor
  // and a sector/macro query records its attempt in the same transaction, so a refused request changes nothing.
  function reserve({ theme = false, queryId = null } = {}) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT used,turn FROM gnews_ledger WHERE day=?').get(today()) ?? { used: 0, turn: db.prepare('SELECT turn FROM gnews_ledger ORDER BY day DESC LIMIT 1').get()?.turn ?? 0 };
      if (row.used >= MAX_PER_DAY) throw new Error('GNEWS_DAILY_BUDGET');
      db.prepare('INSERT INTO gnews_ledger VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET used=excluded.used,turn=excluded.turn').run(today(), row.used + 1, row.turn + (theme ? 1 : 0));
      if (queryId) db.prepare('INSERT INTO gnews_queries(query_id,last_attempted) VALUES (?,?) ON CONFLICT(query_id) DO UPDATE SET last_attempted=excluded.last_attempted').run(queryId, now());
      db.exec('COMMIT');
      return QUERIES[row.turn % QUERIES.length];
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  async function call(path, params) {
    const url = new URL(path, API);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const response = await fetchImpl(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { 'X-Api-Key': apiKey, 'User-Agent': 'JudojuNews-Discovery/1.0' } });
    if (!response.ok) throw new Error('GNEWS_HTTP_' + response.status);
    const body = await response.json();
    if (!Array.isArray(body?.articles)) throw new Error('GNEWS_RESPONSE_INVALID');
    return body.articles.slice(0, 100);
  }
  // Signal entries for store.recordNewsSignals: URL, title and publication time only.
  const toEntries = (articles, sourceId, at) => articles.flatMap(a => {
    try {
      const u = new URL(a.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return [];
      const published = Date.parse(a.publishedAt);
      return [{ sourceId, url: u.href, title: String(a.title ?? '').slice(0, 300), lastSeen: Number.isFinite(published) ? Math.min(published, at) : at, expiresAt: at + 7 * 86400000 }];
    } catch { return []; }
  });
  const attempted = id => db.prepare('SELECT last_attempted FROM gnews_queries WHERE query_id=?').get(id)?.last_attempted ?? 0;
  // Oldest attempt first (never tried first), ties by queryId.
  const oldest = list => [...list].sort((a, b) => attempted(a.queryId) - attempted(b.queryId) || (a.queryId < b.queryId ? -1 : 1));
  function pickSectors(locale, count, moves, mode) {
    const pool = (queries ?? []).filter(q => q.locale === locale && q.topic !== 'MACRO');
    // Starved: never tried, or not tried for six hours (oldest first, never tried counts as oldest).
    const starved = oldest(pool.filter(q => attempted(q.queryId) === 0 || now() - attempted(q.queryId) > STARVE_MS));
    if (mode !== 'KR') return oldest(pool).slice(0, count);
    // KR: one slot always goes to the oldest query (never tried first, then the longest since its last try), so every
    // sector is reached; the others by the size of the move.
    const first = (starved.length ? starved : oldest(pool)).slice(0, 1);
    const rest = pool.filter(q => !first.includes(q));
    const moved = rest.filter(q => Number.isFinite(moves.get(q.topic))).sort((a, b) => Math.abs(moves.get(b.topic)) - Math.abs(moves.get(a.topic)) || (a.queryId < b.queryId ? -1 : 1));
    return [...first, ...moved, ...oldest(rest.filter(q => !moved.includes(q)))].slice(0, count);
  }
  // The six slots of one round (plan §2.3).
  function plan(round, mode, moves) {
    const head = [{ kind: 'headline', path: 'top-headlines', params: { category: 'business', lang: 'en', country: 'us' }, sourceId: 'gnews:headlines-us-business' },
      { kind: 'headline', path: 'top-headlines', params: { category: 'business', lang: 'ko', country: 'kr' }, sourceId: 'gnews:headlines-kr-business' }];
    if (!queries) return [...head, { kind: 'theme', path: 'search', params: { lang: 'en', sortby: 'publishedAt' }, sourceId: 'gnews:search' }];
    const locale = mode === 'KR' ? 'ko' : 'en', odd = round % 2 === 1;
    const macro = odd ? oldest(queries.filter(q => q.locale === locale && q.topic === 'MACRO'))[0] : null;
    const sectorCount = mode === 'KR' ? (macro ? 3 : 4) : (macro ? 2 : 3);
    const sectors = pickSectors(locale, sectorCount, moves, mode);
    const search = (q, kind) => ({ kind, path: 'search', params: { lang: locale, ...(locale === 'ko' ? { country: 'kr' } : {}), sortby: 'publishedAt', q: q.q }, query: q,
      sourceId: 'gnews:' + kind + '-' + locale });
    return [...head, ...sectors.map(q => search(q, 'sector')), ...(mode === 'KR' ? [] : [{ kind: 'theme', path: 'search', params: { lang: 'en', sortby: 'publishedAt' }, sourceId: 'gnews:search' }]),
      ...(macro ? [search(macro, 'macro')] : [])];
  }
  return {
    // One round. record(entries, topic|null) is called after each successful call; returns counts and slot outcomes.
    async pass({ record = null } = {}) {
      const at = now(), from = new Date(at - 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const { mode, moves } = market();
      const round = db.prepare("SELECT value FROM gnews_meta WHERE key='round'").get()?.value ?? 0;
      db.prepare("INSERT INTO gnews_meta VALUES ('round',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(round + 1);
      const keep = { nullable: 'description,content,image', max: 25, from };
      const slots = [], entries = [];
      let firstError = null;
      for (const slot of plan(round, mode, moves)) {
        let params = { ...slot.params, ...keep };
        try {
          const theme = reserve({ theme: slot.kind === 'theme', queryId: slot.query?.queryId ?? null });
          if (slot.kind === 'theme') params = { q: theme, ...params };
          const found = toEntries(await call(slot.path, params), slot.sourceId, at);
          const topic = slot.query ? { queryId: slot.query.queryId, topic: slot.query.topic, locale: slot.query.locale } : null;
          if (record) record(found, topic);
          entries.push(...found); slots.push({ kind: slot.kind, queryId: slot.query?.queryId ?? null, entries: found.length });
        } catch (error) {
          const reason = /^GNEWS_[A-Z_0-9]+$/.test(error?.message ?? '') ? error.message : 'GNEWS_FAILED';
          firstError ??= error; slots.push({ kind: slot.kind, queryId: slot.query?.queryId ?? null, failed: reason });
          if (signal?.aborted || reason === 'GNEWS_DAILY_BUDGET') break;
        }
      }
      if (!slots.some(s => !s.failed)) throw firstError ?? new Error('GNEWS_FAILED');
      return { mode, requestsToday: used(), entries, slots };
    },
  };
}

// Background loop beside the processing loop (never blocks processing, delivery or the heartbeat).
export function startGnewsLoop({ client, record, log, signal, sleep, every = EVERY }) {
  return (async () => {
    while (!signal.aborted) {
      try {
        const totals = { added: 0, updated: 0, rejected: 0 };
        const r = await client.pass({ record: (entries, topic) => { const c = record(entries, topic); for (const k of Object.keys(totals)) totals[k] += c?.[k] ?? 0; } });
        log({ event: 'AI_GNEWS', mode: r.mode, entries: r.entries.length, requestsToday: r.requestsToday, failedSlots: (r.slots ?? []).filter(s => s.failed).length, ...totals });
      } catch (error) { if (!signal.aborted) log({ event: 'AI_GNEWS_FAILED', reason: /^GNEWS_[A-Z_0-9]+$/.test(error?.message ?? '') ? error.message : 'GNEWS_FAILED' }); }
      await sleep(every).catch(() => {});
    }
  })();
}
