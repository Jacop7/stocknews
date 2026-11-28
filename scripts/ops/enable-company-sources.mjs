// Enables every company website candidate (press releases, newsroom and IR pages) in the AI processor config
// (.local-data/ai/config.json), as the owner decided on 2026-11-28: "기업 사이트 다 켜줘 기업에서 홍보하라고 하는거니까".
// Not enabled: government sites, SEC and the DART website (robots-denied; DART stays API-only). Access stays polite:
// robots.txt is honoured per request (runtime/original.mjs), same-host pacing applies, nothing is published from the
// original text (publicationAuthorized stays false; facts and short quotes only, 7-day original retention).
//   Usage: node scripts/ops/enable-company-sources.mjs [--dry-run]
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../../.local-data/ai/config.json', import.meta.url);
const config = JSON.parse(readFileSync(file, 'utf8'));
const NOT_COMPANY = [/(^|\.)go\.kr$/, /(^|\.)sec\.gov$/, /(^|\.)dart\.fss\.or\.kr$/];
const VERSION = 'approved-company-20261128';
const EVIDENCE = 'USER_APPROVED_20261128: 기업 공식 사이트(보도자료·뉴스룸·IR)는 기업이 공개 홍보용으로 게시한 자료라 전체 허가(사용자 지시 "기업 사이트 다 켜줘"). robots.txt 준수, 같은 호스트 방문 간격 유지, 내부 분석 근거용(사실·짧은 인용), 원문 7일 보관, 게시·재배포 권한 아님.';
let enabled = 0, skipped = [];
for (const source of config.sources) {
  if (source.kind !== 'OFFICIAL' || source.status === 'ENABLED') continue;
  if (NOT_COMPANY.some(re => re.test(source.host))) { skipped.push(source.host); continue; }
  Object.assign(source, { status: 'ENABLED', version: VERSION, evidence: [EVIDENCE], provenanceVerified: true, revokedAt: null });
  enabled++;
}
if (!process.argv.includes('--dry-run')) writeFileSync(file, JSON.stringify(config, null, 1) + '\n');
console.log(JSON.stringify({ enabled, skipped, totalOfficialEnabled: config.sources.filter(s => s.kind === 'OFFICIAL' && s.status === 'ENABLED').length, dryRun: process.argv.includes('--dry-run') }));
