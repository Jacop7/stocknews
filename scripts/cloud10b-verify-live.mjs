// CLOUD10B live public-read verification against the Supabase dev project (read-only; no writes, no grants).
// Reads the publishable key from .local-data/cloud-preview/publishable.key (stored by scripts/ops/cloud10b-store-key.ps1),
// never prints it, calls each of the ten allowed read RPCs once and confirms that everything else is refused.
// Writes .local-data/cloud-preview/live-result.json. With --activate and a user-authorization.txt present it also
// writes access-proof.json and public-config.json, binding the proof to those files and the tracked ACL inventory.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT, UPSTREAM, READ_RPCS, DENIED_PROBES, deniedResponse, classifyPublicKey } from './cloud-preview-public-read.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--activate')) throw new Error('UNSUPPORTED_ARGUMENT');
const root = fileURLToPath(new URL('../', import.meta.url)), folder = path.join(root, '.local-data/cloud-preview');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const key = readFileSync(path.join(folder, 'publishable.key'), 'utf8').trim();
const keyKind = classifyPublicKey(key);
const headers = { apikey: key, 'Content-Type': 'application/json', ...(keyKind === 'LEGACY_ANON_JWT' ? { Authorization: 'Bearer ' + key } : {}) };
async function call(method, route, body) {
  const response = await fetch(UPSTREAM + route, { method, headers, redirect: 'error', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  let data = null; try { data = await response.json(); } catch {}
  return { status: response.status, data };
}
const rpc = (name, body = {}) => call('POST', '/rest/v1/rpc/' + name, body);

const identity = await rpc('m1_public_identity');
if (identity.status !== 200 || identity.data?.environment !== 'preview' || identity.data?.sampleKind !== 'SYNTHETIC' || identity.data?.productId !== 'judoju-news') throw new Error('PREVIEW_IDENTITY_MISMATCH');
const tree = await rpc('catalog_public_tree', { p_expected: null });
const version = Number(tree.data?.catalog_version), leaf = tree.data?.parents?.[0]?.sectors?.[0]?.id;
if (tree.status !== 200 || !version || !leaf) throw new Error('CATALOG_TREE_UNAVAILABLE');
const allowedCalls = {
  m1_public_identity: [{}, identity], catalog_public_tree: [{ p_expected: null }, tree],
  catalog_public_sector_page: [{ p_sector: leaf, p_expected: version, p_offset: 0, p_limit: 1 }],
  catalog_public_articles: [{ p_expected: version, p_sectors: [], p_period: 'THIS_MONTH', p_limit: 1 }],
  catalog_public_search_news: [{ p_expected: version, p_query: '반도체', p_limit: 1 }],
  catalog_public_search_companies: [{ p_expected: version, p_query: '삼성', p_limit: 1 }],
  catalog_public_company_sectors: [{ p_expected: version, p_company: randomUUID(), p_offset: 0, p_limit: 1 }],
  catalog_public_saved: [{ p_expected: version, p_issues: [randomUUID()] }],
  catalog_public_company: [{ p_expected: version, p_company: randomUUID(), p_limit: 1 }],
  m1_public_article: [{ p_issue: randomUUID() }],
};
const allowed = [];
for (const name of READ_RPCS) {
  const [body, prior] = allowedCalls[name];
  const result = prior ?? await rpc(name, body);
  allowed.push({ name, status: result.status, ok: result.status === 200 && result.data !== null && typeof result.data === 'object' });
}
// Everything outside the ten must be refused: a managed event trigger, private and editor functions, writes, tables.
const deniedCalls = [
  ['rpc rls_auto_enable', () => rpc('rls_auto_enable')],
  ['rpc m1_prepare', () => rpc('m1_prepare', { p_issue: randomUUID(), p_input: {}, p_policy: 1, p_catalog: 1 })],
  ['rpc catalog_editor_tree', () => rpc('catalog_editor_tree')],
  ['rpc m1_save_draft', () => rpc('m1_save_draft', { p_issue: randomUUID(), p_expected_revision: 0, p_content: {} })],
  ['rpc catalog_editor_company', () => rpc('catalog_editor_company', { p_company: randomUUID(), p_expected: version })],
  ['table news_public', () => call('GET', '/rest/v1/news_public?select=issue_id&limit=1')],
];
if (JSON.stringify(deniedCalls.map(([name]) => name)) !== JSON.stringify(DENIED_PROBES)) throw new Error('PROBE_LIST_MISMATCH');
const denied = [];
for (const [name, run] of deniedCalls) {
  const result = await run();
  // Only a permission error or "not exposed" counts; 400/429/5xx do not prove the caller lacks access.
  const code = typeof result.data?.code === 'string' ? result.data.code : null;
  denied.push({ name, status: result.status, code, denied: deniedResponse(result.status, code, name) });
}
const pass = allowed.every(item => item.ok) && denied.every(item => item.denied);
const live = { schemaVersion: 1, stage: 'CLOUD10B', state: pass ? 'PASS' : 'FAIL', projectRef: PROJECT, observedAt: new Date().toISOString(), keyKind,
  identity: identity.data, catalogVersion: String(version), allowed, denied, writes: 0, grants: 0 };
const liveBytes = Buffer.from(JSON.stringify(live, null, 2) + '\n');
writeFileSync(path.join(folder, 'live-result.json'), liveBytes);
console.log(JSON.stringify({ state: live.state, allowed: allowed.map(item => item.name + ':' + item.status), denied: denied.map(item => item.name + ':' + item.status), keyPrinted: false }));
if (!pass) process.exit(1);

if (args.includes('--activate')) {
  const authorizationPath = path.join(folder, 'user-authorization.txt');
  if (!existsSync(authorizationPath)) throw new Error('USER_AUTHORIZATION_REQUIRED');
  const proof = { state: 'CLOUD10B_PUBLIC_READ_VERIFIED', productId: 'judoju-news', projectRef: PROJECT, environment: 'preview', dataApiEnabledObserved: true,
    writeGrants: 0, M2: false, prodWrites: 0, readRpcNames: READ_RPCS, userAuthorizationSha256: sha(readFileSync(authorizationPath)),
    reviewedResultSha256: sha(liveBytes), inventorySha256: sha(readFileSync(path.join(root, 'docs/cloud/cloud10b-acl-inventory.json'))), verifiedAt: live.observedAt };
  const proofBytes = Buffer.from(JSON.stringify(proof, null, 2) + '\n');
  writeFileSync(path.join(folder, 'access-proof.json'), proofBytes);
  writeFileSync(path.join(folder, 'public-config.json'), JSON.stringify({ productId: 'judoju-news', environment: 'preview', projectRef: PROJECT, apiUrl: UPSTREAM,
    mode: 'PREVIEW_SYNTHETIC', webOrigins: ['http://127.0.0.1:8084'], publicKey: key, proofSha256: sha(proofBytes) }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ activated: true, proof: 'access-proof.json', config: 'public-config.json', keyPrinted: false }));
}
