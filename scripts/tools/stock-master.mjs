// Verified stock master (docs/sector-news-plan.md §3.1): catalog company → DART corp code (data/dart-corp-codes.tsv)
// → stock code from the official OpenDART corpCode.xml (API only; the key is read from a local file and sent only to
// opendart.fss.or.kr). Writes data/stock-master.json. Names that repeat, missing or repeated stock codes are left out
// with a reason. Usage: node scripts/tools/stock-master.mjs [--key FILE] [--xml SAVED_CORPCODE_XML]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const root = new URL('../../', import.meta.url);
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const sha = data => createHash('sha256').update(data).digest('hex');

function unzipFirstXml(zip) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('ZIP_INVALID');
  let offset = zip.readUInt32LE(end + 16);
  for (let n = zip.readUInt16LE(end + 10); n > 0; n--) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP_INVALID');
    const method = zip.readUInt16LE(offset + 10), size = zip.readUInt32LE(offset + 20), nameLength = zip.readUInt16LE(offset + 28);
    const extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32), local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extra + comment;
    if (!/\.xml$/i.test(name)) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28), data = zip.subarray(start, start + size);
    return method === 0 ? data : inflateRawSync(data, { maxOutputLength: 128 * 1024 * 1024 });
  }
  throw new Error('ZIP_NO_XML');
}

export function buildMaster({ xml, corpCodesTsv, registry }) {
  const stock = new Map();
  for (const m of xml.matchAll(/<list>\s*<corp_code>(\d{8})<\/corp_code>[\s\S]*?<stock_code>\s*([0-9A-Z]{6})?\s*<\/stock_code>[\s\S]*?<\/list>/g)) if (m[2]) stock.set(m[1], m[2]);
  const corpByName = new Map();
  for (const line of corpCodesTsv.split(/\r?\n/)) { const [name, code] = line.split('\t'); if (name && /^\d{8}$/.test(code ?? '')) corpByName.set(name.trim(), code); }
  const nameCount = new Map(); for (const c of registry.companies) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  const companies = [], excluded = [];
  for (const c of registry.companies) {
    if (nameCount.get(c.name) > 1) { excluded.push({ companyId: c.id, name: c.name, reason: 'DUPLICATE_NAME' }); continue; }
    const corpCode = corpByName.get(c.name);
    if (!corpCode) { excluded.push({ companyId: c.id, name: c.name, reason: 'NO_CORP_CODE' }); continue; }
    const stockCode = stock.get(corpCode);
    if (!stockCode || !/^\d{6}$/.test(stockCode)) { excluded.push({ companyId: c.id, name: c.name, reason: 'NO_STOCK_CODE' }); continue; }
    companies.push({ companyId: c.id, name: c.name, corpCode, stockCode });
  }
  const codeCount = new Map(); for (const c of companies) codeCount.set(c.stockCode, (codeCount.get(c.stockCode) ?? 0) + 1);
  return { companies: companies.filter(c => codeCount.get(c.stockCode) === 1).sort((a, b) => a.stockCode.localeCompare(b.stockCode)),
    excluded: [...excluded, ...companies.filter(c => codeCount.get(c.stockCode) > 1).map(c => ({ companyId: c.companyId, name: c.name, reason: 'DUPLICATE_STOCK_CODE' }))] };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const registry = JSON.parse(readFileSync(new URL('tests/fixtures/catalog/registry-v1.json', root), 'utf8'));
  const corpCodesTsv = readFileSync(new URL('data/dart-corp-codes.tsv', root), 'utf8');
  let xml;
  if (arg('--xml')) xml = readFileSync(arg('--xml'), 'utf8');
  else {
    const key = readFileSync(arg('--key') ?? new URL('.local-data/dart/opendart.key', root), 'utf8').trim();
    if (!/^[0-9A-Za-z]{40}$/.test(key)) throw new Error('DART_KEY_INVALID');
    const response = await fetch('https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=' + key, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('DART_HTTP_' + response.status);
    const zip = Buffer.from(await response.arrayBuffer());
    if (zip.length > 64 * 1024 * 1024 || zip.readUInt32LE(0) !== 0x04034b50) throw new Error('DART_CORPCODE_NOT_ZIP');
    xml = unzipFirstXml(zip).toString('utf8');
  }
  const { companies, excluded } = buildMaster({ xml, corpCodesTsv, registry });
  // Deterministic: no generation time; every effective input is bound by its own hash.
  const out = { format: 'STOCK_MASTER_V1', source: 'OpenDART corpCode.xml', corpCodeXmlSha256: sha(xml), dartCorpCodesSha256: sha(corpCodesTsv),
    registrySha256: sha(readFileSync(new URL('tests/fixtures/catalog/registry-v1.json', root), 'utf8')),
    generatorSha256: sha(readFileSync(new URL('scripts/tools/stock-master.mjs', root), 'utf8')), companies, excluded };
  writeFileSync(new URL('data/stock-master.json', root), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ companies: companies.length, excluded: excluded.length, reasons: excluded.reduce((m, e) => ({ ...m, [e.reason]: (m[e.reason] ?? 0) + 1 }), {}) }));
}
