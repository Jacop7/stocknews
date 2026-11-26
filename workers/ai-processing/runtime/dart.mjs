// OpenDART (official disclosure API). The DART website forbids automated access in robots.txt, so filings are
// read only through the API: list.json for new filings of the watched companies, document.xml (a ZIP holding the
// filing XML) for the text. Filings enter the normal pipeline as https://dart.fss.or.kr/dsaf001/main.do?rcpNo=...
// links, so the usual grant, retention and deletion rules apply. The API key is passed only to opendart.fss.or.kr.
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { digest, day, sourceGrant } from './contracts.mjs';
import { createOriginalTransport } from './original.mjs';

export const DART_HOST = 'dart.fss.or.kr';
export const API = 'https://opendart.fss.or.kr/api/';
const maxBodyBytes = 58000, maxZipBytes = 8 * 1024 * 1024;

export const filingUrl = rcptNo => `https://${DART_HOST}/dsaf001/main.do?rcpNo=${rcptNo}`;
export function receiptNumber(url) {
  const parsed = new URL(url);
  const value = parsed.hostname === DART_HOST ? parsed.searchParams.get('rcpNo') : null;
  return value && /^\d{14}$/.test(value) ? value : null;
}
export function readCorpCodes(tsv) {
  const codes = new Map();
  for (const line of tsv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, code] = line.split('\t');
    assert(name && /^\d{8}$/.test(code ?? ''), 'INVALID_CORP_CODE_ROW');
    codes.set(code, name);
  }
  return codes;
}
// A receipt number starts with the filing date (YYYYMMDD); the API gives no time, so the day start in KST is used.
export const filingDate = rcptNo => `${rcptNo.slice(0, 4)}-${rcptNo.slice(4, 6)}-${rcptNo.slice(6, 8)}T00:00:00+09:00`;

// Minimal ZIP reader (central directory; stored or deflated entries). Returns the first .xml entry.
export function firstXmlEntry(zip) {
  assert(Buffer.isBuffer(zip) && zip.length >= 22 && zip.length <= maxZipBytes, 'DART_ZIP_INVALID');
  let end = -1;
  for (let index = zip.length - 22; index >= Math.max(0, zip.length - 65557); index--) if (zip.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  assert(end >= 0, 'DART_ZIP_INVALID');
  const count = zip.readUInt16LE(end + 10); let offset = zip.readUInt32LE(end + 16);
  for (let entry = 0; entry < count; entry++) {
    assert(offset + 46 <= zip.length && zip.readUInt32LE(offset) === 0x02014b50, 'DART_ZIP_INVALID');
    const method = zip.readUInt16LE(offset + 10), size = zip.readUInt32LE(offset + 20), full = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42), name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extra + comment;
    if (!/\.xml$/i.test(name)) continue;
    assert(local + 30 <= zip.length && zip.readUInt32LE(local) === 0x04034b50 && full <= 32 * 1024 * 1024, 'DART_ZIP_INVALID');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) return data;
    assert(method === 8, 'DART_ZIP_METHOD');
    return inflateRawSync(data, { maxOutputLength: 32 * 1024 * 1024 });
  }
  assert.fail('DART_ZIP_NO_XML');
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Filing XML → plain text (tags removed, entities decoded), capped to the pipeline's body limit by UTF-8 bytes.
export function filingText(xml) {
  const title = /<DOCUMENT-NAME[^>]*>([^<]*)</i.exec(xml)?.[1]?.trim() ?? '';
  const company = /<COMPANY-NAME[^>]*>([^<]*)</i.exec(xml)?.[1]?.trim() ?? '';
  let text = xml.replace(/<\?[^>]*\?>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(TABLE-GROUP|TABLE|TR)\b[^>]*>/gi, '\n')
    .replace(/<\/?(P|TD|TH|TITLE|TU|TE)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => code[0] === '#'
      ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : entities[code.toLowerCase()] ?? match)
    .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (Buffer.byteLength(text, 'utf8') > maxBodyBytes) {
    let cut = Math.floor(maxBodyBytes / 3);
    while (Buffer.byteLength(text.slice(0, cut + 500), 'utf8') <= maxBodyBytes) cut += 500;
    text = text.slice(0, cut).replace(/\s+\S*$/, '');
  }
  return { title: [company, title].filter(Boolean).join(' ').slice(0, 500), text };
}

// Routine ownership and offering paperwork rarely carries a new catalyst; skipping it keeps the daily model budget
// for contracts, investments, results, capital actions and similar filings.
const routine = /(임원\s*ㆍ?\s*주요주주\s*특정증권등\s*소유상황보고서|주식등의\s*대량보유상황보고서|최대주주등\s*소유주식변동신고서|증권발행실적보고서|투자설명서|일괄신고추가서류|자기주식\s*처분\s*결과보고서|주주총회소집공고|의결권대리행사권유|기업지배구조보고서|대규모기업집단현황공시|특정증권등\s*거래계획보고서|주주명부폐쇄기간|기준일\s*설정|\[첨부정정\]|분기보고서|반기보고서|사업보고서)/;
export const routineFiling = reportName => routine.test(reportName.replace(/\s+/g, ' '));

export function createDartClient({ apiKey, transport = createOriginalTransport(), now = Date.now } = {}) {
  assert(typeof apiKey === 'string' && /^[0-9A-Za-z]{40}$/.test(apiKey), 'DART_KEY_NOT_CONFIGURED');
  const call = async (path, params, maxBytes) => {
    const url = API + path + '?' + new URLSearchParams({ crtfc_key: apiKey, ...params });
    return transport(url, { timeoutMs: 15000, maxBytes, signal: AbortSignal.timeout(15000), authorize: () => true });
  };
  return {
    // New filings of the watched companies (corp code → name) for today and yesterday (KST), at most 10 pages.
    async newFilings(corpCodes, at = now()) {
      const kst = new Date(at + 9 * 3600000), end = kst.toISOString().slice(0, 10).replace(/-/g, '');
      const begin = new Date(at + 9 * 3600000 - day).toISOString().slice(0, 10).replace(/-/g, '');
      const found = [];
      for (let page = 1; page <= 10; page++) {
        const response = await call('list.json', { bgn_de: begin, end_de: end, page_no: String(page), page_count: '100' }, 2 * 1024 * 1024);
        assert(response.status === 200, 'DART_LIST_HTTP_' + response.status);
        const body = JSON.parse(response.body.toString('utf8'));
        if (body.status === '013') break; // no data
        assert(body.status === '000', 'DART_LIST_STATUS_' + body.status);
        for (const item of body.list ?? []) if (corpCodes.has(item.corp_code) && /^\d{14}$/.test(item.rcept_no) && !routineFiling(item.report_nm ?? '')) {
          found.push({ sourceId: 'dart:list', url: filingUrl(item.rcept_no), title: `${item.corp_name} ${item.report_nm}`.slice(0, 300),
            lastSeen: at, expiresAt: at + 7 * day });
        }
        if (page >= Number(body.total_page ?? 1)) break;
      }
      return found;
    },
    async filing(rcptNo) {
      const response = await call('document.xml', { rcept_no: rcptNo }, maxZipBytes);
      assert(response.status === 200, 'DART_DOCUMENT_HTTP_' + response.status);
      // Errors come back as a small XML/JSON message instead of a ZIP.
      assert(response.body.readUInt32LE(0) === 0x04034b50, 'DART_DOCUMENT_NOT_ZIP');
      const xml = firstXmlEntry(response.body).toString('utf8');
      return filingText(xml);
    },
  };
}

// readOriginal for DART filing links: same grant/authority checks as the web reader, then the document API.
export function createDartReader({ client, fallback, now = Date.now }) {
  return async request => {
    const rcptNo = receiptNumber(request.url);
    if (!rcptNo || !client) return fallback(request);
    const config = request.loadConfig();
    if (digest(config) !== request.expectedConfig || !sourceGrant(config, request.url, now()) || !config.readOriginals || !request.authorize()) {
      return { state: 'HOLD', reason: 'ORIGINAL_ACCESS_NOT_ENABLED' };
    }
    const slot = request.reserveHost('opendart.fss.or.kr', now(), 5000);
    if (!slot.allowed) return { state: 'DEFER', nextAt: slot.nextAt, url: request.url, redirects: request.redirects ?? 0 };
    try {
      const { title, text } = await client.filing(rcptNo);
      if (!request.authorize()) return { state: 'HOLD', reason: 'AUTHORITY_CHANGED' };
      if (!title || text.length < 50) return { state: 'HOLD', reason: 'ARTICLE_BODY_NOT_IDENTIFIED' };
      return { state: 'ORIGINAL', url: filingUrl(rcptNo), title, text, publishedAt: new Date(filingDate(rcptNo)).toISOString(),
        bodyHash: digest(text.normalize('NFKC').replace(/\s+/g, ' ')) };
    } catch (error) {
      return { state: 'HOLD', reason: /^DART_[A-Z_0-9]+$/.test(error.message) ? error.message : 'ORIGINAL_READ_FAILED' };
    }
  };
}
