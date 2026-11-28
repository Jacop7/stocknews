// Issue → evidence matching (2026-11-28): news-API company issues (Finlight tickers, headline names) are matched to
// that company's queued DART filings and company-site pages; matched jobs go first; nothing is fetched or queued.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { buildCompanyIndex, learnStockCodes, matchIssues, matchStatus, namesInTitle } from '../workers/ai-processing/runtime/evidence-match.mjs';

const NOW = Date.parse('2026-11-28T05:00:00Z'), day = 86400000;
const config = { catalog: { entities: ['SK하이닉스', '삼성전자', '삼성전자우', '대상', 'LS', 'LS ELECTRIC', '쓰리빌리언', '기아'].map(name => ({ id: name, name })) },
  sources: [{ host: 'news.skhynix.co.kr', name: 'SK하이닉스', kind: 'OFFICIAL', status: 'ENABLED', revokedAt: null },
    { host: '3billion.io', name: '쓰리빌리언', kind: 'OFFICIAL', status: 'ENABLED', revokedAt: null },
    { host: 'off.example.com', name: '기아', kind: 'OFFICIAL', status: 'DISABLED', revokedAt: null },
    { host: 'dart.fss.or.kr', name: 'DART 전자공시', kind: 'OFFICIAL', status: 'ENABLED', revokedAt: null }] };

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'em-'));
  const store = new BacklogStore(join(dir, 'p.sqlite'));
  return Promise.resolve(fn(store)).finally(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
}

test('headline names: longest name wins, short and Latin names need word boundaries', () => {
  const { names } = buildCompanyIndex(config);
  assert.deepEqual(namesInTitle('삼성전자우 급등, SK하이닉스가 HBM 공급', names).sort(), ['SK하이닉스', '삼성전자우']);
  assert.deepEqual(namesInTitle('지원 대상자 확대', names), [], 'two-letter Hangul name inside a word');
  assert.deepEqual(namesInTitle('대상, 3분기 실적', names), ['대상']);
  assert.deepEqual(namesInTitle('LSD 논란 / LS ELECTRIC 수주', names), ['LS ELECTRIC']);
  assert.deepEqual(namesInTitle('KLS 기아차', names), [], 'Latin name inside a word; 기아 followed by a Hangul letter');
});

test('company index: enabled single-company hosts only, DART web excluded', () => {
  const { hosts } = buildCompanyIndex(config);
  assert.deepEqual([...hosts], [['news.skhynix.co.kr', 'SK하이닉스'], ['3billion.io', '쓰리빌리언']]);
});

test('a news issue matches DART and company-site evidence in the window, promotes ready jobs, and counts once', () => withStore(store => {
  const seen = NOW - day;
  store.importLinks([
    { sourceId: 'dart:list', url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261127000001', title: 'SK하이닉스 단일판매ㆍ공급계약체결', lastSeen: seen, expiresAt: NOW + 6 * day },
    { sourceId: 'company:news.skhynix.co.kr', url: 'https://news.skhynix.co.kr/press/1', title: 'HBM4', lastSeen: seen, expiresAt: NOW + 6 * day },
    { sourceId: 'company:3billion.io', url: 'https://3billion.io/news/9', title: '공시', lastSeen: seen, expiresAt: NOW + 6 * day },
    { sourceId: 'channel-a', url: 'https://www.example.com/a', title: 'SK하이닉스 소식', lastSeen: seen, expiresAt: NOW + 6 * day }], seen);
  // Finlight: ticker only (title without the name); the stock code is learned from a DART list item.
  assert.equal(learnStockCodes(store.db, [{ corpCode: '00164779', corpName: 'SK하이닉스', stockCode: '000660' }, { corpCode: '1', corpName: 'x', stockCode: '' }], NOW), 1);
  store.recordNewsSignals([
    { sourceId: 'finlight:kr', url: 'https://www.yna.co.kr/view/1', title: '메모리 수요 급증', tickers: ['XKRX:000660'], lastSeen: NOW - 3600000, expiresAt: NOW + 7 * day },
    { sourceId: 'gnews:kr', url: 'https://www.hankyung.com/a', title: '쓰리빌리언, 신규 계약', lastSeen: NOW - 3600000, expiresAt: NOW + 7 * day },
    { sourceId: 'gnews:kr', url: 'https://www.hankyung.com/old', title: 'SK하이닉스 과거 기사', lastSeen: NOW - 3 * day, expiresAt: NOW + 7 * day }], NOW);
  const index = buildCompanyIndex(config, ['SK하이닉스']);
  const r = matchIssues(store.db, index, NOW);
  assert.deepEqual(r, { signals: 2, issues: 2, matches: 3, companies: 2, promoted: 3 });
  const rows = store.db.prepare('SELECT signal_url,company,via FROM issue_matches ORDER BY company,via').all().map(x => ({ ...x }));
  assert.deepEqual(rows, [
    { signal_url: 'https://www.yna.co.kr/view/1', company: 'SK하이닉스', via: 'COMPANY_SITE' },
    { signal_url: 'https://www.yna.co.kr/view/1', company: 'SK하이닉스', via: 'DART' },
    { signal_url: 'https://www.hankyung.com/a', company: '쓰리빌리언', via: 'COMPANY_SITE' }]);
  assert.equal(store.db.prepare("SELECT next_at FROM jobs WHERE url='https://www.example.com/a'").get().next_at, seen, 'unmatched job keeps its place');
  assert.equal(store.claim(NOW).url.includes('example.com'), false, 'a matched job is claimed first');
  const again = matchIssues(store.db, index, NOW + 60000);
  assert.equal(again.matches, 0, 'no duplicate matches');
  assert.equal(store.db.prepare('SELECT count(*) n FROM jobs').get().n, 4, 'nothing new is queued');
  assert.deepEqual({ ...matchStatus(store.db, NOW) }, { matches: 3, signals: 2, companies: 2, jobs: 3, stockCodes: 1 });
}));

test('evidence outside the window and jobs in a retry wait are not promoted', () => withStore(store => {
  store.importLinks([{ sourceId: 'company:3billion.io', url: 'https://3billion.io/news/1', title: 't', lastSeen: NOW - 5 * day, expiresAt: NOW + 2 * day },
    { sourceId: 'company:3billion.io', url: 'https://3billion.io/news/2', title: 't', lastSeen: NOW, expiresAt: NOW + 2 * day }], NOW);
  store.db.prepare("UPDATE jobs SET next_at=? WHERE url='https://3billion.io/news/2'").run(NOW + 3600000);
  store.db.prepare("UPDATE sightings SET last_seen=? WHERE job_id=(SELECT id FROM jobs WHERE url='https://3billion.io/news/1')").run(NOW - 5 * day);
  store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://www.mk.co.kr/a', title: '쓰리빌리언 실적', lastSeen: NOW, expiresAt: NOW + 7 * day }], NOW);
  const r = matchIssues(store.db, buildCompanyIndex(config), NOW);
  assert.equal(r.matches, 1); assert.equal(r.promoted, 0);
  assert.equal(store.db.prepare("SELECT next_at FROM jobs WHERE url='https://3billion.io/news/2'").get().next_at, NOW + 3600000);
}));

test('per-source status: 24-hour counts for each source, read only, no URLs', async () => {
  const { sourceStatus } = await import('../workers/ai-processing/runtime/news-report.mjs');
  await withStore(store => {
    store.importLinks([{ sourceId: 'dart:list', url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261128000001', title: 'x', lastSeen: NOW, expiresAt: NOW + day },
      { sourceId: 'company:3billion.io', url: 'https://3billion.io/n/1', title: 'x', lastSeen: NOW, expiresAt: NOW + day },
      { sourceId: 'channel-a', url: 'https://www.example.com/t1', title: 'x', lastSeen: NOW, expiresAt: NOW + day }], NOW);
    store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://www.mk.co.kr/a', title: 'a', lastSeen: NOW, expiresAt: NOW + day },
      { sourceId: 'finlight:kr', url: 'https://www.yna.co.kr/a', title: 'b', tickers: ['XKRX:000660'], lastSeen: NOW, expiresAt: NOW + day }], NOW);
    const s = sourceStatus(store.db, NOW + 1000);
    assert.deepEqual({ g: s.gnews.signals24h, o: s.gnews.outlets30d, f: s.finlight.signals24h, t: s.finlight.withTickers24h, d: s.dart.filings24h, c: s.companySites.links24h, tg: s.savedLinks.links24h, web: s.webNews },
      { g: 1, o: 1, f: 1, t: 1, d: 1, c: 1, tg: 1, web: 'OFF' });
    assert.ok(!JSON.stringify(s).includes('https://'));
  });
});

test('longer Hangul names: only a boundary or a Korean particle may follow', () => {
  const { names } = buildCompanyIndex(config);
  assert.deepEqual(namesInTitle('삼성전자서비스 파업', names), [], 'another company that starts with the name');
  assert.deepEqual(namesInTitle('쓰리빌리언의 계약, SK하이닉스에서 발표', names).sort(), ['SK하이닉스', '쓰리빌리언']);
  assert.deepEqual(namesInTitle('쓰리빌리언측 "사실무근"', names), ['쓰리빌리언']);
});

test('promotion: at most 20 a pass, newest match first, and matches older than two days no longer promote', () => withStore(store => {
  const links = Array.from({ length: 25 }, (_, i) => ({ sourceId: 'company:3billion.io', url: `https://3billion.io/n/${i}`, title: 't', lastSeen: NOW, expiresAt: NOW + 6 * day }));
  store.importLinks(links, NOW);
  store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://www.mk.co.kr/a', title: '쓰리빌리언 계약', lastSeen: NOW, expiresAt: NOW + 7 * day }], NOW);
  const index = buildCompanyIndex(config);
  const first = matchIssues(store.db, index, NOW);
  assert.equal(first.matches, 25); assert.equal(first.promoted, 20);
  assert.equal(matchIssues(store.db, index, NOW + 1000).promoted, 5, 'the rest on the next pass');
  store.db.prepare('UPDATE jobs SET next_at=?').run(NOW);
  assert.equal(matchIssues(store.db, index, NOW + 3 * day).promoted, 0, 'aged out');
  assert.match(store.db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM issue_matches WHERE expires_at<=?').all(NOW).map(r => r.detail).join(' '), /issue_matches_expiry/);
}));

test('the GNews outlet ledger is seeded from held GNews signals on the first open after the upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'em-')), file = join(dir, 'p.sqlite');
  try {
    let store = new BacklogStore(file);
    store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://www.mk.co.kr/a', title: 'a', lastSeen: NOW, expiresAt: NOW + 7 * day },
      { sourceId: 'finlight:kr', url: 'https://www.fl.example.com/a', title: 'b', lastSeen: NOW, expiresAt: NOW + 7 * day }], NOW);
    store.db.exec('DROP TABLE news_outlets'); store.close();
    store = new BacklogStore(file);
    try { assert.deepEqual(store.db.prepare('SELECT domain FROM news_outlets').all().map(r => r.domain), ['mk.co.kr']); }
    finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
