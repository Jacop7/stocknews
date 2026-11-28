// Home ranking v2 R1 (docs/home-ranking-v2-plan.md): impact grades and caps, scope ceiling, E institutions,
// freshness, score bounds and the diagnostic preview order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessImpact, scopeCeiling, institutionOf, evidenceScore, freshness, score, rankPreview, band } from '../workers/ai-processing/runtime/ranking.mjs';

const facts = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
const documents = [{ id: 'dart', sources: [{ kind: 'OFFICIAL' }] }, { id: 'news', sources: [{ kind: 'REPORT' }] }];
const factDocs = new Map([['f1', ['dart']], ['f2', ['news']], ['f3', ['news']]]);
const g = (t, s, m, d, ids = ['f1']) => ({ transmission: { grade: t, factIds: ids }, scope: { grade: s, factIds: ids }, magnitude: { grade: m, factIds: ids }, durability: { grade: d, factIds: ids } });
const ok = { transmission: 'SUPPORTED', scope: 'SUPPORTED', magnitude: 'SUPPORTED', durability: 'SUPPORTED' };
const twoSectors = [{ sectorId: 's1', direction: 'BENEFIT', companyIds: ['a', 'b'] }, { sectorId: 's2', direction: 'DAMAGE', companyIds: ['c'] }];
const base = { facts, factDocs, documents, articleKind: 'SECTOR', impacts: twoSectors };

test('impact: weights, bands and the transmission cap of 44', () => {
  const high = assessImpact({ ...base, grades: g(5, 4, 4, 4), support: ok });
  assert.equal(high.rawI, 40 + 16 + 20 + 12); assert.equal(high.band, 'HIGH'); assert.deepEqual(high.caps, []);
  const capped = assessImpact({ ...base, grades: g(2, 4, 5, 5), support: ok });
  assert.equal(capped.rawI, 16 + 16 + 25 + 15); assert.equal(capped.effectiveI, 44); assert.equal(capped.band, 'STANDARD');
  assert.equal(band(75), 'HIGH'); assert.equal(band(74), 'MEDIUM'); assert.equal(band(45), 'MEDIUM'); assert.equal(band(44), 'STANDARD');
});

test('impact: caps only lower — verifier, primary source and scope structure', () => {
  const r = assessImpact({ ...base, grades: g(4, 4, 4, 4, ['f2']), support: { ...ok, transmission: 'UNSUPPORTED' } });
  assert.equal(r.grades.transmission.grade, 2); assert.equal(r.grades.magnitude.grade, 2, 'news-only magnitude'); assert.equal(r.grades.durability.grade, 2);
  assert.equal(r.effectiveI, Math.min(r.rawI, 44));
  const low = assessImpact({ ...base, grades: g(1, 1, 1, 1, ['f2']), support: { transmission: 'UNSUPPORTED', scope: 'UNSUPPORTED', magnitude: 'UNSUPPORTED', durability: 'UNSUPPORTED' } });
  assert.deepEqual([low.grades.transmission.grade, low.grades.scope.grade, low.grades.magnitude.grade], [1, 1, 1], 'never raised');
  assert.deepEqual(low.caps, []);
});

test('impact: invalid grades are rejected', () => {
  assert.throws(() => assessImpact({ ...base, grades: g(6, 1, 1, 1), support: ok }), /IMPACT_GRADE_INVALID/);
  assert.throws(() => assessImpact({ ...base, grades: g(1.5, 1, 1, 1), support: ok }), /IMPACT_GRADE_INVALID/);
  assert.throws(() => assessImpact({ ...base, grades: g(3, 1, 1, 1, ['zz']), support: ok }), /IMPACT_GRADE_FACT_UNKNOWN/);
  assert.throws(() => assessImpact({ ...base, grades: g(3, 1, 1, 1, ['f1', 'f1']), support: ok }), /IMPACT_GRADE_FACT_UNKNOWN/);
  assert.throws(() => assessImpact({ ...base, grades: g(3, 1, 1, 1, []), support: ok }), /IMPACT_GRADE_EVIDENCE_REQUIRED/);
  assert.throws(() => assessImpact({ ...base, grades: g(3, 1, 1, 1), support: { ...ok, scope: 'MAYBE' } }), /IMPACT_SUPPORT_INVALID/);
});

test('scope ceiling: single company, one sector, overlapping and independent sectors, MACRO', () => {
  const c = impacts => scopeCeiling({ articleKind: 'SECTOR', impacts });
  assert.equal(c([]), 0);
  assert.equal(c([{ sectorId: 's1', direction: 'BENEFIT', companyIds: ['a'] }, { sectorId: 's2', direction: 'BENEFIT', companyIds: ['a'] }]), 1);
  assert.equal(c([{ sectorId: 's1', direction: 'BENEFIT', companyIds: ['a', 'b'] }]), 3);
  assert.equal(c([{ sectorId: 's1', direction: 'BENEFIT', companyIds: ['a', 'b'] }, { sectorId: 's2', direction: 'BENEFIT', companyIds: ['a', 'b'] }]), 3, 'overlapping sectors');
  assert.equal(c(twoSectors), 4);
  assert.equal(c([{ sectorId: 's1', direction: 'RELATED', companyIds: ['a', 'b'] }]), 0, 'conditional impacts do not count');
  assert.equal(scopeCeiling({ articleKind: 'MACRO', impacts: [], macroPrimary: false, scopeSupported: true }), 3);
  assert.equal(scopeCeiling({ articleKind: 'MACRO', impacts: [], macroPrimary: true, scopeSupported: true }), 5);
  const r = assessImpact({ ...base, impacts: [{ sectorId: 's1', direction: 'BENEFIT', companyIds: ['a'] }], grades: g(3, 3, 1, 1), support: ok });
  assert.equal(r.grades.scope.grade, 1); assert.deepEqual(r.caps, [{ dimension: 'scope', reason: 'SCOPE_STRUCTURE' }]);
});

test('E institutions: per source, company DART and site are one, unknown and ambiguous names do not count', () => {
  const config = { catalog: { entities: [{ id: 'c-sk', name: 'SK하이닉스' }, { id: 'c-3b', name: '쓰리빌리언' }, { id: 'c-ls', name: 'LS' }, { id: 'c-ls2', name: 'LS' }] },
    sources: [{ host: 'news.skhynix.co.kr', name: 'SK하이닉스', kind: 'OFFICIAL', status: 'ENABLED' }, { host: 'www.skhynix.com', name: 'SK하이닉스', kind: 'OFFICIAL', status: 'ENABLED' },
      { host: 'ls.example.com', name: 'LS', kind: 'OFFICIAL', status: 'ENABLED' }, { host: 'noname.example.com', kind: 'OFFICIAL', status: 'ENABLED' },
      { host: 'off.example.com', name: '쓰리빌리언', kind: 'OFFICIAL', status: 'DISABLED' }, { host: 'www.korea.kr', name: '정책브리핑', kind: 'OFFICIAL', status: 'ENABLED' }] };
  const at = (url, title = '') => institutionOf({ url }, { title }, config);
  assert.equal(at('https://dart.fss.or.kr/x?rcpNo=1', 'SK하이닉스 단일판매'), 'company:c-sk');
  assert.equal(at('https://news.skhynix.co.kr/a'), 'company:c-sk'); assert.equal(at('https://www.skhynix.com/b'), 'company:c-sk');
  assert.equal(at('https://dart.fss.or.kr/x', '없는회사 공시'), null);
  assert.equal(at('https://ls.example.com/a'), null, 'name of two catalog entities');
  assert.equal(at('https://dart.fss.or.kr/x', 'LS 공시'), null, 'DART title naming two catalog entities');
  assert.equal(at('https://noname.example.com/a'), null); assert.equal(at('https://off.example.com/a'), null);
  assert.equal(at('https://www.korea.kr/a'), null, 'OFFICIAL outside GOV_HOSTS is not government');
  assert.equal(evidenceScore(['company:c-sk', 'company:c-sk', null]), 0.5);
  assert.equal(evidenceScore(['company:c-sk', 'company:c-3b']), 1); assert.equal(evidenceScore([]), 0);
});

test('score: inputs and result in range, HIGH and ordinary formulas', () => {
  assert.equal(score({ band: 'HIGH', effectiveI: 100, E: 1, F: 1 }), 100);
  assert.equal(score({ band: 'MEDIUM', effectiveI: 60, E: 0.5, F: 0.5 }), 57);
  assert.throws(() => score({ band: 'MEDIUM', effectiveI: 120, E: 0, F: 0 }), /RANK_INPUT_INVALID:I/);
  assert.throws(() => score({ band: 'MEDIUM', effectiveI: 50, E: 2, F: 0 }), /RANK_INPUT_INVALID:E/);
  assert.equal(freshness(0, 6 * 3600_000), 0.5); assert.equal(freshness(10, 0), 1, 'future change clamps to 1');
});

test('preview: band first, missing I last, COMPANY excluded, one card per Story, ties by id', () => {
  const now = Date.parse('2026-11-28T06:00:00Z');
  const a = (id, story, b, i, extra = {}) => ({ id, storyKey: story, articleKind: 'SECTOR', title: id, institutions: [], changedAt: now, assessment: b ? { band: b, effectiveI: i } : null, ...extra });
  const r = rankPreview([a('m1', 's1', 'MEDIUM', 60), a('h1', 's2', 'HIGH', 80), a('x0', 's3', null), a('st', 's4', 'STANDARD', 40),
    a('h2', 's2', 'MEDIUM', 70), a('co', 's5', 'HIGH', 90, { articleKind: 'COMPANY' }), a('m0', 's6', 'MEDIUM', 60)], now);
  assert.deepEqual(r.ranked.map(x => x.id), ['h1', 'm0', 'm1', 'st', 'x0']);
  assert.deepEqual(r.sameStory.map(x => x.id), ['h2']);
  assert.equal(r.diagnostic, true);
});

test('assessment is independent of fact, document and impact order', () => {
  const a = assessImpact({ ...base, grades: g(4, 4, 3, 3, ['f2', 'f1']), support: ok });
  const b = assessImpact({ ...base, facts: [...facts].reverse(), documents: [...documents].reverse(), impacts: [...twoSectors].reverse(),
    factDocs: new Map([...factDocs].reverse()), grades: g(4, 4, 3, 3, ['f1', 'f2']), support: ok });
  assert.deepEqual(a, b);
});

test('five-point difference boundary inside HIGH', () => {
  assert.equal(score({ band: 'HIGH', effectiveI: 81.25, E: 0, F: 0 }) - score({ band: 'HIGH', effectiveI: 75, E: 0, F: 0 }), 5);
});
