import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const status = JSON.parse(readFileSync(path.join(root, 'docs/development-status.json'), 'utf8'));
const stage = status.currentStage;
if(status.searchBookmarks?.stage==='6C'){
  await import('./verify-stage6c-foundation.mjs');
  await import('./verify-stage3-providers.mjs');
} else if(status.catalogConnection?.stage==='6B'){
  await import('./verify-stage6b-foundation.mjs');
  await import('./verify-stage3-providers.mjs');
} else if(status.catalogPreparation?.stage==='6A'){
  await import('./verify-stage6a-foundation.mjs');
  await import('./verify-stage3-providers.mjs');
} else if(stage===5){
  await import('./verify-stage5-foundation.mjs');
  await import('./verify-stage3-providers.mjs');
} else if(stage===4){
  await import('./verify-stage4-foundation.mjs');
  await import('./verify-stage3-providers.mjs');
} else if (stage === 2 || stage === 3) {
  await import('./verify-stage2-foundation.mjs');
  if(stage===3)await import('./verify-stage3-providers.mjs');
} else {
assert.ok(stage === 0 || stage === 1, 'Supported historical stage');
const initialCommit = 'f7dce3a9e05c39580f23a210c3ac9d2514c38b74';
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
  assert.deepEqual(data.repository, stage === 0 ? { status: 'CREATED', branch: 'main', historyOrigin: 'NEW', remoteStatus: 'PENDING', remote: null } : { status: 'CREATED', branch: 'main', historyOrigin: 'NEW', remoteStatus: 'CONFIGURED', remote: 'https://github.com/Jacop7/stocknews.git', initialCommit });
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
    if (directory === root && ['.git', 'node_modules', '.pnpm-store', '.local-tools'].includes(entry.name)) {
      if (entry.name !== '.git') assert.ok(entry.isDirectory() && !entry.isSymbolicLink(), 'Owned dependency/cache root');
      continue;
    }
    assert.ok(!entry.isSymbolicLink(), `External link/junction: ${path.join(directory, entry.name)}`);
    if (entry.isDirectory()) assertNoLinks(path.join(directory, entry.name));
  }
}

const top = git(['rev-parse', '--show-toplevel']);
check(top.status === 0 && canonical(top.stdout.trim()) === canonical(root), 'Git root matches product');
const branch = git(['branch', '--show-current']).stdout.trim();
check(stage === 0 ? branch === 'main' : ['main', 'feat/01-workspace'].includes(branch), 'Stage branch');
if (stage === 0) check(git(['remote']).stdout.trim() === '', 'No stage 0 remote');
else {
  check(git(['remote']).stdout.trim() === 'origin', 'Only authorized remote');
  for (const option of ['--all']) {
    const urls = git(['remote', 'get-url', option, 'origin']);
    check(urls.status === 0 && urls.stdout.trim() === 'https://github.com/Jacop7/stocknews.git', 'Exact authorized fetch URL');
    check(git(['remote', 'get-url', '--push', option, 'origin']).stdout.trim() === urls.stdout.trim(), 'Same authorized push URL');
  }
}
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
if (stage === 1) {
  check(head.status === 0, 'Stage 1 has reviewed base commit');
  check(git(['rev-list', '--max-parents=0', 'HEAD']).stdout.trim() === initialCommit, 'Independent initial history');
  const count = Number(git(['rev-list', '--count', 'HEAD']).stdout.trim());
  check(count === 1 || count === 2, 'Stage 1 maximum one reviewed feature commit');
  check(git(['merge-base', '--is-ancestor', initialCommit, 'HEAD']).status === 0, 'Reviewed base ancestry');
  const refs = git(['for-each-ref', '--format=%(refname)']).stdout.trim().split(/\r?\n/);
  check(refs.every(x => ['refs/heads/main', 'refs/heads/feat/01-workspace'].includes(x)) && refs.includes('refs/heads/main'), 'Only stage 1 local refs before first push');
  const main = git(['rev-parse', 'main']).stdout.trim();
  check(branch === 'main' ? main === head.stdout.trim() : main === initialCommit, 'Main only advanced by reviewed fast-forward');
} else if (head.status !== 0) {
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
check(stage === 0 ? !existsSync(path.join(root, 'package.json')) && !existsSync(path.join(root, 'pnpm-lock.yaml')) : existsSync(path.join(root, 'package.json')) && existsSync(path.join(root, 'pnpm-lock.yaml')), 'Stage-specific dependency boundary');
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

check(status.productId === 'judoju-news' && status.currentStage === stage && status.state === 'IMPLEMENTED_REVIEW_PENDING', 'Honest implementation status');
check(status.stages.length === 13 && status.stages.every((s, n) => s.stage === n && s.state === (n < stage ? 'COMPLETE' : n === stage ? 'IMPLEMENTED_REVIEW_PENDING' : 'NOT_STARTED')), 'Future stages not claimed complete');
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
check(provenance.productId === 'judoju-news' && provenance.files.length === (stage === 0 ? 9 : 10), 'Approved news source snapshots');
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
if (stage === 1) {
  const original = JSON.parse(git(['show', initialCommit + ':docs/reference/provenance.json']).stdout);
  for (const item of original.files) {
    assert.deepEqual(provenance.files.find(x => x.copy === item.copy), item); checks++;
    const bytes = git(['show', initialCommit + ':' + item.copy]).stdout;
    check(sha256(Buffer.from(bytes, 'utf8')) === item.sha256, 'Stage 0 bytes unchanged: ' + item.copy);
  }
}
const bundle = readJson('docs/reference/planning/bundle-manifest.json');
for (const file of provenance.files.filter(f => f.copy.endsWith('.md') && f.copy.includes('/planning/'))) {
  const entry = bundle.files.find(f => f.path === path.basename(file.copy));
  check(entry?.sha256 === file.sha256 && entry?.bytes === file.bytes, `Reviewed planning manifest ${file.copy}`);
}
console.log(JSON.stringify({ status: 'PASS', stage, checks, productRoot: root,
  limitations: 'Repository foundation only. No app, Supabase, Docker worker or cloud resources created.' }, null, 2));

}
