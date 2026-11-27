import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { createDartClient, createDartReader, filingText, firstXmlEntry, receiptNumber, routineFiling, readCorpCodes, filingUrl } from '../workers/ai-processing/runtime/dart.mjs';
import { digest } from '../workers/ai-processing/runtime/contracts.mjs';
import { config } from './backlog-fixtures.mjs';

function zip(name, content) {
  const data = deflateRawSync(Buffer.from(content)), file = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(Buffer.byteLength(content), 22); local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(Buffer.byteLength(content), 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(0, 42);
  const offset = local.length + file.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, file, data, central, file, end]);
}
const xml = '<?xml version="1.0"?><DOCUMENT><DOCUMENT-NAME ACODE="00760">단일판매ㆍ공급계약체결</DOCUMENT-NAME><COMPANY-NAME>가상전자</COMPANY-NAME>' +
  '<BODY><TABLE><TR><TD>계약금액</TD><TD>1,200억원 &amp; 기간 &#x31;년</TD></TR></TABLE><P>가상전자는 공급 계약을 체결했다고 공시했다. 이 문서는 시험용이다.</P></BODY></DOCUMENT>';
const rcpt = '20261126000123';

test('filing XML is read from the ZIP and turned into plain text with decoded entities', () => {
  const text = filingText(firstXmlEntry(zip(rcpt + '.xml', xml)).toString('utf8'));
  assert.equal(text.title, '가상전자 단일판매ㆍ공급계약체결');
  assert.match(text.text, /계약금액 1,200억원 & 기간 1년/);
  assert(!/[<>]/.test(text.text));
  const long = filingText('<DOCUMENT-NAME>긴 공시</DOCUMENT-NAME><P>' + '가나다라 '.repeat(20000) + '</P>');
  assert(Buffer.byteLength(long.text, 'utf8') <= 58000);
  assert.throws(() => firstXmlEntry(Buffer.from('not a zip at all, definitely not')), /DART_ZIP_INVALID/);
});

test('routine ownership paperwork is skipped; links and corp codes are parsed strictly', () => {
  assert(routineFiling('임원ㆍ주요주주특정증권등소유상황보고서'));
  assert(routineFiling('주식등의대량보유상황보고서(일반)'));
  assert(routineFiling('대규모기업집단현황공시[분기별공시(개별회사용)]'));
  assert(!routineFiling('[기재정정]단일판매ㆍ공급계약체결'));
  assert(!routineFiling('주요사항보고서(전환사채권발행결정)'));
  assert(routineFiling('분기보고서 (2026.09)'));
  assert(!routineFiling('영업(잠정)실적(공정공시)'));
  assert.equal(receiptNumber(filingUrl(rcpt)), rcpt);
  assert.equal(receiptNumber('https://dart.fss.or.kr/dsaf001/main.do?rcpNo=123'), null);
  assert.equal(receiptNumber('https://example.co.kr/?rcpNo=' + rcpt), null);
  assert.deepEqual([...readCorpCodes('삼성전자\t00126380\n')], [['00126380', '삼성전자']]);
  assert.throws(() => readCorpCodes('삼성전자\t126380\n'), /INVALID_CORP_CODE_ROW/);
});

test('new filings are listed through the API only for watched companies, without routine filings', async () => {
  const requested = [];
  const pages = { 1: { status: '000', total_page: 2, list: [
    { corp_code: '00126380', corp_name: '삼성전자', report_nm: '단일판매ㆍ공급계약체결', rcept_no: rcpt },
    { corp_code: '00126380', corp_name: '삼성전자', report_nm: '임원ㆍ주요주주특정증권등소유상황보고서', rcept_no: '20261126000124' },
    { corp_code: '99999999', corp_name: '다른회사', report_nm: '유상증자결정', rcept_no: '20261126000125' }] },
    2: { status: '000', total_page: 2, list: [{ corp_code: '00126380', corp_name: '삼성전자', report_nm: '영업(잠정)실적(공정공시)', rcept_no: '20261126000126' }] } };
  const client = createDartClient({ apiKey: 'a'.repeat(40), transport: async url => {
    requested.push(new URL(url)); const page = new URL(url).searchParams.get('page_no');
    return { status: 200, body: Buffer.from(JSON.stringify(pages[page])) };
  } });
  const filings = await client.newFilings(new Map([['00126380', '삼성전자']]), Date.parse('2026-11-26T03:00:00Z'));
  assert.deepEqual(filings.map(item => [item.url, item.sourceId]), [[filingUrl(rcpt), 'dart:list'], [filingUrl('20261126000126'), 'dart:list']]);
  assert(requested.every(url => url.hostname === 'opendart.fss.or.kr' && url.pathname === '/api/list.json'));
  assert.deepEqual([requested[0].searchParams.get('bgn_de'), requested[0].searchParams.get('end_de')], ['20261125', '20261126']);
  assert.throws(() => createDartClient({ apiKey: 'short' }), /DART_KEY_NOT_CONFIGURED/);
});

test('DART links are read through the document API only with an enabled grant; other links use the web reader', async () => {
  const settings = config();
  settings.sources.push({ ...settings.sources[0], host: 'dart.fss.or.kr', id: 'dart', kind: 'OFFICIAL', name: 'DART 전자공시' });
  const client = { filing: async number => { assert.equal(number, rcpt); return filingText(xml); } };
  const fallback = async () => ({ state: 'HOLD', reason: 'WEB_READER' });
  const read = createDartReader({ client, fallback, now: () => Date.parse('2026-11-26T03:00:00Z') });
  const request = (url, loaded = settings) => ({ url, loadConfig: () => loaded, expectedConfig: digest(loaded), authorize: () => true,
    reserveHost: () => ({ allowed: true }) });
  const result = await read(request(filingUrl(rcpt)));
  assert.equal(result.state, 'ORIGINAL'); assert.equal(result.publishedAt, '2026-11-25T15:00:00.000Z');
  assert.match(result.text, /공급 계약을 체결/);
  assert.equal((await read(request('https://news.publisher.co.kr/article/one'))).reason, 'WEB_READER');
  const disabled = structuredClone(settings); disabled.sources.at(-1).status = 'DISABLED';
  assert.equal((await read(request(filingUrl(rcpt), disabled))).reason, 'ORIGINAL_ACCESS_NOT_ENABLED');
});

// Exchange disclosures (supply contracts, share cancellations, guarantees) come back from the document API as HTML
// forms with a "회사명/보고서명/(날짜)보고서명" title and a style block, not DART XML (2026-11-27).
test('exchange filing HTML gets its company and report title, and its style block stays out of the text', () => {
  const html = `<html>\r\n <head> <meta content="text/html; charset=euc-kr" http-equiv="Content-Type"> <STYLE>\r\n.xforms * { font-family: 돋움체;}\r\n</STYLE>
    <title>가상정밀/단일판매ㆍ공급계약체결/(2026.11.26)단일판매ㆍ공급계약체결</title></head>
    <body><div class="xforms"><span>단일판매ㆍ공급계약 체결</span><table><tbody>
    <tr><td><span>1. 판매ㆍ공급계약 구분</span></td><td><span class="xforms_input">제품공급</span></td></tr>
    <tr><td><span>계약금액(원)</span></td><td><span class="xforms_input">12,000,000,000</span></td></tr>
    <tr><td><span>최근매출액(원)</span></td><td><span class="xforms_input">34,000,000,000</span></td></tr></tbody></table></div></body></html>`;
  const { title, text } = filingText(html);
  assert.equal(title, '가상정밀 단일판매ㆍ공급계약체결');
  assert(text.startsWith('단일판매ㆍ공급계약 체결') && /계약금액\(원\)\s+12,000,000,000/.test(text));
  assert(!/font-family|xforms|돋움체/.test(text));
  // A page with neither a DART document name nor a usable HTML title still has no title (held, not guessed).
  assert.equal(filingText('<html><head><title>안내</title></head><body>본문</body></html>').title, '');
});

test('IR announcements and shareholder meeting notices or results are routine; contracts and cancellations are not', () => {
  for (const name of ['기업설명회(IR)개최(안내공시)', '주주총회소집결의', '임시주주총회결과']) assert(routineFiling(name), name);
  for (const name of ['단일판매ㆍ공급계약체결', '주식소각결정', '타인에대한채무보증결정']) assert(!routineFiling(name), name);
});
