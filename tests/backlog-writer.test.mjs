import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createBacklogProcessor } from '../workers/ai-processing/runtime/pipeline.mjs';
import { validateTriage, validateDraft, validateVerification } from '../workers/ai-processing/runtime/editorial.mjs';
import { factProvenance, writingBrief, DISCLAIMER } from '../workers/ai-processing/runtime/writer.mjs';
import { stamp, url, config, triage, draft, verification, original, originalText, originalTitle, quote } from './backlog-fixtures.mjs';

const day = 86_400_000;
function context(kind = 'NEWS') {
  const c = config(); c.sources[0].kind = kind;
  const doc = { id: 'd', title: originalTitle, text: originalText, sources: [{ ...c.sources[0], url }] };
  const accepted = validateTriage(triage('d'), [doc], c.catalog);
  const facts = accepted.value.facts;
  const brief = writingBrief({ facts, triage: accepted.value, documents: [doc], catalog: c.catalog, existingIssues: [] });
  return { brief, raw: draft(brief), check: { facts, documents: [doc], triage: accepted.value, catalog: c.catalog, now: stamp } };
}

test('the writer is dispatched with verified facts only: no original title, body or evidence quote', async t => {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  const settings = config(); const inputs = {};
  const processor = createBacklogProcessor({ store, loadConfig: () => settings, now: () => stamp,
    readOriginal: async request => original(originalText, request.url),
    model: async request => {
      inputs[request.stage] = JSON.stringify(request.input);
      if (request.stage === 'triage') return triage(request.input.document.id);
      if (request.stage === 'draft') return draft(request.input);
      return verification(request.input);
    } });
  store.importLinks([{ url, sourceId: 'channel-one', lastSeen: stamp, expiresAt: stamp + 7 * day }], stamp);
  const states = []; for (let index = 0; index < 4; index++) states.push((await processor.step()).state);
  assert.deepEqual(states, ['TRIAGE', 'DRAFT', 'VERIFY', 'DRAFT_READY']);
  for (const fragment of [quote, originalTitle, '가상 시험 자료다', '"refs"', '"quote"', '"originals"']) assert(!inputs.draft.includes(fragment), fragment);
  // The independent verifier still compares against the originals.
  assert(inputs.verify.includes(quote) && inputs.verify.includes('"originals"'));
  const brief = JSON.parse(inputs.draft);
  assert.deepEqual(brief.facts.map(fact => [fact.provenance, fact.attributions]), [['REPORTED', ['가상경제신문']]]);
  const saved = JSON.parse(store.db.prepare('SELECT payload FROM issues').get().payload);
  assert.equal(saved.disclaimer, DISCLAIMER); assert(saved.visible_sections.includes('DISCLAIMER'));
  assert.deepEqual(saved.source_refs.map(source => [source.role, source.url]), [['REPORTED', url]]);
});

test('company and regulator originals are PRIMARY; newsroom-only facts are REPORTED with their names', () => {
  const doc = kind => ({ id: 'd', sources: [{ kind, provenanceVerified: true, name: kind === 'NEWS' ? '가상경제신문' : undefined, host: 'ir.example.co.kr' }] });
  const fact = { refs: [{ docId: 'd', quote }] };
  assert.deepEqual(factProvenance(fact, [doc('OFFICIAL')]), { provenance: 'PRIMARY', attributions: [] });
  assert.deepEqual(factProvenance(fact, [doc('NEWS')]), { provenance: 'REPORTED', attributions: ['가상경제신문'] });
  assert.deepEqual(factProvenance(fact, [doc('REPORT')]), { provenance: 'REPORTED', attributions: ['ir.example.co.kr'] });
  const { check } = context('OFFICIAL');
  const raw = draft(writingBrief({ ...check, existingIssues: [] }));
  raw.key_issues[0].text = '회사 공시로 확인되는 변화를 점검합니다.';
  assert.equal(validateDraft(raw, check).source_refs[0].role, 'PRIMARY');
});

test('reported facts must name their source in key issues and analysis', () => {
  const { raw, check } = context();
  assert.ok(validateDraft(raw, check));
  const bad = structuredClone(raw); bad.key_issues[0].text = '회사 계획에서 확인되는 변화를 점검합니다.';
  assert.throws(() => validateDraft(bad, check), /REPORTED_FACT_UNATTRIBUTED/);
  const analysis = structuredClone(raw); analysis.issue_analysis.text = '한국 장비 업체에 전달되는 경로를 확인할 필요가 있습니다.';
  assert.throws(() => validateDraft(analysis, check), /REPORTED_FACT_UNATTRIBUTED/);
});

test('assertive or advisory wording is rejected; hedged candidate wording passes', () => {
  const { raw, check } = context();
  for (const phrase of ['양산 능력을 갖춘 업체가 곧 수혜 기업이 된다.', '반드시 오를 것이다.', '매수를 추천한다.', '목표가를 올린다.', '주가가 급등할 것이다.']) {
    const bad = structuredClone(raw); bad.scenarios[0].expected_result = phrase;
    assert.throws(() => validateDraft(bad, check), /ASSERTIVE_INVESTMENT_WORDING/, phrase);
  }
  const hedged = structuredClone(raw); hedged.scenarios[0].expected_result = '장비 업체가 수혜 후보로 거론될 가능성이 있습니다.';
  assert.ok(validateDraft(hedged, check));
});

test('every linked company needs exactly one business-role reason', () => {
  const { raw, check } = context();
  const missing = structuredClone(raw); missing.impacts[0].companyRoles = [];
  assert.throws(() => validateDraft(missing, check), /COMPANY_ROLE_REQUIRED/);
  const nameOnly = structuredClone(raw); nameOnly.impacts[0].companyRoles[0].role = '오리온전자';
  assert.throws(() => validateDraft(nameOnly, check), /COMPANY_ROLE_REQUIRED/);
  const twice = structuredClone(raw); twice.impacts[0].companyRoles.push({ ...twice.impacts[0].companyRoles[0] });
  assert.throws(() => validateDraft(twice, check), /COMPANY_ROLE_REQUIRED/);
  const invented = structuredClone(raw); invented.impacts[0].companyRoles[0].role = '장비 99대 발주 주체';
  assert.throws(() => validateDraft(invented, check), /DRAFT_NUMBER_MISMATCH/);
});

test('derived numbers appear only as system-rendered calculations over cited fact values', () => {
  const { raw, check } = context();
  const factId = check.facts[0].id;
  const direct = structuredClone(raw); direct.risks[0].text = '합산하면 40% 변화입니다.';
  assert.throws(() => validateDraft(direct, check), /DRAFT_NUMBER_MISMATCH/);
  const ok = structuredClone(raw);
  ok.calculations = [{ id: 'c1', expression: '20 + 20', result: '40', unit: '%p', factIds: [factId] }];
  ok.risks[0].text = '두 차례 같은 폭이면 누적 {{calc:c1}} 수준입니다.';
  const value = validateDraft(ok, check);
  assert.equal(value.risks[0].text, '두 차례 같은 폭이면 누적 40%p(20 + 20로 계산) 수준입니다.');
  const wrong = structuredClone(ok); wrong.calculations[0].result = '41';
  assert.throws(() => validateDraft(wrong, check), /CALCULATION_RESULT_MISMATCH/);
  const unsupported = structuredClone(ok); unsupported.calculations[0].expression = '20 × 3'; unsupported.calculations[0].result = '60';
  assert.throws(() => validateDraft(unsupported, check), /CALCULATION_OPERAND_UNSUPPORTED/);
  const unknown = structuredClone(ok); unknown.risks[0].text = '누적 {{calc:c9}} 수준입니다.';
  assert.throws(() => validateDraft(unknown, check), /UNKNOWN_CALCULATION/);
  const code = structuredClone(ok); code.calculations[0].expression = '20 + process.exit()';
  assert.throws(() => validateDraft(code, check), /INVALID_CALCULATION/);
});

test('the verifier must confirm company roles and attribution', () => {
  const { brief, check } = context();
  const approved = verification(brief);
  assert.ok(validateVerification(approved, check.facts, false));
  for (const key of ['companyRolesSupported', 'attributionSupported']) {
    assert.throws(() => validateVerification({ ...approved, [key]: false }, check.facts, false), /INDEPENDENT_VERIFICATION_FAILED/);
  }
});
