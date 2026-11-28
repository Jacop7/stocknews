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

test('percent values written with the sign, won-per-dollar written with a backslash, months and spaced product names', () => {
  const c = config(); c.sources[0].kind = 'OFFICIAL';
  const body = "담보한도는 피담보채무 약정한도의 130%로 설정된 금액임\n고시환율(\\1,343.90/USD)을 적용하여 원화로 환산한 금액입니다.\n" +
    '매 3개월에 해당되는 날\n반도체 검사장비 (GEN6 SSD TESTER)\n' + originalText;
  const doc = { id: 'd', title: 't', text: body, sources: [{ ...c.sources[0], url }] };
  const run = fact => {
    const input = triage('d');
    input.facts.push({ ...input.facts[0], id: 'local-f5', predicate: 'X', period: '', ...fact, refs: fact.refs.map(quote => ({ docId: 'd', quote })) });
    return validateTriage(input, [doc], c.catalog).value.facts.at(-1);
  };
  const percent = run({ value: '130%', unit: '%', statement: '담보한도는 약정한도의 130%다.', refs: ['피담보채무 약정한도의 130%로 설정된 금액임'] });
  assert.deepEqual([percent.value, percent.unit], ['130', '%']);
  assert.equal(run({ value: '1,343.90', unit: '\\/USD', statement: '환산 환율은 1,343.90원/달러다.', refs: ['고시환율(\\1,343.90/USD)을 적용하여'] }).unit, 'krw/usd');
  assert.equal(run({ value: '3', unit: '개월', statement: '조기상환 주기는 3개월이다.', refs: ['매 3개월에 해당되는 날'] }).unit, '개월');
  assert.equal(run({ value: 'GEN6 SSD TESTER', unit: '', statement: '계약 품목은 GEN6 SSD TESTER다.', refs: ['반도체 검사장비 (GEN6 SSD TESTER)'] }).value, 'GEN6 SSD TESTER');
  // A spaced name must still be quoted exactly.
  assert.throws(() => run({ value: 'GEN7 SSD TESTER', unit: '', statement: '계약 품목은 GEN7 SSD TESTER다.', refs: ['반도체 검사장비 (GEN6 SSD TESTER)'] }), /FACT_VALUE_MISMATCH|FACT_NUMBER_MISMATCH/);
});

test('a filing series number in a statement is accepted only when the filing states that series', () => {
  const c = config(); c.sources[0].kind = 'OFFICIAL';
  const body = '전환사채권 발행결정\n1. 사채의 종류\n회차\n10\n2. 사채의 권면(전자등록)총액 (원)\n30,300,000,000\n' + originalText;
  const doc = { id: 'd', title: 't', text: body, sources: [{ ...c.sources[0], url }] };
  const run = statement => () => {
    const input = triage('d');
    input.facts.push({ ...input.facts[0], id: 'local-f5', predicate: 'X', value: '30,300,000,000', unit: '원', period: '', statement,
      refs: [{ docId: 'd', quote: '2. 사채의 권면(전자등록)총액 (원)\n30,300,000,000' }] });
    return validateTriage(input, [doc], c.catalog).state;
  };
  for (const statement of ['제10회 전환사채 발행금액은 30,300,000,000원이다.', '10회차 사채 발행금액은 30,300,000,000원이다.',
    '회차 10 사채의 발행금액은 30,300,000,000원이다.', '10회 사채 발행금액은 30,300,000,000원이다.']) assert.equal(run(statement)(), 'RELEVANT', statement);
  assert.throws(run('제11회 전환사채 발행금액은 30,300,000,000원이다.'), /FACT_NUMBER_MISMATCH/);
  assert.throws(run('제10회 전환사채 발행금액은 30,300,000,001원이다.'), /FACT_NUMBER_MISMATCH/);
  assert.throws(run('제10회 사채는 10개 기관이 30,300,000,000원을 인수한다.'), /FACT_NUMBER_MISMATCH/);
});

test('impact paths may repeat a filing contract name; longer copied filing prose and copied news prose still fail', () => {
  const c = config();
  const name = '재사용 기술 시연체 유공압 엄빌리컬 위탁개발 계약';
  const prose = '당사는 본 계약을 통하여 발사체 지상 지원 설비의 핵심 기술을 확보하고 향후 상업 발사 서비스 경쟁력을 강화할 계획입니다';
  const doc = kind => ({ id: 'd', title: 't', text: name + '\n' + prose + '\n' + originalText, sources: [{ ...c.sources[0], kind, url }] });
  const run = (path, kind = 'OFFICIAL') => () => { const input = triage('d'); input.impacts[0].path = path; return validateTriage(input, [doc(kind)], c.catalog).state; };
  assert.equal(run(name + '의 총액 상향이 수주 규모를 늘린다.')(), 'RELEVANT');
  assert.throws(run('회사는 ' + prose.slice(4, 60) + '라고 밝혔다.'), /IMPACT_PATH_COPIES_SOURCE/);
  assert.throws(run(name + '의 총액 상향이 수주 규모를 늘린다.', 'NEWS'), /IMPACT_PATH_COPIES_SOURCE/);
});

test('a draft number written with its unit passes only when a verified fact has that value in that unit', () => {
  const { raw, check } = context();
  const facts = [...check.facts, { ...check.facts[0], id: 'f-rate', value: '1,343.90', unit: 'krw/usd', statement: '환산에는 고시환율 \\1,343.90/USD가 적용됐다.' }];
  const withRate = { ...check, facts };
  const rate = structuredClone(raw); rate.risks[0].text = '환산에는 1,343.90원/USD가 적용됐다.';
  assert.ok(validateDraft(rate, withRate));
  const other = structuredClone(raw); other.risks[0].text = '환산에는 1,343.91원/USD가 적용됐다.';
  assert.throws(() => validateDraft(other, withRate), /DRAFT_NUMBER_MISMATCH/);
  const wrongUnit = structuredClone(raw); wrongUnit.risks[0].text = '환산에는 1,343.90달러가 적용됐다.';
  assert.throws(() => validateDraft(wrongUnit, withRate), /DRAFT_NUMBER_MISMATCH/);
});

test('a unit typed after a calculation placeholder is not shown twice', async () => {
  const { checkCalculations, renderCalculations } = await import('../workers/ai-processing/runtime/writer.mjs');
  const facts = [{ id: 'a', value: '538', unit: '억원' }, { id: 'b', value: '2,159', unit: '억원' }];
  const calcs = checkCalculations([{ id: 'share', expression: '538 ÷ 2,159 × 100', result: '24.92', unit: '%', factIds: ['a', 'b'] }], facts);
  assert.equal(renderCalculations('비중은 약 {{calc:share}}%이다.', calcs), '비중은 약 24.92%(538 ÷ 2,159 × 100로 계산)이다.');
  assert.equal(renderCalculations('비중은 약 {{calc:share}}이다.', calcs), '비중은 약 24.92%(538 ÷ 2,159 × 100로 계산)이다.');
});

test('a currency symbol inside the value and a series-number fact are read as written in the filing', () => {
  const c = config(); c.sources[0].kind = 'OFFICIAL';
  const body = '사채의 종류\n회차\n14\n보증 금액은 $24,000,000입니다.\n' + originalText;
  const doc = { id: 'd', title: 't', text: body, sources: [{ ...c.sources[0], url }] };
  const run = fact => () => {
    const input = triage('d');
    input.facts.push({ ...input.facts[0], id: 'local-f5', predicate: 'X', period: '', ...fact, refs: fact.refs.map(quote => ({ docId: 'd', quote })) });
    return validateTriage(input, [doc], c.catalog).value.facts.at(-1);
  };
  const usd = run({ value: '$24,000,000', unit: 'USD', statement: '보증 금액은 $24,000,000이다.', refs: ['보증 금액은 $24,000,000입니다.'] })();
  assert.deepEqual([usd.value, usd.unit.toLowerCase()], ['24,000,000', 'usd']);
  assert.throws(run({ value: '$25,000,000', unit: 'USD', statement: '보증 금액은 $24,000,000이다.', refs: ['보증 금액은 $24,000,000입니다.'] }), /FACT_UNIT_MISMATCH/);
  assert.equal(run({ value: '14', unit: '회차', statement: '14회차 전환사채를 취득한다.', refs: ['사채의 종류\n회차\n14'] })().unit, '');
  assert.throws(run({ value: '15', unit: '회차', statement: '14회차 전환사채를 취득한다.', refs: ['사채의 종류\n회차\n14'] }), /FACT_UNIT_UNSUPPORTED/);
});

test('many evidence quotes stay within the wording screen limit; copying a quote of a deleted body still fails', () => {
  const { raw, check } = context();
  const purged = check.documents.map(doc => ({ ...doc, text: '', purged: true }));
  const words = ['가람', '나래', '다솜', '라온', '마루', '바다', '사랑', '아라', '자리', '하늘'];
  const quoteOf = n => `해당 공시의 ${words[n % 10]} 항목은 ${words[(n + 3) % 10]} 조건과 ${words[(n + 7) % 10]} 기준을 함께 적용하는 별도 약정으로 이사회 결의를 거쳐 확정된 사항 ${String.fromCharCode(0xac00 + n)}이다`;
  const extra = Array.from({ length: 30 }, (_, n) => ({ ...check.facts[0], id: 'f-extra-' + n, refs: [{ docId: 'd', quote: quoteOf(n) }] }));
  const many = { ...check, documents: purged, facts: [...check.facts, ...extra] };
  assert.ok(validateDraft(raw, many));
  const copied = structuredClone(raw); copied.risks[0].text = quoteOf(5) + '.';
  assert.throws(() => validateDraft(copied, many), /SHARED_SOURCE_WORDING/);
});
