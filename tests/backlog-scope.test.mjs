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
});
