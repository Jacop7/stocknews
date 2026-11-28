// Finlight Pro Light (owner subscribed 2026-11-28, $29/month, 10,000 requests a month): Korean market news discovery.
// Decision B: news is a signal only — article URL, title, publication time and the company tickers Finlight resolves
// go straight to news signals (store.recordNewsSignals: no job, no fetch path, no body); summary/content are dropped.
// Sources: the Korean-language outlets Finlight covers (checked 2026-11-28). One request every 10 minutes for the
// last hour (a second page only when the first is full), at most 300 a UTC day and 9,300 in any rolling 31 days (Finlight resets
// its 10,000 at the account's billing date, so 300 a day can never exceed it in any billing period), counted in
// the processor database. The API key travels only in the X-API-KEY header to api.finlight.me; redirects are refused;
// errors carry only a status code; requests stop with the service or after 20 seconds.
const API = 'https://api.finlight.me/v2/articles';
export const SOURCES = ['biz.chosun.com', 'news.einfomax.co.kr', 'www.hankyung.com', 'www.mk.co.kr', 'www.newspim.com', 'www.sedaily.com', 'www.yna.co.kr'];
export const EVERY = 10 * 60_000, MAX_PER_DAY = 300, MAX_PER_31_DAYS = 9300;

export function createFinlightClient({ apiKey, db, fetchImpl = fetch, now = Date.now, signal }) {
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_.-]{20,200}$/.test(apiKey)) throw new Error('FINLIGHT_KEY_INVALID');
  db.exec('CREATE TABLE IF NOT EXISTS finlight_ledger(day TEXT PRIMARY KEY,used INTEGER NOT NULL) STRICT');
  const today = () => new Date(now()).toISOString().slice(0, 10);
  function reserve() {
    db.exec('BEGIN IMMEDIATE');
    try {
      const day = today(), since = new Date(now() - 30 * 86400000).toISOString().slice(0, 10);
      const usedToday = db.prepare('SELECT used FROM finlight_ledger WHERE day=?').get(day)?.used ?? 0;
      const usedWindow = db.prepare('SELECT coalesce(sum(used),0) n FROM finlight_ledger WHERE day>=?').get(since).n;
      if (usedToday >= MAX_PER_DAY || usedWindow >= MAX_PER_31_DAYS) throw new Error('FINLIGHT_BUDGET');
      db.prepare('INSERT INTO finlight_ledger VALUES (?,1) ON CONFLICT(day) DO UPDATE SET used=used+1').run(day);
      db.exec('COMMIT');
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  async function page(n, from) {
    reserve();
    const response = await fetchImpl(API, { method: 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', accept: 'application/json', 'User-Agent': 'JudojuNews-Discovery/1.0' },
      body: JSON.stringify({ language: 'ko', sources: SOURCES, includeEntities: true, orderBy: 'createdAt', order: 'DESC', pageSize: 100, page: n, from }) });
    if (!response.ok) throw new Error('FINLIGHT_HTTP_' + response.status);
    const body = await response.json();
    if (!Array.isArray(body?.articles)) throw new Error('FINLIGHT_RESPONSE_INVALID');
    return body.articles.slice(0, 100);
  }
  // Tickers as EXCHANGE:SYMBOL (e.g. XKRX:078930), at most 10 per article, only well-formed values.
  const tickers = companies => [...new Set((Array.isArray(companies) ? companies : []).flatMap(c => {
    const t = String(c?.primaryListing?.ticker ?? c?.ticker ?? ''), x = String(c?.primaryListing?.exchangeCode ?? c?.exchange ?? '');
    return /^[A-Za-z0-9.]{1,12}$/.test(t) && /^[A-Z0-9]{2,8}$/.test(x) ? [x + ':' + t] : [];
  }))].slice(0, 10);
  const toEntries = (articles, at) => articles.flatMap(a => {
    try {
      const u = new URL(a.link);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return [];
      const published = Date.parse(a.publishDate);
      return [{ sourceId: 'finlight:kr', url: u.href, title: String(a.title ?? '').slice(0, 300), tickers: tickers(a.companies),
        lastSeen: Number.isFinite(published) ? Math.min(published, at) : at, expiresAt: at + 7 * 86400000 }];
    } catch { return []; }
  });
  return {
    async pass() {
      const at = now(), from = new Date(at - 3600_000).toISOString();
      const first = await page(1, from);
      // A second page that cannot be read (budget, HTTP, timeout) never discards the first page.
      let second = [], partial = null;
      if (first.length === 100) { try { second = await page(2, from); } catch (error) { if (signal?.aborted) throw error; partial = /^FINLIGHT_[A-Z_0-9]+$/.test(error?.message ?? '') ? error.message : 'FINLIGHT_PAGE2_FAILED'; } }
      return { partial, requestsToday: db.prepare('SELECT used FROM finlight_ledger WHERE day=?').get(today())?.used ?? 0, entries: toEntries([...first, ...second], at) };
    },
  };
}

export function startFinlightLoop({ client, record, log, signal, sleep, every = EVERY }) {
  return (async () => {
    while (!signal.aborted) {
      try { const r = await client.pass(); log({ event: 'AI_FINLIGHT', entries: r.entries.length, ...(r.partial ? { partial: r.partial } : {}), withTickers: r.entries.filter(e => e.tickers.length).length, requestsToday: r.requestsToday, ...record(r.entries) }); }
      catch (error) { if (!signal.aborted) log({ event: 'AI_FINLIGHT_FAILED', reason: /^FINLIGHT_[A-Z_0-9]+$/.test(error?.message ?? '') ? error.message : 'FINLIGHT_FAILED' }); }
      await sleep(every).catch(() => {});
    }
  })();
}
