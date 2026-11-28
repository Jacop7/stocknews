// Issue → evidence matching (owner decision 2026-11-28): a company issue found by the news APIs (Finlight, GNews) is
// matched to that company's own primary sources — DART filings and its press-release / newsroom / IR pages — that
// the processor already queued. News stays a signal (never read); the match only records the link and moves the
// matched official documents to the front of the analysis queue. Nothing is fetched and nothing new is queued here.
//
// Company of a news signal: Finlight tickers (EXCHANGE:SYMBOL, Korean six-digit codes) through the stock codes
// DART's own filing list reported, plus company names in the headline (longest name wins; short or Latin names
// need clear boundaries); the issue time is the publication time. Company of a queued job: DART filing titles start with the filer's name; company-site
// jobs map through the enabled source's company name. Window: evidence seen from 3 days before to 2 days after.
const day = 86400000;
export const LOOKBACK = 2 * day, BEFORE = 3 * day, AFTER = 2 * day;
const HANGUL = /[가-힣]/, WORD = /[가-힣A-Za-z0-9]/;
// Korean particles that may follow a longer Hangul company name ("삼성전자가", "SK하이닉스의", "현대차측").
const PARTICLE = /^(가|이|은|는|을|를|의|와|과|도|로|에|만|측|에서|으로|까지|부터|보다|처럼|이다|와의|과의)(?![가-힣A-Za-z0-9])/;
export const PROMOTE_PER_PASS = 20, PROMOTE_FOR = 2 * day;

export function ensureMatchTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS dart_stocks(stock_code TEXT PRIMARY KEY,corp_code TEXT NOT NULL,name TEXT NOT NULL,updated_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS issue_matches(signal_url TEXT NOT NULL,company TEXT NOT NULL,job_id TEXT NOT NULL,via TEXT NOT NULL,
      matched_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(signal_url,company,job_id)) STRICT;
    CREATE INDEX IF NOT EXISTS issue_matches_job ON issue_matches(job_id,matched_at);
    CREATE INDEX IF NOT EXISTS issue_matches_expiry ON issue_matches(expires_at)`);
}

// Stock code → filer, learned from DART list.json items of the watched companies (no extra request).
export function learnStockCodes(db, filings, now) {
  ensureMatchTables(db);
  const put = db.prepare('INSERT INTO dart_stocks VALUES (?,?,?,?) ON CONFLICT(stock_code) DO UPDATE SET corp_code=excluded.corp_code,name=excluded.name,updated_at=excluded.updated_at');
  let learned = 0;
  for (const f of filings) if (/^\d{6}$/.test(f.stockCode ?? '') && /^\d{8}$/.test(f.corpCode ?? '') && typeof f.corpName === 'string' && f.corpName.trim()) {
    put.run(f.stockCode, f.corpCode, f.corpName.trim().slice(0, 100), now); learned++;
  }
  return learned;
}

// Company names: catalog entities and DART watched names; company hosts: enabled official sources with one company.
export function buildCompanyIndex(config, corpNames = []) {
  const names = new Set([...(config.catalog?.entities ?? []).map(e => e?.name), ...corpNames].filter(n => typeof n === 'string' && n.trim().length >= 2).map(n => n.trim()));
  const hosts = new Map();
  for (const s of config.sources ?? []) {
    if (s?.kind !== 'OFFICIAL' || s.status !== 'ENABLED' || s.revokedAt || typeof s.host !== 'string') continue;
    if (/(^|\.)dart\.fss\.or\.kr$/.test(s.host) || !names.has(s.name)) continue;
    hosts.set(s.host.toLowerCase().replace(/^www\./, ''), s.name);
  }
  return { names: [...names].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)), hosts };
}

// Names in a headline. A name must not continue a preceding word; Latin names and two-letter Hangul names must also
// end at a word boundary (so "LS" is not read in "LSD" and "대상" not in "대상자"); longer Hangul names may be
// followed only by a boundary or a Korean particle ("삼성전자가", not "삼성전자서비스"). Characters taken by a longer
// name are not reused by a shorter one.
export function namesInTitle(title, names) {
  const text = String(title ?? ''), taken = new Array(text.length).fill(false), found = new Set();
  for (const name of names) {
    const strict = !HANGUL.test(name) || name.length <= 2;
    for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + 1)) {
      const end = i + name.length;
      if (i > 0 && WORD.test(text[i - 1])) continue;
      if (end < text.length && WORD.test(text[end]) && (strict || !PARTICLE.test(text.slice(end)))) continue;
      if (taken.slice(i, end).some(Boolean)) continue;
      for (let k = i; k < end; k++) taken[k] = true;
      found.add(name);
    }
  }
  return [...found];
}

export function matchIssues(db, index, now) {
  ensureMatchTables(db);
  const stocks = new Map(db.prepare('SELECT stock_code,name FROM dart_stocks').all().map(r => [r.stock_code, r.name]));
  // Evidence: queued official jobs of the last 7 days (DART filings and company-site pages), by company.
  const evidence = new Map();
  for (const job of db.prepare(`SELECT j.id,j.url,j.state,j.next_at,j.payload,max(s.last_seen) seen FROM jobs j JOIN sightings s ON s.job_id=j.id
      WHERE j.expires_at>? GROUP BY j.id`).all(now)) {
    let host; try { host = new URL(job.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
    let company = null, via = null;
    if (host === 'dart.fss.or.kr') {
      const title = (() => { try { return String(JSON.parse(job.payload).title ?? ''); } catch { return ''; } })();
      company = index.names.find(n => title.startsWith(n + ' ')) ?? null; via = 'DART';
    } else if (index.hosts.has(host)) { company = index.hosts.get(host); via = 'COMPANY_SITE'; }
    if (!company) continue;
    if (!evidence.has(company)) evidence.set(company, []);
    evidence.get(company).push({ ...job, via });
  }
  const signals = db.prepare(`SELECT url,title,tickers,first_seen published FROM news_signals WHERE first_seen>? AND (sources LIKE '%"gnews:%' OR sources LIKE '%"finlight:%')`).all(now - LOOKBACK);
  const insert = db.prepare('INSERT OR IGNORE INTO issue_matches VALUES (?,?,?,?,?,?)');
  // Jobs matched in the last two days that are ready to run go to the front of their stage (re-applied on each pass,
  // since a stage change resets next_at), at most 20 a pass, newest match first. Older matches age out of the
  // promotion, so unmatched jobs are never held back for long; jobs in a retry or host wait keep their time.
  const promote = db.prepare(`UPDATE jobs SET next_at=0 WHERE id IN (SELECT j.id FROM jobs j JOIN issue_matches m ON m.job_id=j.id
    WHERE m.matched_at>? AND j.next_at<=? AND j.next_at>0 AND j.state IN ('FETCH','TRIAGE','DRAFT','VERIFY')
    GROUP BY j.id ORDER BY max(m.matched_at) DESC,j.id LIMIT ?)`);
  let issues = 0, added = 0, promoted = 0;
  const companies = new Set();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const s of signals) {
      const named = new Set(namesInTitle(s.title, index.names));
      let tickers = []; try { tickers = JSON.parse(s.tickers ?? '[]'); } catch {}
      for (const t of Array.isArray(tickers) ? tickers : []) { const code = /^[A-Z]{2,8}:(\d{6})$/.exec(String(t))?.[1]; if (code && stocks.has(code)) named.add(stocks.get(code)); }
      if (named.size) issues++;
      for (const company of named) {
        for (const job of evidence.get(company) ?? []) {
          if (job.seen < s.published - BEFORE || job.seen > s.published + AFTER) continue;
          const r = insert.run(s.url, company, job.id, job.via, now, now + 30 * day);
          if (r.changes) { added++; companies.add(company); }
        }
      }
    }
    db.prepare('DELETE FROM issue_matches WHERE expires_at<=?').run(now);
    promoted = Number(promote.run(now - PROMOTE_FOR, now, PROMOTE_PER_PASS).changes);
    db.exec('COMMIT');
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  return { signals: signals.length, issues, matches: added, companies: companies.size, promoted };
}

export function matchStatus(db, now) {
  ensureMatchTables(db);
  const row = db.prepare('SELECT count(*) matches,count(DISTINCT signal_url) signals,count(DISTINCT company) companies,count(DISTINCT job_id) jobs FROM issue_matches WHERE expires_at>?').get(now);
  return { ...row, stockCodes: db.prepare('SELECT count(*) n FROM dart_stocks').get().n };
}
