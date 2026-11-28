// GNews Essential (owner subscribed 2026-11-28): market news discovery. Decision B: news is a signal only — article
// URL, title, source query and publication time go straight to news signals (store.recordNewsSignals: no job, no
// fetch path, no body); the description/content fields GNews returns are dropped here.
// Budget: the plan allows 1,000 requests a day; at most 3 requests every 15 minutes and at most 300 a UTC day, counted
// in the processor database (survives restarts), as is the rotating query cursor.
// The API key travels only in the X-Api-Key header to gnews.io (never in a URL), redirects are refused, errors carry
// only a status code. Requests stop with the service (abort) or after 15 seconds.
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
export const EVERY = 15 * 60_000, MAX_PER_DAY = 300;

export function createGnewsClient({ apiKey, db, fetchImpl = fetch, now = Date.now, signal }) {
  if (typeof apiKey !== 'string' || !/^[a-f0-9]{32}$/.test(apiKey)) throw new Error('GNEWS_KEY_INVALID');
  db.exec('CREATE TABLE IF NOT EXISTS gnews_ledger(day TEXT PRIMARY KEY,used INTEGER NOT NULL,turn INTEGER NOT NULL) STRICT');
  const today = () => new Date(now()).toISOString().slice(0, 10);
  // Reserves one request in today's ledger before it is sent (a crash never under-counts). For the rotating search
  // the query is taken and the cursor advanced in the same transaction, so a refused request never skips a query.
  function reserve(advance) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT used,turn FROM gnews_ledger WHERE day=?').get(today()) ?? { used: 0, turn: db.prepare('SELECT turn FROM gnews_ledger ORDER BY day DESC LIMIT 1').get()?.turn ?? 0 };
      if (row.used >= MAX_PER_DAY) throw new Error('GNEWS_DAILY_BUDGET');
      db.prepare('INSERT INTO gnews_ledger VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET used=excluded.used,turn=excluded.turn').run(today(), row.used + 1, row.turn + (advance ? 1 : 0));
      db.exec('COMMIT');
      return QUERIES[row.turn % QUERIES.length];
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  async function call(path, params, advance = false) {
    const query = reserve(advance);
    if (advance) params = { q: query, ...params };
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
  return {
    // One discovery pass: US and Korean business headlines and the next market query, articles from the last 24 hours.
    async pass() {
      const at = now(), from = new Date(at - 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const keep = { nullable: 'description,content,image' };
      const headlines = await call('top-headlines', { category: 'business', lang: 'en', country: 'us', max: 25, from, ...keep });
      const korea = await call('top-headlines', { category: 'business', lang: 'ko', country: 'kr', max: 25, from, ...keep });
      const found = await call('search', { lang: 'en', max: 25, from, sortby: 'publishedAt', ...keep }, true);
      return { requestsToday: db.prepare('SELECT used FROM gnews_ledger WHERE day=?').get(today())?.used ?? 0,
        entries: [...toEntries(headlines, 'gnews:headlines-us-business', at), ...toEntries(korea, 'gnews:headlines-kr-business', at), ...toEntries(found, 'gnews:search', at)] };
    },
  };
}

// Background loop beside the processing loop (never blocks processing, delivery or the heartbeat).
export function startGnewsLoop({ client, record, log, signal, sleep, every = EVERY }) {
  return (async () => {
    while (!signal.aborted) {
      try { const r = await client.pass(); log({ event: 'AI_GNEWS', entries: r.entries.length, requestsToday: r.requestsToday, ...record(r.entries) }); }
      catch (error) { if (!signal.aborted) log({ event: 'AI_GNEWS_FAILED', reason: /^GNEWS_[A-Z_0-9]+$/.test(error?.message ?? '') ? error.message : 'GNEWS_FAILED' }); }
      await sleep(every).catch(() => {});
    }
  })();
}
