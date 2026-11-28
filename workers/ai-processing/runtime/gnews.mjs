// GNews Essential (owner subscribed 2026-11-28): US/global market news discovery. Decision B: news is a signal only —
// the article URL, title, source and publication time become news-signal links (the pipeline's SIGNAL route), never a
// read original; the description/content fields GNews returns are discarded here and never stored.
// Budget: the plan allows 1,000 requests a day; this client makes at most 3 requests every 15 minutes (<=288 a day):
// business top headlines for the US and for Korea (Korean) and one rotating US market query. The API key goes only to gnews.io, as the apikey query
// parameter, and is never logged (errors carry only a status code).
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

export function createGnewsClient({ apiKey, fetchImpl = fetch, now = Date.now }) {
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9]{20,64}$/.test(apiKey)) throw new Error('GNEWS_KEY_INVALID');
  let day = null, used = 0, turn = 0;
  async function call(path, params) {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) { day = today; used = 0; }
    if (used >= MAX_PER_DAY) throw new Error('GNEWS_DAILY_BUDGET');
    used++;
    const url = new URL(path, API);
    for (const [k, v] of Object.entries({ ...params, apikey: apiKey })) url.searchParams.set(k, String(v));
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'JudojuNews-Discovery/1.0' } });
    if (!response.ok) throw new Error('GNEWS_HTTP_' + response.status);
    const body = await response.json();
    if (!Array.isArray(body?.articles)) throw new Error('GNEWS_RESPONSE_INVALID');
    return body.articles;
  }
  // Signal entries for store.importLinks: URL, title and publication time only.
  const toEntries = (articles, sourceId, at) => articles.flatMap(a => {
    try {
      const u = new URL(a.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return [];
      const published = Date.parse(a.publishedAt);
      return [{ sourceId, url: u.href, title: String(a.title ?? '').slice(0, 300), lastSeen: Number.isFinite(published) ? Math.min(published, at) : at, expiresAt: at + 7 * 86400000 }];
    } catch { return []; }
  });
  return {
    // One discovery pass: US business headlines and the next market query, articles from the last 24 hours.
    async pass() {
      const at = now(), from = new Date(at - 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const keep = { nullable: 'description,content,image' };
      const headlines = await call('top-headlines', { category: 'business', lang: 'en', country: 'us', max: 25, from, ...keep });
      const korea = await call('top-headlines', { category: 'business', lang: 'ko', country: 'kr', max: 25, from, ...keep });
      const query = QUERIES[turn++ % QUERIES.length];
      const found = await call('search', { q: query, lang: 'en', max: 25, from, sortby: 'publishedAt', ...keep });
      return { requestsToday: used, entries: [...toEntries(headlines, 'gnews:headlines-us-business', at), ...toEntries(korea, 'gnews:headlines-kr-business', at), ...toEntries(found, 'gnews:search', at)] };
    },
  };
}
