// Builds DISABLED source-grant candidates for the AI original-reading stage, for human review.
// Inputs: per-host link counts from the collector, and company press/IR hosts from the company sheet.
// Nothing is enabled and no publisher permission is claimed: every entry is DISABLED with review pending.
// Usage: node scripts/backlog-source-candidates.mjs --hosts FILE.json --companies FILE.tsv --out FILE.json [--summary FILE.md]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../workers/ai-processing/runtime/contracts.mjs';

// Short links and aggregator redirects: a grant on these hosts does not make the original readable,
// because the reader also needs a grant for the destination host. They need a separate resolution step.
export const REDIRECT_HOSTS = new Set(['buly.kr', 'tinyurl.com', 'han.gl', 'vo.la', 'naver.me', 'bit.ly', 'alie.kr', 't.co',
  'url.kr', 'me2.do', 'goo.gl', 'lrl.kr', 'abit.ly', 'vvd.bz', 'buff.ly', 'ow.ly', 'is.gd', 'rb.gy', 'cutt.ly', 'shorturl.at',
  'news.google.com', 'lnkd.in', 'flip.it', 'apple.news', 'msn.com', 'feedproxy.google.com', 'da.gd', 'zrr.kr', 'han.gl', 'muz.so', 'c11.kr', 'wo.to']);
// Not article sources (shops, video, social, app stores).
export const IRRELEVANT = [/^amazon\./, /\.amazon\./, /coupang\.com$/, /youtube\.com$/, /^youtu\.be$/, /instagram\.com$/, /facebook\.com$/,
  /^x\.com$/, /twitter\.com$/, /apps\.apple\.com$/, /play\.google\.com$/, /aliexpress\.com$/];
// Broker and independent research report hosts: REPORT, even when the broker also has an IR page.
export const REPORT_HOSTS = new Set(['report.jayjoai.com', 'r.jayjoai.com', 'bbn.kiwoom.com', 'iprovest.com', 'securities.miraeasset.com',
  'hanwhawm.com', 'research.ibk.co.kr', 'myasset.com', 'm.ibks.com', 'yuantakorea.com', 'kiwoom.com', 'm.nhsec.com']);
const OFFICIAL_PATTERNS = [/^dart\.fss\.or\.kr$/, /^kind\.krx\.co\.kr$/, /(^|\.)sec\.gov$/, /\.go\.kr$/, /(^|\.)fss\.or\.kr$/, /(^|\.)krx\.co\.kr$/];

const bare = host => host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
const within = (host, domain) => host === domain || host.endsWith('.' + domain);

export function readCompanyHosts(tsv) {
  const map = new Map();
  for (const line of tsv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [host, kinds, companies] = line.split('\t');
    assert(host && kinds && companies, 'INVALID_COMPANY_ROW');
    map.set(bare(host), { kinds: kinds.split(','), companies: companies.split(',') });
  }
  return map;
}

export function classify(host, { companies, excludedDomains }) {
  const h = bare(host);
  if (REDIRECT_HOSTS.has(h)) return { category: 'REDIRECT', name: '단축·리디렉션' };
  if (IRRELEVANT.some(pattern => pattern.test(h))) return { category: 'IRRELEVANT', name: '무관' };
  if (excludedDomains.some(domain => within(h, bare(domain)))) return { category: 'EXCLUDED', name: '제외 매체' };
  if (REPORT_HOSTS.has(h)) return { category: 'CANDIDATE', kind: 'REPORT', name: companies.get(h)?.companies[0] ?? h };
  if (companies.has(h)) return { category: 'CANDIDATE', kind: 'OFFICIAL', name: companies.get(h).companies.join('·') };
  if (OFFICIAL_PATTERNS.some(pattern => pattern.test(h))) return { category: 'CANDIDATE', kind: 'OFFICIAL', name: h };
  return { category: 'CANDIDATE', kind: 'NEWS', name: h };
}

const grant = (host, kind, name) => ({
  host, id: 'candidate-' + host.replace(/[^a-z0-9]+/g, '-'), version: 'candidate-20261126', name, status: 'DISABLED', kind,
  basis: 'EXPLICIT_INTERNAL_REVIEW', publicationAuthorized: false,
  evidence: ['REVIEW_PENDING: generated candidate; enable only after reviewing this publisher\'s terms and access rules'],
  expiresAt: null, revokedAt: null, retentionDays: 7, provenanceVerified: false, originGroupId: null, newsroomId: null, ownerGroupId: null,
});

export function buildCandidates({ hostCounts, companies, excludedDomains }) {
  const groups = { REDIRECT: [], IRRELEVANT: [], EXCLUDED: [], CANDIDATE: [] };
  const seen = new Set([...Object.keys(hostCounts).map(bare), ...companies.keys()]);
  for (const host of [...seen].sort()) {
    const counts = hostCounts[host] ?? hostCounts['www.' + host] ?? { telegram: 0, web: 0 };
    const links = (counts.telegram ?? 0) + (counts.web ?? 0);
    const result = classify(host, { companies, excludedDomains });
    groups[result.category].push({ host, links, ...result });
  }
  for (const list of Object.values(groups)) list.sort((a, b) => b.links - a.links || a.host.localeCompare(b.host, 'en'));
  // Grants match the exact hostname, so each candidate also gets its www. form (both disabled).
  const sources = groups.CANDIDATE.flatMap(item => [grant(item.host, item.kind, item.name), grant('www.' + item.host, item.kind, item.name)]);
  return { groups, sources };
}

export function summaryMarkdown({ groups }, generatedAt) {
  const total = list => list.reduce((sum, item) => sum + item.links, 0);
  const byKind = kind => groups.CANDIDATE.filter(item => item.kind === kind);
  const table = (rows, limit) => ['| 사이트 | 수집 링크 | 이름 |', '|---|---:|---|',
    ...rows.slice(0, limit).map(item => `| ${item.host} | ${item.links} | ${item.name} |`)].join('\n');
  return `# 원문 접근 허가 후보 (검토용)

생성: ${generatedAt}. 모든 후보는 \`DISABLED\`이며 출처 이용 허가를 뜻하지 않는다. 검토한 사이트만 \`ENABLED\`로 바꾸고 \`evidence\`에 검토 근거(약관·robots·접근 방식)를 적는다. 후보 파일: worktree의 \`.local-data/backlog/source-candidates.json\`(git 제외).

| 구분 | 사이트 수 | 수집 링크 |
|---|---:|---:|
| 공식(회사 보도자료·IR·DART·정부) | ${byKind('OFFICIAL').length} | ${total(byKind('OFFICIAL'))} |
| 리포트(증권사·리서치) | ${byKind('REPORT').length} | ${total(byKind('REPORT'))} |
| 뉴스 | ${byKind('NEWS').length} | ${total(byKind('NEWS'))} |
| 단축 주소·리디렉션(허가 대상 아님) | ${groups.REDIRECT.length} | ${total(groups.REDIRECT)} |
| 제외 매체(기존 결정) | ${groups.EXCLUDED.length} | ${total(groups.EXCLUDED)} |
| 무관(쇼핑·영상·SNS) | ${groups.IRRELEVANT.length} | ${total(groups.IRRELEVANT)} |

## 우선 검토 권장: 링크가 많은 뉴스·리포트

${table([...byKind('NEWS'), ...byKind('REPORT')].sort((a, b) => b.links - a.links), 25)}

## 공식 출처 중 실제 링크가 모인 곳

${table(byKind('OFFICIAL').filter(item => item.links > 0), 25)}

나머지 공식 후보 ${byKind('OFFICIAL').filter(item => item.links === 0).length}곳은 기업 시트의 보도자료·IR 주소로, 아직 수집 링크는 없지만 근거 매칭용이다.

## 단축 주소·리디렉션

${table(groups.REDIRECT, 15)}

텔레그램 링크의 상당수가 단축 주소다. 허가는 최종 목적지 사이트 기준이므로, 단축 주소를 원 주소로 풀어 주는 별도 단계가 있어야 이 링크들을 처리할 수 있다.
`;
}

function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) options[argv[index]] = argv[index + 1];
  assert(options['--hosts'] && options['--companies'] && options['--out'], 'USAGE: --hosts FILE --companies FILE --out FILE [--summary FILE]');
  const example = JSON.parse(readFileSync(new URL('../workers/ai-processing/runtime/config.example.json', import.meta.url), 'utf8'));
  const result = buildCandidates({ hostCounts: JSON.parse(readFileSync(resolve(options['--hosts']), 'utf8')),
    companies: readCompanyHosts(readFileSync(resolve(options['--companies']), 'utf8')), excludedDomains: example.excludedDomains });
  // Every generated entry must pass the runtime config contract. The live config holds at most 500 sources
  // (only reviewed ones are copied there), so the full review list is checked in batches.
  for (let index = 0; index < result.sources.length; index += 500) validateConfig({ ...example, sources: result.sources.slice(index, index + 500) });
  writeFileSync(resolve(options['--out']), JSON.stringify({ generatedAt: new Date().toISOString(), sources: result.sources, groups: result.groups }, null, 2));
  if (options['--summary']) writeFileSync(resolve(options['--summary']), summaryMarkdown(result, new Date().toISOString().slice(0, 10)));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result.groups).map(([key, list]) => [key, list.length])), null, 0), 'sources=' + result.sources.length);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
