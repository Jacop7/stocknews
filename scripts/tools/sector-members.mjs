// Sector members (docs/sector-news-plan.md §3.1): each of the 56 catalog sectors → the catalog company IDs that are in
// the verified stock master (data/stock-master.json), sorted. Deterministic (no generation time); the PC capture
// tool and the AI processor read the same file and compare its sha256 with a pinned constant.
// Usage: node scripts/tools/sector-members.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseCatalog, cellHash } from '../catalog/parse-catalog.mjs';

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');

export function buildMembers(parsed, master) {
  const inMaster = new Set(master.companies.map(c => c.companyId));
  return [...parsed.categories].sort((a, b) => (a.id < b.id ? -1 : 1)).map(c => ({ sectorId: c.id, name: c.name,
    companyIds: [...new Set(c.memberships.map(m => m.sourceCompanyRef).filter(id => inMaster.has(id)))].sort() }));
}

export function generate() {
  const sourceText = read('tests/fixtures/catalog/source-20261114.json'), registryText = read('tests/fixtures/catalog/registry-v1.json');
  const masterText = read('data/stock-master.json');
  const parsed = parseCatalog(JSON.parse(sourceText), JSON.parse(registryText), { sourceSha256: cellHash(sourceText) });
  const body = { format: 'SECTOR_MEMBERS_V1', sourceSha256: sha(sourceText), registrySha256: sha(registryText), masterSha256: sha(masterText),
    sectors: buildMembers(parsed, JSON.parse(masterText)) };
  return JSON.stringify(body, null, 1) + '\n';
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/tools/sector-members.mjs')) {
  const text = generate();
  if (process.argv.includes('--check')) {
    if (read('data/sector-members.json') !== text) { console.error('SECTOR_MEMBERS_OUT_OF_DATE'); process.exitCode = 1; }
    else console.log(JSON.stringify({ ok: true, sha256: sha(text) }));
  } else { writeFileSync(new URL('data/sector-members.json', root), text); console.log(JSON.stringify({ sectors: JSON.parse(text).sectors.length, sha256: sha(text) })); }
}
