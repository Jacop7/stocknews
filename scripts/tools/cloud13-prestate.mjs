import { readFileSync, writeFileSync } from 'node:fs';
const dir = 'supabase/cloud/real-intake-dev/';
const obs = JSON.parse(readFileSync(dir + 'cloud-observed.json', 'utf8'));
const defs = JSON.parse(readFileSync(dir + 'cloud-observation.json', 'utf8')).defs;
const cloudSel = defs['private.catalog_sector_selectable(p_sector uuid, p_catalog bigint, p_article_mode text)'].split('\n');
const idLine = cloudSel.find(l => l.startsWith(" and exists(select 1 from private.runtime_identity where singleton"));
if (!idLine) throw new Error('cloud identity line');
const KEYS = ['functions', 'columns', 'relations', 'constraints', 'triggers', 'policies'];
const state = {
  schemaVersion: 1, stage: 'CLOUD13', productId: 'judoju-news', projectRef: 'nxfpfvsdwbziowkxsxnh', observedAt: '2026-11-28',
  method: 'Read-only SQL Editor observation (cloud-observation.json) -> cloud-observed.json; after = rehearsal result (scripts/cloud13-rehearse.mjs --capture)',
  migrations: obs.migrations, record: { version: '20261128000108', name: 'cloud13_real_intake' },
  cloud: {
    localSectorSelectable: " and exists(select 1 from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null)\n and exists(select 1 from private.catalog_head h",
    cloudSectorSelectable: idLine + "\n and exists(select 1 from private.catalog_head h",
  },
  before: Object.fromEntries(KEYS.map(k => [k, obs[k]])),
  realModeAfter: null,
  after: {},
};
writeFileSync(dir + 'prestate.json', JSON.stringify(state, null, 1) + '\n');
console.log('ok', idLine.length);
