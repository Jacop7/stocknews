// Builds the AI processor's server config: example config + catalog (sheet-derived registry) + the OFFICIAL and
// REPORT source candidates (all DISABLED), with reads, model calls and the daily budget off.
// News candidates are not included: under the signal-only policy news is never read.
// Usage: node scripts/backlog-server-config.mjs --candidates FILE.json --out FILE.json
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../workers/ai-processing/runtime/contracts.mjs';

export function serverConfig({ example, registry, candidates }) {
  const catalog = { version: 'registry-v1:' + registry.sourceSha256.slice(0, 16),
    sectors: registry.categories.map(item => ({ id: item.id, name: item.name })),
    entities: registry.companies.map(item => ({ id: item.id, name: item.name })) };
  const linked = new Set(candidates.groups.CANDIDATE.filter(item => item.links > 0).map(item => item.host));
  // Bare hosts for every evidence candidate; the www. form only where links were actually seen (500-source limit).
  const sources = candidates.sources.filter(source => ['OFFICIAL', 'REPORT'].includes(source.kind))
    .filter(source => !source.host.startsWith('www.') || linked.has(source.host.slice(4)));
  assert(sources.every(source => source.status === 'DISABLED'), 'CANDIDATES_MUST_BE_DISABLED');
  return validateConfig({ ...example, readOriginals: false, callModels: false, maxDailyCalls: 0, newsAsSignalOnly: true, catalog, sources });
}

function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) options[argv[index]] = argv[index + 1];
  assert(options['--candidates'] && options['--out'], 'USAGE: --candidates FILE --out FILE');
  const read = url => JSON.parse(readFileSync(url, 'utf8'));
  const config = serverConfig({ example: read(new URL('../workers/ai-processing/runtime/config.example.json', import.meta.url)),
    registry: read(new URL('../tests/fixtures/catalog/registry-v1.json', import.meta.url)), candidates: read(resolve(options['--candidates'])) });
  writeFileSync(resolve(options['--out']), JSON.stringify(config, null, 2));
  console.log(JSON.stringify({ sectors: config.catalog.sectors.length, entities: config.catalog.entities.length, sources: config.sources.length,
    readOriginals: config.readOriginals, callModels: config.callModels, maxDailyCalls: config.maxDailyCalls, models: config.models }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
