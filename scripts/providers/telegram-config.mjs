import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { telegramAuthorization, telegramPageCandidates } from './telegram-link-worker.mjs';

const held = new Set([16, 19, 32, 36, 43, 48]);

export function prepareTelegramConfig(catalog, registry, baseline, enabledAt) {
  assert.equal(catalog.endpoints.length, 113);
  assert.equal(registry.profiles.length, 113);
  assert.deepEqual(catalog.routes, baseline.routes);
  assert.equal(baseline.endpoints.length, 112);
  for (const endpoint of baseline.endpoints) {
    const current = catalog.endpoints.find(item => item.endpoint_id === endpoint.endpoint_id);
    assert.equal(current?.url, endpoint.url);
  }
  assert.equal(catalog.endpoints.filter(item => item.metadata_collection).length, 37);
  assert.equal(catalog.endpoints.filter(item => item.status === 'DISABLED').length, 20);
  assert(catalog.endpoints.every(item => !item.telegram_link_collection));
  const timestamp = Date.parse(enabledAt);
  assert(Number.isFinite(timestamp) && timestamp <= Date.now());
  const selected = new Set(catalog.routes.filter(route => route.effective_kind === 'TELEGRAM' &&
    !held.has(route.original_row)).flatMap(route => route.endpoint_ids));
  assert.equal(selected.size, 47);
  const result = JSON.parse(JSON.stringify(catalog));
  for (const endpoint of result.endpoints) if (selected.has(endpoint.endpoint_id)) {
    assert(/^https:\/\/t\.me\/s\/[a-z0-9_]+$/i.test(endpoint.url));
    endpoint.telegram_link_collection = {
      mode: 'PUBLIC_EXTERNAL_LINKS_V1', endpoint_id: endpoint.endpoint_id, list_url: endpoint.url,
      authorization: telegramAuthorization, enabled_at: enabledAt, retention_days: 7,
    };
  }
  assert.equal(telegramPageCandidates({ ...result, profiles: registry.profiles }, timestamp).size, 47);
  for (let index = 0; index < result.endpoints.length; index++) {
    const { telegram_link_collection: added, ...unchanged } = result.endpoints[index];
    assert.deepEqual(unchanged, catalog.endpoints[index]);
    assert.equal(Boolean(added), selected.has(unchanged.endpoint_id));
  }
  assert.deepEqual({ ...result, endpoints: catalog.endpoints }, catalog);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, enabledAt = new Date().toISOString()] = process.argv.slice(2);
  assert(input && output, 'Pass current deployed config and an empty output directory');
  const catalog = JSON.parse(readFileSync(join(input, 'routes.json'), 'utf8'));
  const registryBytes = readFileSync(join(input, 'permission-profiles.json'));
  const registry = JSON.parse(registryBytes);
  const baseline = JSON.parse(readFileSync(new URL('../../data/providers/routes.json', import.meta.url), 'utf8'));
  const result = prepareTelegramConfig(catalog, registry, baseline, enabledAt);
  writeFileSync(join(output, 'routes.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(join(output, 'permission-profiles.json'), registryBytes, { flag: 'wx' });
  console.log(JSON.stringify({ enabled: 47, held: 6, profilesUnchanged: true, webMetadataUnchanged: 37, disabledUnchanged: 20 }));
}
