// Formats seen in live DART filings and live model output (2026-11-26). Each formatting variant is accepted only
// where the same fact is still checked exactly; invented, converted or combined values keep failing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTriage, validateDraft } from '../workers/ai-processing/runtime/editorial.mjs';
import { writingBrief, checkCalculations } from '../workers/ai-processing/runtime/writer.mjs';
import { stamp, url, config, triage, draft, originalText, originalTitle } from './backlog-fixtures.mjs';

function context() {
  const c = config();
  const doc = { id: 'd', title: originalTitle, text: originalText, sources: [{ ...c.sources[0], url }] };
  const accepted = validateTriage(triage('d'), [doc], c.catalog);
  const facts = accepted.value.facts;
  const brief = writingBrief({ facts, triage: accepted.value, documents: [doc], catalog: c.catalog, existingIssues: [] });
  return { raw: draft(brief), check: { facts, documents: [doc], triage: accepted.value, catalog: c.catalog, now: stamp } };
}

test('filing date formats, accounting negatives and spaced Korean units pass; mixed or combined values still fail', () => {
  const c = config();
  const body = '이사회결의일(결정일)\n2026년 11월 26일\n계약기간 시작일 2026년 11월 26일 종료일 2027년 02월 25일\n(단위 : 원)\n순손실 (1,849,423,316)\n' +
    '(단위 : 백만 원)\n취득금액 13,437\n매출액 92,095,944,422 89,261,883,258\n' + originalText;
  const doc = { id: 'd', title: 't', text: body, sources: [{ ...c.sources[0], url }] };
  const run = (fact, event = {}) => {
    const input = triage('d'); Object.assign(input.event, event);
    input.facts.push({ ...input.facts[0], id: 'local-f5', predicate: 'X', ...fact, refs: fact.refs.map(quote => ({ docId: 'd', quote })) });
    return validateTriage(input, [doc], c.catalog);
  };
  const resolution = ['이사회결의일(결정일)\n2026년 11월 26일'];
  assert.equal(run({ value: '2026년 11월 26일', unit: '', statement: '결의일은 2026년 11월 26일이다.', refs: resolution }).value.facts.at(-1).unit, '');
  assert.equal(run({ value: '2026년 11월 26일 ~ 2027년 02월 25일', unit: '날짜', statement: '기간은 2026년 11월 26일부터 2027년 02월 25일까지다.',
    refs: ['계약기간 시작일 2026년 11월 26일 종료일 2027년 02월 25일'] }).state, 'RELEVANT');
  assert.throws(() => run({ value: '2026년 12월 27일', unit: '', statement: '결의일은 2026년 11월 26일이다.', refs: resolution }), /FACT_VALUE_MISMATCH/);
  assert.throws(() => run({ value: '2026년 11월 26일 이내(예정)', unit: '', statement: '결의일은 2026년 11월 26일이다.', refs: resolution }), /FACT_VALUE_MISMATCH/);
  assert.equal(run({ value: '(1,849,423,316)', unit: '원', statement: '순손실은 (1,849,423,316)원이다.', refs: ['(단위 : 원)', '순손실 (1,849,423,316)'] }).state, 'RELEVANT');
  assert.throws(() => run({ value: '(1,849,423,316)', unit: '원', statement: '순손실은 (1,849,423,316)원이다.', refs: ['순손실 (1,849,423,316)'] }), /FACT_UNIT_MISMATCH/);
  assert.throws(() => run({ value: '(1,849,423,317)', unit: '원', statement: '순손실은 (1,849,423,316)원이다.', refs: ['(단위 : 원)', '순손실 (1,849,423,316)'] }), /FACT_UNIT_MISMATCH/);
  const spaced = run({ value: '13,437', unit: '백만 원', statement: '취득금액은 13,437백만 원이다.', refs: ['(단위 : 백만 원)', '취득금액 13,437'] });
  assert.equal(spaced.value.facts.at(-1).unit, '백만원');
  // A plain-won value never passes on a scaled, spaced header.
  assert.throws(() => run({ value: '13,437', unit: '원', statement: '취득금액은 13,437원이다.', refs: ['(단위 : 백만 원)', '취득금액 13,437'] }), /FACT_UNIT_MISMATCH/);
  assert.throws(() => run({ value: '92,095,944,422 vs 89,261,883,258', unit: '원', statement: '매출이 늘었다.', refs: ['(단위 : 원)', '매출액 92,095,944,422 89,261,883,258'] }), /FACT_VALUE_MISMATCH/);
  assert.throws(() => run({ value: '30년', unit: '년', statement: '결의일은 2026년 11월 26일이다.', refs: resolution }), /FACT_VALUE_MISMATCH/);
  assert.throws(() => run({ value: '3.0', unit: '3개월 복리 연 %', statement: '결의일은 2026년 11월 26일이다.', refs: resolution }), /FACT_UNIT_UNSUPPORTED/);
  // Event dates in Korean or dotted form are stored as YYYY-MM-DD; impossible dates still fail.
  assert.equal(run({ value: '2026년 11월 26일', unit: '', statement: '결의일은 2026년 11월 26일이다.', refs: resolution }, { date: '2026년 11월 26일' }).value.event.date, '2026-11-26');
  const dotted = triage('d'); dotted.event.date = '2026.11.24';
  assert.equal(validateTriage(dotted, [doc], c.catalog).value.event.date, '2026-11-24');
  const impossible = triage('d'); impossible.event.date = '2026.02.30';
  assert.throws(() => validateTriage(impossible, [doc], c.catalog), /INVALID_EVENT_DATE/);
});

test('a repeated impact direction is normalized; contradicting or open-ended directions still fail', () => {
  const c = config(); const doc = { id: 'd', title: 't', text: originalText, sources: [{ ...c.sources[0], url }] };
  const withImpact = patch => { const input = triage('d'); Object.assign(input.impacts[0], patch); return () => validateTriage(input, [doc], c.catalog); };
  assert.equal(withImpact({ conditionalDirection: 'POSITIVE' })().value.impacts[0].conditionalDirection, 'NONE');
  assert.throws(withImpact({ conditionalDirection: 'NEGATIVE' }), /INVALID_IMPACT/);
  assert.throws(withImpact({ direction: 'RELATED', conditionalDirection: 'NONE' }), /RELATED_CONDITION_REQUIRED/);
  assert.throws(withImpact({ direction: 'RELATED', conditionalDirection: 'POSITIVE', conditions: [] }), /RELATED_CONDITION_REQUIRED/);
  // The writer repeating BENEFIT + POSITIVE matches the triage impact.
  const { raw, check } = context(); const repeated = structuredClone(raw); repeated.impacts[0].conditionalDirection = 'POSITIVE';
  assert.equal(validateDraft(repeated, check).impacts[0].conditionalDirection, 'NONE');
  const flipped = structuredClone(raw); flipped.impacts[0].conditionalDirection = 'NEGATIVE';
  assert.throws(() => validateDraft(flipped, check), /IMPACT_BROADENING/);
});

test('fact IDs appended to prose are removed; unknown or stray IDs and invented numbers still fail', () => {
  const { raw, check } = context(); const id = check.facts[0].id;
  const cited = structuredClone(raw); cited.summary += ` [factIds: ${id}]`;
  assert.equal(validateDraft(cited, check).summary, raw.summary);
  const unknown = structuredClone(raw); unknown.summary += ' [factIds: f-' + '0'.repeat(40) + ']';
  assert.throws(() => validateDraft(unknown, check), /UNKNOWN_REFERENCE/);
  const stray = structuredClone(raw); stray.summary += ` 근거는 ${id}이다.`;
  assert.throws(() => validateDraft(stray, check), /FACT_ID_IN_TEXT/);
  const invented = structuredClone(raw); invented.summary += ` 투자액 99억원 [factIds: ${id}]`;
  assert.throws(() => validateDraft(invented, check), /DRAFT_NUMBER_MISMATCH/);
});

test('date-only schedule entries are left out; timed entries keep every source check', () => {
  const { raw, check } = context(); const factIds = check.facts.map(fact => fact.id);
  const dated = structuredClone(raw); dated.schedule = [{ title: '처분 기간 시작', eventAt: '2031-04-10', timezone: 'Asia/Seoul', factIds }];
  const value = validateDraft(dated, check);
  assert.deepEqual(value.schedule, []); assert(!value.visible_sections.includes('SCHEDULE'));
  const timed = structuredClone(raw); timed.schedule = [{ title: '설명회', eventAt: '2031-04-10T09:00:00+09:00', timezone: 'Asia/Seoul', factIds }];
  assert.throws(() => validateDraft(timed, check), /SCHEDULE_SOURCE_ZONE_UNVERIFIED|UNSUPPORTED_SCHEDULE_TIME/);
  const unknown = structuredClone(dated); unknown.schedule[0].factIds = ['f-unknown'];
  assert.throws(() => validateDraft(unknown, check), /UNKNOWN_REFERENCE/);
});

test('calculations accept parentheses and a trailing × 100 for a percentage of cited values only', () => {
  const facts = [{ id: 'a', value: '2,000,000,000,000', unit: 'krw' }, { id: 'b', value: '1,600,000,000,000', unit: 'krw' }, { id: 'p', value: '20', unit: '%' }];
  const calc = (expression, result, unit, factIds = ['a', 'b']) => () => checkCalculations([{ id: 'c1', expression, result, unit, factIds }], facts);
  assert.equal(calc('(2,000,000,000,000 - 1,600,000,000,000) ÷ 2,000,000,000,000 × 100', '20', '%')()[0].result, '20');
  assert.equal(calc('2,000,000,000,000 - 1,600,000,000,000', '400,000,000,000', 'krw')()[0].result, '400,000,000,000');
  assert.throws(calc('(2,000,000,000,000 - 1,600,000,000,000) ÷ 2,000,000,000,000 × 100', '25', '%'), /CALCULATION_RESULT_MISMATCH/);
  assert.throws(calc('(2,000,000,000,000 - 1,600,000,000,000) ÷ 2,000,000,000,000 × 50', '10', '%'), /CALCULATION_UNIT_UNSUPPORTED/);
  assert.throws(calc('2,000,000,000,000 × 100', '200000000000000', '%', ['a']), /CALCULATION_OPERAND_UNSUPPORTED/);
  assert.throws(calc('20 × 100', '2000', '%', ['p']), /CALCULATION_UNIT_UNSUPPORTED|CALCULATION_OPERAND_UNSUPPORTED/);
  assert.throws(calc('(2,000,000,000,000 - 1,600,000,000,000', '400000000000', 'krw'), /INVALID_CALCULATION/);
  assert.throws(calc('2,000,000,000,000 + 3', '2000000000003', 'krw'), /CALCULATION_OPERAND_UNSUPPORTED/);
});

test('calculation IDs may use underscores; the placeholder renders with its formula', () => {
  const facts = [{ id: 'a', value: '2,000', unit: 'krw' }, { id: 'b', value: '1,600', unit: 'krw' }];
  const [item] = checkCalculations([{ id: 'ceiling_decrease', expression: '2,000 - 1,600', result: '400', unit: '원', factIds: ['a', 'b'] }], facts.map(fact => ({ ...fact, unit: '원' })));
  assert.equal(item.rendered, '400원(2,000 - 1,600로 계산)');
  assert.throws(() => checkCalculations([{ id: 'bad id', expression: '2,000 - 1,600', result: '400', unit: '', factIds: ['a', 'b'] }], facts), /INVALID_CALCULATION/);
});

test('a conditional "매도해야 … 이어진다" is not advice; advisory endings still fail', async () => {
  const { assertHedged } = await import('../workers/ai-processing/runtime/writer.mjs');
  assert.doesNotThrow(() => assertHedged(['보상용 주식이 지급되더라도 수령자가 매도해야 단기 매물 부담으로 이어질 가능성이 생긴다.']));
  for (const phrase of ['지금 매수해야 한다.', '비중 확대해야 합니다.', '매도해야 할 때다.', '매수를 추천한다.', '매도하세요.']) {
    assert.throws(() => assertHedged([phrase]), /ASSERTIVE_INVESTMENT_WORDING/, phrase);
  }
});

// Exchange filing tables (2026-11-27): units sit in the row label above the number, notes use fixed regulatory
// phrases, and names or identifiers are facts. Each is accepted only where the number itself is still exact.
test('exchange filing tables: row-label units, fixed filing phrases, names and identifiers', () => {
  const c = config(); c.sources[0].kind = 'OFFICIAL';
  const body = '단일판매ㆍ공급계약 체결\n2. 계약내역\n계약금액(원)\n51,812,866,780\n최근매출액(원)\n1,999,705,307,561\n매출액대비(%)\n2.60\n' +
    '3. 계약상대방\nMicron Semiconductor Technology India\n- 상기 최근 매출액은 2025년도 연결재무제표 기준입니다.\n' +
    '확정 계약금액\n12,307,107,208\n(단위 : 백만원)\n투자금액 4,000\n채무보증금액은 $1,000,000 상환 후 $24,000,000 입니다.\n' +
    '2026년 11월 25일 서울외국환중개 고시 매매기준환율 1,343.60KRW/USD을 적용하여 환산한 금액입니다.\n' + originalText;
  const doc = { id: 'd', title: 't', text: body, sources: [{ ...c.sources[0], url }] };
  const run = fact => {
    const input = triage('d');
    input.facts.push({ ...input.facts[0], id: 'local-f5', predicate: 'X', period: '', ...fact, refs: fact.refs.map(quote => ({ docId: 'd', quote })) });
    return validateTriage(input, [doc], c.catalog).value.facts.at(-1);
  };
  // The row label "계약금액(원)" states the unit of the number below it, in the statement and in the value.
  assert.equal(run({ value: '51,812,866,780', unit: '원', statement: '계약금액은 51,812,866,780원이다.', refs: ['51,812,866,780'] }).unit, 'krw');
  assert.equal(run({ value: '2.60', unit: '%', statement: '계약금액은 최근 매출액의 2.60%다.', refs: ['2.60'] }).unit, '%');
  // An unlabelled cell or a scaled table header never stands in for a plain-won unit.
  assert.throws(() => run({ value: '12,307,107,208', unit: '원', statement: '확정 계약금액은 12,307,107,208원이다.', refs: ['12,307,107,208'] }), /FACT_NUMBER_MISMATCH|FACT_UNIT_MISMATCH/);
  assert.throws(() => run({ value: '4,000', unit: '원', statement: '투자금액은 4,000원이다.', refs: ['투자금액 4,000'] }), /FACT_NUMBER_MISMATCH|FACT_UNIT_MISMATCH/);
  // Fixed filing phrases and the counterparty's name are not copied expression; long copied prose still is.
  assert.equal(run({ value: '1,999,705,307,561', unit: '원', statement: '최근 매출액은 2025년도 연결재무제표 기준 1,999,705,307,561원이다.',
    refs: ['최근매출액(원)\n1,999,705,307,561', '상기 최근 매출액은 2025년도 연결재무제표 기준입니다.'] }).unit, 'krw');
  assert.equal(run({ value: 'Micron Semiconductor Technology India', unit: '', statement: '계약 상대방은 Micron Semiconductor Technology India다.',
    refs: ['3. 계약상대방\nMicron Semiconductor Technology India'] }).value, 'Micron Semiconductor Technology India');
  assert.throws(() => run({ value: '1,343.60', unit: 'KRW/USD', statement: '서울외국환중개 고시 매매기준환율 1,343.60KRW/USD을 적용하여 환산한 금액이다.',
    refs: ['2026년 11월 25일 서울외국환중개 고시 매매기준환율 1,343.60KRW/USD을 적용하여 환산한 금액입니다.'] }), /FACT_STATEMENT_COPIES_SOURCE/);
  // Exchange rates and dollar amounts written with $ pass; digits inside identifiers are not quantities.
  assert.equal(run({ value: '1,343.60', unit: '원/달러', statement: '원화 환산에 적용된 환율은 1,343.60원/달러다.',
    refs: ['2026년 11월 25일 서울외국환중개 고시 매매기준환율 1,343.60KRW/USD을 적용하여 환산한 금액입니다.'] }).unit, 'krw/usd');
  assert.equal(run({ value: '24,000,000', unit: 'USD', statement: '상환 후 보증 잔액은 24,000,000달러다.',
    refs: ['채무보증금액은 $1,000,000 상환 후 $24,000,000 입니다.'] }).unit.toLowerCase(), 'usd');
  assert.equal(run({ value: '12,307,107,208', unit: '원', statement: 'GEN6 검사장비 확정 계약금액이 공시됐다.',
    refs: ['확정 계약금액\n12,307,107,208', '계약금액(원)'] }).value, '12,307,107,208');
});
