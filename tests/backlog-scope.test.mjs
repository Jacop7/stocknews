import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTriage, validateDraft } from '../workers/ai-processing/runtime/editorial.mjs';
import { writingBrief } from '../workers/ai-processing/runtime/writer.mjs';
import { stamp, url, config, triage, draft, originalText, originalTitle } from './backlog-fixtures.mjs';

// Article scope (2026-11-27): COMPANY issues live on the company page; SECTOR and MACRO issues feed home and sectors.
function setup() {
  const c = config(); c.sources[0].kind = 'OFFICIAL';
  c.catalog.entities.push({ id: 'helios', name: '헬리오스소재' });
  const doc = { id: 'd', title: originalTitle, text: originalText, sources: [{ ...c.sources[0], url }] };
  return { c, doc };
}
const companyTriage = (overrides = {}) => ({ ...triage('d'), articleKind: 'COMPANY', primaryCompanyId: 'orion', ...overrides });

test('a COMPANY issue names its own company and is placed on the company page only', () => {
  const { c, doc } = setup();
  const accepted = validateTriage(companyTriage(), [doc], c.catalog);
  assert.equal(accepted.state, 'RELEVANT');
  const facts = accepted.value.facts;
  const brief = writingBrief({ facts, triage: accepted.value, documents: [doc], catalog: c.catalog, existingIssues: [] });
  assert.equal(brief.primaryCompanyId, 'orion');
  const result = validateDraft(draft(brief), { facts, documents: [doc], triage: accepted.value, catalog: c.catalog, now: stamp });
  assert.equal(result.article_kind, 'COMPANY'); assert.equal(result.placement, 'COMPANY_PAGE');
  assert.equal(result.primary_company_ref, 'orion'); assert.deepEqual(result.company_refs, ['orion']);
  // The company article shows no sector blocks; the impact stays stored for the sector link.
  assert(!result.visible_sections.some(section => section.endsWith('_SECTORS')) && result.impacts.length === 1);
});

test('a COMPANY issue without its company in the event, or with an unknown company, is rejected', () => {
  const { c, doc } = setup();
  assert.throws(() => validateTriage(companyTriage({ primaryCompanyId: null }), [doc], c.catalog), /PRIMARY_COMPANY_REQUIRED/);
  assert.throws(() => validateTriage(companyTriage({ primaryCompanyId: 'helios' }), [doc], c.catalog), /PRIMARY_COMPANY_REQUIRED/);
  assert.throws(() => validateTriage(companyTriage({ sectorIds: [], impacts: [] }), [doc], c.catalog), /KOREAN_ENTITY_REQUIRED/);
});

test('SECTOR and MACRO issues carry no primary company but still link every company with a role', () => {
  const { c, doc } = setup();
  assert.throws(() => validateTriage({ ...triage('d'), primaryCompanyId: 'orion' }, [doc], c.catalog), /PRIMARY_COMPANY_ONLY_FOR_COMPANY_SCOPE/);
  const accepted = validateTriage(triage('d'), [doc], c.catalog);
  const facts = accepted.value.facts;
  const brief = writingBrief({ facts, triage: accepted.value, documents: [doc], catalog: c.catalog, existingIssues: [] });
  const result = validateDraft(draft(brief), { facts, documents: [doc], triage: accepted.value, catalog: c.catalog, now: stamp });
  assert.equal(result.placement, 'FEED'); assert.equal(result.primary_company_ref, null); assert.deepEqual(result.company_refs, ['orion']);
  assert(result.visible_sections.includes('BENEFIT_SECTORS'));
});

// A company issue links another company only when the source names it (no separate display block).
test('a company issue links another company only when a cited fact is about or names it', () => {
  const { c } = setup();
  const contract = '오리온전자는 헬리오스소재와 장비 공급계약을 체결했다고 밝혔다.';
  const doc = { id: 'd', title: originalTitle, text: originalText + ' ' + contract, sources: [{ ...c.sources[0], kind: 'OFFICIAL', url }] };
  const named = companyTriage();
  named.facts.push({ id: 'local-f2', subjectId: 'helios', predicate: 'SUPPLY_CONTRACT', value: 'equipment', unit: '', period: '2026-Q3',
    statement: '헬리오스소재가 장비 공급계약의 상대방이다.', verificationClass: 'ORDINARY_FACT', refs: [{ docId: 'd', quote: contract }] });
  named.event.entityIds = ['orion', 'helios'];
  named.impacts[0] = { ...named.impacts[0], companyIds: ['orion', 'helios'], factIds: ['local-f1', 'local-f2'] };
  const accepted = validateTriage(named, [doc], c.catalog);
  const facts = accepted.value.facts;
  const brief = writingBrief({ facts, triage: accepted.value, documents: [doc], catalog: c.catalog, existingIssues: [] });
  const result = validateDraft(draft(brief), { facts, documents: [doc], triage: accepted.value, catalog: c.catalog, now: stamp });
  assert(!('related_companies' in result) && !result.visible_sections.some(section => section.endsWith('_SECTORS') || section === 'RELATED_COMPANIES'));
  assert.deepEqual(result.company_refs, ['orion', 'helios']);
  // A peer added without a fact about it is rejected.
  const peer = companyTriage(); peer.impacts[0] = { ...peer.impacts[0], companyIds: ['orion', 'helios'] };
  assert.throws(() => validateTriage(peer, [doc], c.catalog), /RELATED_COMPANY_EVIDENCE_REQUIRED/);
});

test('key issues and issue analysis drop inline section labels; risk labels stay', () => {
  const { c, doc } = setup();
  const accepted = validateTriage(triage('d'), [doc], c.catalog);
  const facts = accepted.value.facts;
  const brief = writingBrief({ facts, triage: accepted.value, documents: [doc], catalog: c.catalog, existingIssues: [] });
  const raw = draft(brief);
  raw.key_issues[0].text = '[사실] ' + raw.key_issues[0].text;
  raw.issue_analysis.text = '[분석] ' + raw.issue_analysis.text.replace('확인할 필요가 있습니다.', '확인할 필요가 있습니다. [조건부 예상] 집행되면 개선될 가능성이 있습니다.');
  raw.risks[0].text = '[확인 한계] ' + raw.risks[0].text;
  const result = validateDraft(raw, { facts, documents: [doc], triage: accepted.value, catalog: c.catalog, now: stamp });
  assert(!/\[/.test(result.key_issues[0].text) && !/\[/.test(result.issue_analysis.text));
  assert(result.issue_analysis.text.includes('집행되면 개선될 가능성이 있습니다.'));
  assert(result.risks[0].text.startsWith('[확인 한계] '));
});

test('related sectors are kept only when no clear benefit or damage sector exists', () => {
  const { c, doc } = setup();
  c.catalog.sectors.push({ id: 'materials', name: '소재' });
  const related = { sectorId: 'materials', companyIds: [], direction: 'RELATED', conditionalDirection: 'NEGATIVE', category: 'COST',
    path: '부품 조달 경쟁이 심해지는 경로', conditions: ['부품 공급 부족이 이어지는지 확인'], factIds: ['local-f1'] };
  const mixed = { ...triage('d'), sectorIds: ['semiconductor', 'materials'] }; mixed.impacts = [...mixed.impacts, related];
  assert.deepEqual(validateTriage(mixed, [doc], c.catalog).value.impacts.map(item => item.direction), ['BENEFIT']);
  const onlyRelated = { ...triage('d'), sectorIds: ['materials'] }; onlyRelated.impacts = [related];
  assert.deepEqual(validateTriage(onlyRelated, [doc], c.catalog).value.impacts.map(item => item.direction), ['RELATED']);
});
