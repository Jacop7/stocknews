// News-source evaluation (owner request 2026-11-28: decide within 5 days whether to keep GNews and Finlight, and
// whether they replace the direct web news collection). Read only: counts from news_signals and the API ledgers,
// no URLs or titles in the output.
//   - per source family (gnews, finlight, telegram, web) and per KST day: new signals, distinct hosts, Korean share;
//   - Finlight ticker coverage (share with tickers, KRX/KOSDAQ tickers, distinct tickers);
//   - overlap: signals carried by more than one family;
//   - coverage of the former web news hosts (the 39 registered sites, of which ~10 produced links);
//   - API usage from the ledgers.
export const FORMER_WEB_HOSTS = ['www.ksdaily.co.kr', 'www.g-enews.com', 'www.hankyung.com', 'www.mt.co.kr', 'www.etoday.co.kr', 'www.asiae.co.kr', 'www.hansbiz.co.kr',
  'www.infostockdaily.co.kr', 'www.ekn.kr', 'www.sedaily.com', 'www.thinkpool.com', 'www.wowtv.co.kr', 'www.newspim.com', 'mbnmoney.mbn.co.kr', 'www.tossinvest.com',
  'www.moneytoring.ai', 'biz.heraldcorp.com', 'www.mediapen.com', 'oneshotstock.com', 'www.fnnews.com', 'www.edaily.co.kr', 'www.yna.co.kr', 'www.cnbc.com',
  'finance.yahoo.com', 'www.investing.com', 'www.benzinga.com', 'apnews.com', 'focustaiwan.tw', 'www.channelnewsasia.com', 'www.datacenterdynamics.com'];
// Baseline measured on the server before web news was switched off (2026-11-28, 48 hours): 491 links from 13 hosts.
export const WEB_BASELINE = { links48h: 491, linksPerDay: 245, hostsWithLinks: 13 };

const family = source => /^gnews:/.test(source) ? 'gnews' : /^finlight:/.test(source) ? 'finlight' : /^telegram/.test(source) ? 'telegram' : /^web/.test(source) ? 'web' : 'other';
const kstDay = ms => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const korean = host => /\.kr$/.test(host) || ['www.newspim.com', 'www.sedaily.com', 'www.mk.co.kr', 'www.hankyung.com', 'biz.chosun.com', 'www.edaily.co.kr', 'www.etoday.co.kr', 'www.fnnews.com', 'www.asiae.co.kr', 'www.g-enews.com', 'www.mediapen.com'].includes(host);

export function newsReport(db, now = Date.now()) {
  const cols = new Set(db.prepare('PRAGMA table_info(news_signals)').all().map(c => c.name));
  const rows = db.prepare(`SELECT url,host,first_seen,sources${cols.has('tickers') ? ',tickers' : ''} FROM news_signals`).all();
  const byFamily = {}, overlap = { multiFamily: 0, gnewsAndFinlight: 0 }, former = new Map(FORMER_WEB_HOSTS.map(h => [h, new Set()]));
  const tick = { finlightSignals: 0, withTickers: 0, krxTickers: 0, distinct: new Set() };
  for (const row of rows) {
    const fams = [...new Set(JSON.parse(row.sources).map(family))];
    if (fams.length > 1) overlap.multiFamily++;
    if (fams.includes('gnews') && fams.includes('finlight')) overlap.gnewsAndFinlight++;
    for (const f of fams) {
      const b = byFamily[f] ??= { total: 0, korean: 0, hosts: new Set(), days: {} };
      b.total++; if (korean(row.host)) b.korean++; b.hosts.add(row.host);
      const d = kstDay(row.first_seen); b.days[d] = (b.days[d] ?? 0) + 1;
      if (former.has(row.host)) former.get(row.host).add(f);
    }
    if (fams.includes('finlight')) {
      tick.finlightSignals++;
      const t = row.tickers ? JSON.parse(row.tickers) : [];
      if (t.length) tick.withTickers++;
      for (const x of t) { tick.distinct.add(x); if (/^(XKRX|XKOS|XKON):/.test(x)) tick.krxTickers++; }
    }
  }
  const ledger = (table, key) => { try { return db.prepare(`SELECT ${key} k, used FROM ${table} ORDER BY ${key} DESC LIMIT 7`).all().map(r => ({ ...r })); } catch { return []; } };
  return {
    at: new Date(now).toISOString(),
    families: Object.fromEntries(Object.entries(byFamily).map(([f, b]) => [f, { total: b.total, koreanShare: b.total ? +(b.korean / b.total).toFixed(2) : 0, hosts: b.hosts.size, perDayKst: b.days }])),
    finlightTickers: { signals: tick.finlightSignals, withTickers: tick.withTickers, share: tick.finlightSignals ? +(tick.withTickers / tick.finlightSignals).toFixed(2) : 0, krxMentions: tick.krxTickers, distinct: tick.distinct.size },
    overlap,
    formerWebHosts: { total: FORMER_WEB_HOSTS.length, coveredBy: Object.fromEntries([...former].filter(([, s]) => s.size).map(([h, s]) => [h, [...s].sort()])) },
    webBaseline: WEB_BASELINE,
    apiUsage: { gnews: ledger('gnews_ledger', 'day'), finlight: ledger('finlight_ledger', 'day') },
  };
}
