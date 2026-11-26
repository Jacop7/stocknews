// Developer verification for the integration branch. The C2 release verifier remains separate.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { assertEnvironmentBoundary } from './admin-preview-policy.mjs';
import { controlledEnvironment, productDirectory } from '../apps/admin/lib/preview-file-boundary.mjs';

if (process.argv.length !== 2) throw new Error('verify:integration takes no arguments');
assertEnvironmentBoundary();
const nodeVersion = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
if (process.versions.node !== nodeVersion) throw new Error('verify:integration requires Node ' + nodeVersion);

const checks = [
  ['Four-workstream regression tests', [
    '--experimental-strip-types', '--test', '--test-concurrency=2',
    'tests/list-body-queue.test.mjs',
    'tests/html-list.test.mjs',
    'tests/html-worker.test.mjs',
    'tests/collector-pacing.test.mjs',
    'tests/telegram-link-worker.test.mjs',
    'tests/public-watch.test.mjs',
    'tests/sec-submissions.test.ts',
    'tests/sec-pilot.test.mjs',
    'tests/proposal-outbox.test.mjs',
    'tests/originality-screen.test.ts',
    'tests/draft-originality.test.mjs',
    'tests/event-routing.test.ts',
    'tests/home-public-read.test.mjs',
    'tests/public-read-gateway.test.mjs',
    'tests/editor-state.test.mjs',
  ]],
  ['Saved-link backlog processing tests', [
    '--experimental-strip-types', '--test', '--test-concurrency=2',
    'tests/backlog-processing.test.mjs',
    'tests/backlog-original.test.mjs',
    'tests/backlog-model.test.mjs',
    'tests/backlog-discovery.test.mjs',
    'tests/backlog-writer.test.mjs',
    'tests/backlog-retention.test.mjs',
    'tests/backlog-source-candidates.test.mjs',
    'tests/backlog-routing.test.mjs',
    'tests/backlog-service.test.mjs',
    'tests/backlog-dart.test.mjs',
    'tests/backlog-live-formats.test.mjs',
  ]],
  ['Home ranking database smoke test', [
    '--experimental-strip-types', 'scripts/test-home-database-cadence.mjs', '--smoke',
  ]],
  ...['workers/collectors', 'workers/ai-processing', 'workers/home-ranking', 'apps/admin', 'apps/mobile'].map(folder => [
    'TypeScript ' + folder, ['node_modules/typescript/bin/tsc', '-p', folder + '/tsconfig.json', '--noEmit'],
  ]),
];

const env = controlledEnvironment();
function run(name, args, cwd = productDirectory) {
  console.log('\n' + name);
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error('Integration verification stopped at ' + name);
    process.exit(result.status ?? 1);
  }
}

for (const [name, args] of checks) run(name, args);

// Match the app package scripts using their installed entrypoints, without a nested package-manager install.
const builds = [
  ['Admin web build', 'apps/admin', 'node_modules/next/dist/bin/next', ['build']],
  ...['android', 'ios'].map(platform => [
    'Expo JS export ' + platform, 'apps/mobile', 'node_modules/expo/bin/cli',
    ['export', '--platform', platform, '--output-dir', 'dist/' + platform],
  ]),
];
for (const [name, folder, entrypoint, args] of builds) {
  assertEnvironmentBoundary();
  const cwd = join(productDirectory, folder);
  const entry = realpathSync(join(cwd, entrypoint));
  const inside = relative(productDirectory, entry);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(name + ' requires a workspace-owned dependency');
  }
  run(name, [entry, ...args], cwd);
}

console.log('\nIntegration verification passed using synthetic inputs and local builds.');
