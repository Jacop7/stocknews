import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
const readJson = relative => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizeWindows = value => path.win32.normalize(value.replaceAll('/', '\\')).toLowerCase();
const canonical = value => {
  const actual = realpathSync(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? actual.toLowerCase() : actual;
};
function git(args, input) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', '-C', root, ...args], {
    encoding: 'utf8', input, windowsHide: true,
  });
  assert.ifError(result.error);
  return result;
}
const resourceIds = ['expo_eas', 'supabase_local', 'supabase_preview', 'supabase_production',
  'worker_local', 'worker_preview', 'worker_production', 'admin_hosting', 'push_ads', 'observability', 'backups', 'ci_cd', 'environment_secrets'];
function validateResources(data, expectedRoot) {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.productId, 'judoju-news');
  assert.equal(canonical(data.productRoot), canonical(expectedRoot));
  assert.deepEqual(data.repository, { status: 'CREATED', branch: 'main', historyOrigin: 'NEW', remoteStatus: 'PENDING', remote: null });
  assert.deepEqual(data.resources.map(r => r.id).sort(), [...resourceIds].sort());
  for (const resource of data.resources) {
    assert.equal(resource.status, 'PENDING');
    assert.equal(resource.actual, null, `Uncreated resource has a connection: ${resource.id}`);
    assert.equal(resource.plannedNamespace, `judoju-news-${resource.id.replaceAll('_', '-')}`);
    assert.ok(['local', 'preview', 'production', 'all'].includes(resource.environment));
  }
}
function withinRoot(relative) {
  assert.equal(typeof relative, 'string');
  assert.ok(!path.isAbsolute(relative));
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  assert.ok(rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel), `Outside root: ${relative}`);
  return resolved;
}
function assertNoLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === '.git') continue;
    assert.ok(!entry.isSymbolicLink(), `External link/junction: ${path.join(directory, entry.name)}`);
    if (entry.isDirectory()) assertNoLinks(path.join(directory, entry.name));
  }
}

const top = git(['rev-parse', '--show-toplevel']);
check(top.status === 0 && canonical(top.stdout.trim()) === canonical(root), 'Git root matches product');
check(git(['branch', '--show-current']).stdout.trim() === 'main', 'Initial main branch');
check(git(['remote']).stdout.trim() === '', 'No remote connected');
check(!existsSync(path.join(root, '.gitmodules')), 'No submodule configuration');
const gitDirectory = path.join(root, '.git');
check(lstatSync(gitDirectory).isDirectory() && !lstatSync(gitDirectory).isSymbolicLink(), 'Own Git directory, not gitdir link');
assertNoLinks(gitDirectory); checks++;
const commonDirectory = git(['rev-parse', '--git-common-dir']);
check(commonDirectory.status === 0 && canonical(path.resolve(root, commonDirectory.stdout.trim())) === canonical(gitDirectory), 'No shared common Git directory');
check(!existsSync(path.join(gitDirectory, 'objects/info/alternates')), 'No borrowed object store');
const externalConfig = git(['config', '--local', '--name-only', '--get-regexp', '^(include\\.|includeif\\.|core\\.hookspath$)']);
check(externalConfig.status === 1 && externalConfig.stdout.trim() === '', 'No local external includes or hooksPath');
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
  check(!process.env[name], `No inherited Git routing: ${name}`);
}
const head = git(['rev-parse', '--verify', 'HEAD']);
if (head.status !== 0) {
  check(head.status === 128, 'Initial HEAD is unborn');
  const refs = git(['for-each-ref', '--format=%(refname)']);
  check(refs.status === 0 && refs.stdout.trim() === '', 'No pre-existing refs');
  const objects = git(['count-objects', '-v']);
  check(objects.status === 0 && /^count: 0$/m.test(objects.stdout) && /^in-pack: 0$/m.test(objects.stdout), 'No pre-existing commit objects');
} else {
  const history = git(['rev-list', '--count', 'HEAD']);
  check(history.status === 0 && history.stdout.trim() === '1', 'Only the initial reviewed commit');
  const parentLine = git(['rev-list', '--parents', '-n', '1', 'HEAD']);
  check(parentLine.status === 0 && parentLine.stdout.trim().split(/\s+/).length === 1, 'Initial commit has no inherited parent');
}
assertNoLinks(root); checks++;
for (const name of ['README.md', 'AGENTS.md', '.gitignore', '.gitattributes', '.editorconfig',
  'docs/project-resource-manifest.json', 'docs/development-status.json', 'docs/external-preparation.json',
  'docs/reference/provenance.json', 'docs/stages/stage-00-plan.md']) {
  check(existsSync(withinRoot(name)), `Required file: ${name}`);
}
check(!existsSync(path.join(root, 'package.json')) && !existsSync(path.join(root, 'pnpm-lock.yaml')), 'No dependencies installed in stage 0');
const resources = readJson('docs/project-resource-manifest.json');
validateResources(resources, root); checks++;

// Non-mutating negative cases: resource status must never authorize a live endpoint.
const badEndpoint = structuredClone(resources);
badEndpoint.resources[0].actual = { endpoint: 'https://invalid.example' };
assert.throws(() => validateResources(badEndpoint, root)); checks++;
const badProduct = structuredClone(resources); badProduct.productId = 'other-product';
assert.throws(() => validateResources(badProduct, root)); checks++;
const badRoot = structuredClone(resources); badRoot.productRoot = path.dirname(root);
assert.throws(() => validateResources(badRoot, root)); checks++;
const badNamespace = structuredClone(resources); badNamespace.resources[0].plannedNamespace = 'other-product';
assert.throws(() => validateResources(badNamespace, root)); checks++;
check(normalizeWindows('C:/Users/Jacop/주식/judoju-news') === normalizeWindows('c:\\users\\jacop\\주식\\JUDOJU-NEWS'), 'Windows separators/case/Korean path');
check(normalizeWindows('C:/Users/jacop/주식/judoju-news') !== normalizeWindows('C:/Users/jacop/주식/other'), 'Different roots rejected');
assert.throws(() => withinRoot('../outside')); checks++;

const privateNames = ['.env', '.env.local', 'apps/mobile/.env.production', 'secrets/key.pem', 'signing/app.p12',
  'signing/app.pfx', 'signing/app.jks', 'signing/app.keystore', 'secrets/provider-credentials.json',
  'node_modules/package/index.js', '.local-data/db', 'docker-data/db', 'supabase/.temp/project-ref',
  'dist/output.js', 'build/app.apk', '.codex/runtime.json', 'AuthKey_test.p8', 'signing/profile.mobileprovision',
  'service-account.json', 'prod.env', 'secrets/id_rsa', 'secrets/id_ed25519', 'android/google-services.json', 'ios/GoogleService-Info.plist'];
const ignored = git(['check-ignore', '--no-index', '--stdin'], privateNames.join('\n') + '\n');
check(ignored.status === 0, 'Private path ignore check');
const ignoredSet = new Set(ignored.stdout.trim().split(/\r?\n/));
for (const name of privateNames) check(ignoredSet.has(name), `Ignored: ${name}`);
for (const name of ['.env.example', 'apps/mobile/.env.example', 'docs/project-resource-manifest.json']) {
  check(git(['check-ignore', '--no-index', name]).status === 1, `Trackable: ${name}`);
}

const status = readJson('docs/development-status.json');
check(status.productId === 'judoju-news' && status.currentStage === 0 && status.state === 'IMPLEMENTED_REVIEW_PENDING', 'Honest implementation status');
check(status.stages.length === 13 && status.stages.every((s, n) => s.stage === n && s.state === (n === 0 ? 'IMPLEMENTED_REVIEW_PENDING' : 'NOT_STARTED')), 'Future stages not claimed complete');
const preparation = readJson('docs/external-preparation.json');
const preparationIds = ['store_account_type', 'apple_developer_registration', 'google_play_registration', 'test_devices',
  'closed_test_testers', 'market_data_permission', 'news_source_permission', 'hosting_account_region', 'privacy_inventory_draft'];
check(preparation.productId === 'judoju-news' && preparation.schemaVersion === 1, 'Preparation table ownership');
assert.deepEqual(preparation.items.map(i => i.id).sort(), preparationIds.sort()); checks++;
for (const item of preparation.items) {
  check(item.status === 'PENDING' && item.estimatedAt === null && item.costStatus === 'UNCONFIRMED', `Unverified preparation: ${item.id}`);
  check(item.ownerRole === 'project_owner' && item.requiresUserAction === true && item.userAction.length > 0 && item.pendingReason.length > 0,
    `Preparation responsibility: ${item.id}`);
  check(item.relatedStages.length > 0 && item.relatedStages.every(n => Number.isInteger(n) && n >= 1 && n <= 12), `Preparation dependencies: ${item.id}`);
}

// Portable validation: never read source paths outside the product. Bootstrap checks originals once.
const provenance = readJson('docs/reference/provenance.json');
check(provenance.productId === 'judoju-news' && provenance.files.length === 9, 'Nine approved news source snapshots');
const seen = new Set();
for (const file of provenance.files) {
  check(!seen.has(file.copy), `Unique snapshot ${file.copy}`); seen.add(file.copy);
  const bytes = readFileSync(withinRoot(file.copy));
  check(bytes.length === file.bytes && sha256(bytes) === file.sha256, `Snapshot integrity ${file.copy}`);
  const originalBlob = git(['hash-object', '--no-filters', '--stdin'], bytes);
  const filteredBlob = git(['hash-object', `--path=${file.copy}`, '--stdin'], bytes);
  check(originalBlob.status === 0 && filteredBlob.status === 0 && originalBlob.stdout.trim() === filteredBlob.stdout.trim(),
    `Git commit filters preserve snapshot bytes ${file.copy}`);
}
const bundle = readJson('docs/reference/planning/bundle-manifest.json');
for (const file of provenance.files.filter(f => f.copy.endsWith('.md') && f.copy.includes('/planning/'))) {
  const entry = bundle.files.find(f => f.path === path.basename(file.copy));
  check(entry?.sha256 === file.sha256 && entry?.bytes === file.bytes, `Reviewed planning manifest ${file.copy}`);
}
console.log(JSON.stringify({ status: 'PASS', stage: 0, checks, productRoot: root,
  limitations: 'Repository foundation only. No app, Supabase, Docker worker or cloud resources created.' }, null, 2));
