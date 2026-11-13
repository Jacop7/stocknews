import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync, lstatSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
const json = p => JSON.parse(readFileSync(path.join(root,p),'utf8'));
function validateCliEnvironment(env) {
  assert.ok(!Object.hasOwn(env, 'SUPABASE_CLI_BINARY_OVERRIDE'), 'Supabase binary override is forbidden');
}
function internal(real) {
  const relative = path.relative(root,realpathSync(real));
  check(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Product-local execution/dependency path');
  return realpathSync(real);
}
function walk(directory) {
  for (const entry of readdirSync(directory,{withFileTypes:true})) {
    const full = path.join(directory,entry.name);
    if (lstatSync(full).isSymbolicLink()) internal(full);
    else if (entry.isDirectory()) walk(full);
  }
}
validateCliEnvironment(process.env); checks++;
assert.throws(() => validateCliEnvironment({SUPABASE_CLI_BINARY_OVERRIDE:'outside.exe'})); checks++;
assert.throws(() => validateCliEnvironment({SUPABASE_CLI_BINARY_OVERRIDE:''})); checks++;
assert.throws(() => internal(path.dirname(root))); checks++;
check(existsSync(path.join(root,'node_modules')), 'Installed dependencies required');
// Inspect all links before invoking any installed tool. Optional caches need not exist on a new checkout.
for (const directory of ['node_modules','.local-tools','.pnpm-store']) {
  const full = path.join(root,directory);
  if (existsSync(full)) {
    check(lstatSync(full).isDirectory() && !lstatSync(full).isSymbolicLink(), 'Owned dependency/cache directory');
    walk(full);
  }
}
const pkg = json('package.json'), workspace = json('pnpm-workspace.yaml');
check(process.versions.node === '24.15.0', 'Exact Node version');
check(pkg.private === true && pkg.name === '@judoju/news', 'Private product workspace');
assert.deepEqual(pkg.engines, {node:'24.15.0',pnpm:'11.25.0'}); checks++;
assert.deepEqual(pkg.devDependencies, {supabase:'3.1.0',typescript:'6.0.3'}); checks++;
check(pkg.packageManager === 'pnpm@11.25.0', 'Pinned package manager');
check(/^pnpm\/11\.25\.0(?: |$)/.test(process.env.npm_config_user_agent || ''), 'Run through exact pnpm');
assert.deepEqual(workspace.packages,['apps/*','packages/*','workers/*']); checks++;
check(workspace.engineStrict === true && workspace.saveExact === true && workspace.ignoreScripts === true && workspace.storeDir === '.pnpm-store', 'Install boundaries');
check(readFileSync(path.join(root,'.npmrc'),'utf8').trim() === 'registry=https://registry.npmjs.org/', 'Official registry only');
check(readFileSync(path.join(root,'.node-version'),'utf8').trim() === '24.15.0','Node version file');
const lock = readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8');
check(lock.startsWith("lockfileVersion: '9.0'"), 'Supported lock format');
for (const name of ['supabase','typescript']) {
  const installed = json('node_modules/'+name+'/package.json');
  check(installed.version === pkg.devDependencies[name], 'Installed '+name);
  const entry = typeof installed.bin === 'string' ? installed.bin : installed.bin[name === 'typescript' ? 'tsc' : name];
  const command = internal(path.join(root,'node_modules',name,entry));
  let executable = process.execPath, args = [command,'--version'];
  if (name === 'supabase') {
    const requireFromShim = createRequire(command);
    const os = {win32:'windows',darwin:'darwin',linux:'linux'}[process.platform];
    const musl = process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? '-musl' : '';
    const platformPackage = '@supabase/cli-'+os+'-'+process.arch+musl;
    const meta = internal(requireFromShim.resolve(platformPackage+'/package.json'));
    check(JSON.parse(readFileSync(meta,'utf8')).version === installed.version, 'Exact platform binary package');
    executable = internal(path.join(path.dirname(meta),'bin','supabase'+(process.platform === 'win32' ? '.exe' : '')));
    args = ['--version'];
  }
  const result = spawnSync(executable,args,{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env}});
  check(!result.error && result.status === 0 && result.stdout.trim() === (name === 'typescript' ? 'Version ' : '')+installed.version, 'Actual '+name+' executable');
  check(lock.includes(name+'@'+installed.version+':') && lock.includes('specifier: '+installed.version), 'Locked '+name);
}
const integrity = [...lock.matchAll(/resolution: \{([^}]+)\}/g)];
check(integrity.length > 0 && integrity.every(m => /^integrity: sha512-[A-Za-z0-9+/]+=*$/.test(m[1])), 'Every package uses registry integrity');
check(!/(?:^|[\s'{])(?:https?:|file:|git\+|link:)/m.test(lock), 'No alternate source URLs in tooling lock');
const editor = readFileSync(path.join(root,'.editorconfig'),'utf8');
for (const section of ['docs/reference/planning/**','docs/stages/**']) {
  check(editor.includes('['+section+']\ncharset = unset\nend_of_line = unset\ninsert_final_newline = unset'), 'Immutable EditorConfig '+section);
}
const readiness = json('docs/environment-readiness.json');
check(readiness.productId === 'judoju-news' && readiness.productionReady === false, 'Readiness not deployment approval');
check(readiness.ios.status === 'PENDING' && readiness.android.buildTested === false, 'No untested build claims');
const preparationIds = new Set(json('docs/external-preparation.json').items.map(i=>i.id));
function validateObservation(section) {
  assert.ok(['AVAILABLE','PENDING'].includes(section.status));
  assert.ok(typeof section.pendingReason === 'string' && section.pendingReason.length > 0);
  assert.ok(typeof section.userAction === 'string' && section.userAction.length > 0);
  assert.ok(section.affectedStages.length > 0 && section.affectedStages.every(n=>Number.isInteger(n) && n >= 2 && n <= 12));
  assert.ok(section.preparationRefs.length > 0 && section.preparationRefs.every(id=>preparationIds.has(id)));
  assert.ok(section.observations.length > 0);
  for (const item of section.observations) {
    assert.ok(Array.isArray(item.command) && item.command.length > 0 && item.command.every(s=>typeof s === 'string' && s.length > 0));
    assert.ok(Number.isInteger(item.exitCode));
    assert.ok(typeof item.observedAt === 'string' && Number.isFinite(Date.parse(item.observedAt)));
    assert.ok(Object.hasOwn(item,'value'));
    if (section.status === 'AVAILABLE') assert.equal(item.exitCode,0);
  }
}
for (const name of ['docker','wsl','android','ios','expo','ci','stores']) {
  validateObservation(readiness[name]); checks++;
}
const missingObservation = structuredClone(readiness.docker);
delete missingObservation.observations[0].observedAt;
assert.throws(()=>validateObservation(missingObservation)); checks++;
const wrongReference = structuredClone(readiness.ios);
wrongReference.preparationRefs = ['not-a-preparation-id'];
assert.throws(()=>validateObservation(wrongReference)); checks++;
console.log(JSON.stringify({status:'PASS',stage:1,checks,node:process.versions.node,pnpm:'11.25.0',typescript:'6.0.3',supabase:'3.1.0',limitations:'Version and integrity checks only; no app build or Supabase initialization.'},null,2));
