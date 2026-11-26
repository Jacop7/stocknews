// Writer separation (2026-11-26). The AI processor reads originals, extracts and verifies facts.
// The writer receives only a brief of verified facts, never original titles, bodies or evidence quotes,
// so it cannot carry over source expression. Its output is checked here for the agreed writing rules:
// attribution of reported facts, shown calculations, hedged wording and a reason for every company.
import assert from 'node:assert/strict';
import { text, list, numericTokens } from './contracts.mjs';

export const DISCLAIMER = '본 콘텐츠는 정보 제공 목적의 분석이며 투자 권유가 아닙니다. 투자 판단과 책임은 이용자에게 있습니다.';

const sourceName = source => (typeof source.name === 'string' && source.name.trim()) ? source.name.trim() : source.host;

// PRIMARY: the company, regulator or exchange said it (OFFICIAL source with verified provenance).
// REPORTED: only a newsroom or research report says it; the text must name who reported it.
export function factProvenance(fact, documents) {
  const sources = [...new Set(fact.refs.map(ref => ref.docId))]
    .flatMap(id => documents.find(doc => doc.id === id)?.sources ?? []).filter(source => source.provenanceVerified);
  if (sources.some(source => source.kind === 'OFFICIAL')) return { provenance: 'PRIMARY', attributions: [] };
  const names = [...new Set(sources.filter(source => ['NEWS', 'REPORT'].includes(source.kind)).map(sourceName))].sort();
  return { provenance: 'REPORTED', attributions: names };
}

export function writingBrief({ facts, triage, documents, catalog, existingIssues }) {
  return {
    facts: facts.map(fact => ({ id: fact.id, subjectId: fact.subjectId, predicate: fact.predicate, value: fact.value,
      unit: fact.unit, period: fact.period, statement: fact.statement, verificationClass: fact.verificationClass,
      ...factProvenance(fact, documents) })),
    event: { family: triage.event.family, entityIds: triage.event.entityIds, date: triage.event.date,
      period: triage.event.period, officialId: triage.event.officialId },
    articleKind: triage.articleKind, primaryCompanyId: triage.primaryCompanyId ?? null, sectorIds: triage.sectorIds,
    impacts: triage.impacts.map(({ sectorId, companyIds, direction, conditionalDirection, category, path, conditions, factIds }) =>
      ({ sectorId, companyIds, direction, conditionalDirection, category, path, conditions, factIds })),
    catalog, existingIssues,
  };
}

// Assertive or advisory phrasing reads as a buy/sell call next to a list of stocks.
const assertive = [
  /수혜\s*(?:주|기업|업체)?\s*(?:가|이|로)?\s*된다/, /수혜를\s*(?:받는다|입는다|본다)/, /피해를\s*(?:받는다|입는다|본다)/,
  // "불확실" (uncertain) is hedged language; "수주 목표가 상향" is an order target, not a price target.
  /반드시/, /(?<!불)확실(?:히|하다|한|시)/, /틀림없/, /무조건/, /(?:매수|매도|비중\s*확대|비중\s*축소)(?:를|을)?\s*(?:추천|권유|권장|하라|하세요|해야\s*(?:한다|합니다|할\s*(?:때|시점)))/,
  // "수령자가 매도해야 매물로 이어진다" is a condition (only if they sell), not advice; "매도해야 한다" is advice.
  /목표\s*주가|목표가(?:를|는|로|\s*\d)/, /(?:급등|폭등|급락|폭락|상한가|하한가)(?:할|한다|하게\s*된다)/, /(?:오를|내릴|상승할|하락할)\s*것이다/,
];
export function assertHedged(parts) {
  for (const part of parts) assert(!assertive.some(pattern => pattern.test(part)), 'ASSERTIVE_INVESTMENT_WORDING');
}

// Key issues and analysis must name the reporter of every REPORTED fact they cite. Anywhere else (title,
// summary, impacts, scenarios, risks, schedule), a part that repeats a reported fact's number must name it too.
export function assertAttributed(sections, brief, otherParts = []) {
  const byId = new Map(brief.facts.map(fact => [fact.id, fact]));
  const named = (fact, value) => fact.attributions.length > 0 && fact.attributions.some(name => value.includes(name));
  for (const section of sections) for (const id of section.factIds) {
    const fact = byId.get(id);
    if (fact?.provenance !== 'REPORTED') continue;
    assert(named(fact, section.text), 'REPORTED_FACT_UNATTRIBUTED');
  }
  for (const fact of brief.facts) {
    if (fact.provenance !== 'REPORTED') continue;
    const numbers = numericTokens(fact.statement);
    for (const part of otherParts) {
      if (numbers.some(number => numericTokens(part).includes(number))) assert(named(fact, part), 'REPORTED_FACT_UNATTRIBUTED');
    }
  }
}

// Whitespace-insensitive check for a shared run of `size` characters, used to keep source prose out of
// model-written fact statements and impact paths before they reach the writer.
const squeeze = value => value.normalize('NFKC').replace(/\s+/g, '');
export function sharesRun(a, b, size = 20) {
  const left = squeeze(a), right = squeeze(b);
  if (left.length < size || right.length < size) return false;
  for (let index = 0; index + size <= left.length; index++) if (right.includes(left.slice(index, index + size))) return true;
  return false;
}

export function assertCompanyRoles(impacts, catalog) {
  for (const impact of impacts) {
    const roles = list(impact.companyRoles, 100);
    assert(roles.length === impact.companyIds.length && impact.companyIds.every(id => roles.filter(role => role.companyId === id).length === 1),
      'COMPANY_ROLE_REQUIRED');
    for (const role of roles) {
      text(role.role, 80);
      assert(role.role.trim().length >= 2, 'COMPANY_ROLE_REQUIRED');
      const company = catalog.entities.find(entity => entity.id === role.companyId);
      // The role explains the link; repeating the company name is not a reason.
      assert(company && role.role.trim() !== company.name, 'COMPANY_ROLE_REQUIRED');
    }
  }
}

// Calculations are written as {{calc:ID}} in text and rendered by the system with their formula.
const plain = value => value.normalize('NFKC').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').replace(/^\+/, '');
// Operands are the values of quantitative facts only (a numeric value with a unit), never digits that happen
// to appear in identifiers such as HBM4 or in surrounding statement text.
const quantitative = fact => /^[+-]?\d+(?:[,.]\d+)*$/.test(fact.value) && fact.unit.trim() !== '';
const operandValues = facts => new Set(facts.filter(quantitative).map(fact => plain(fact.value)));
// Arithmetic only: numbers, + - × ÷ and parentheses (e.g. (a - b) ÷ a × 100). Anything else is INVALID_CALCULATION.
function evaluate(expression) {
  const tokens = plain(expression).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').match(/\d+(?:\.\d+)?|[-+*/()]|\S/g) ?? [];
  assert(tokens.every(token => /^(?:\d+(?:\.\d+)?|[-+*/()])$/.test(token)), 'INVALID_CALCULATION');
  let index = 0, depth = 0; const operands = [];
  const factor = () => {
    let sign = 1;
    if (tokens[index] === '-') { sign = -1; index++; }
    const token = tokens[index++];
    if (token === '(') {
      assert(++depth <= 4, 'INVALID_CALCULATION');
      const value = sum(); assert(tokens[index++] === ')', 'INVALID_CALCULATION'); depth--; return sign * value;
    }
    assert(token !== undefined && /^\d/.test(token), 'INVALID_CALCULATION');
    operands.push(sign < 0 ? '-' + token : token); return sign * Number(token);
  };
  const product = () => {
    let value = factor();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++], right = factor();
      if (op === '/') assert(right !== 0, 'INVALID_CALCULATION');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = () => {
    let value = product();
    while (tokens[index] === '+' || tokens[index] === '-') { const op = tokens[index++], right = product(); value = op === '+' ? value + right : value - right; }
    return value;
  };
  const result = sum();
  assert(index === tokens.length && operands.length >= 2 && Number.isFinite(result), 'INVALID_CALCULATION');
  return { result, operands };
}
// A percentage of cited values, e.g. (a - b) ÷ a × 100 with unit %: the trailing × 100 is the only constant allowed.
const percentConversion = (item, cited) => item.unit.trim() === '%' && /[×*]\s*100\s*$/.test(item.expression) &&
  cited.length > 0 && cited.every(fact => !['%', '%p'].includes(fact.unit.trim().toLowerCase()));
export function checkCalculations(calculations, facts) {
  const allowed = operandValues(facts), seen = new Set();
  return list(calculations, 12).map(item => {
    text(item.id, 40); assert(/^[a-z0-9_-]+$/.test(item.id) && !seen.has(item.id), 'INVALID_CALCULATION'); seen.add(item.id);
    text(item.expression, 120); text(item.unit, 20, true); text(item.result, 40);
    assert(list(item.factIds, 10).length && item.factIds.every(id => facts.some(fact => fact.id === id)), 'UNKNOWN_REFERENCE');
    const cited = facts.filter(fact => item.factIds.includes(fact.id));
    // The rendered unit must be one of the cited facts' units (or none); it cannot smuggle in new numbers.
    const units = new Set(cited.map(fact => fact.unit.trim().toLowerCase()));
    const percent = percentConversion(item, cited);
    assert(!/\d/.test(item.unit) && (item.unit.trim() === '' || percent || units.has(item.unit.trim().toLowerCase())), 'CALCULATION_UNIT_UNSUPPORTED');
    const { result, operands } = evaluate(item.expression);
    if (percent) assert(operands.at(-1) === '100', 'CALCULATION_OPERAND_UNSUPPORTED');
    const factOperands = percent ? operands.slice(0, -1) : operands;
    assert(factOperands.length >= (percent ? 2 : 1) && factOperands.every(value => operandValues(cited).has(value) && allowed.has(value)), 'CALCULATION_OPERAND_UNSUPPORTED');
    const stated = plain(item.result);
    assert(/^-?\d+(?:\.\d+)?$/.test(stated), 'INVALID_CALCULATION');
    const decimals = stated.includes('.') ? stated.split('.')[1].length : 0;
    assert(Math.abs(result - Number(stated)) <= 0.5 * 10 ** -decimals + 1e-9, 'CALCULATION_RESULT_MISMATCH');
    return { ...item, rendered: `${item.result}${item.unit}(${item.expression}로 계산)` };
  });
}
export function renderCalculations(value, calculations) {
  return value.replace(/\{\{calc:([a-z0-9_-]+)\}\}/g, (_match, id) => {
    const found = calculations.find(item => item.id === id);
    assert(found, 'UNKNOWN_CALCULATION');
    return found.rendered;
  });
}
export const stripCalculations = value => value.replace(/\{\{calc:[a-z0-9_-]+\}\}/g, '');
