// Reset the Docker-free local PostgreSQL, apply every migration, then run the SQL tests against it.
//   pnpm test:sql-local
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reset = spawnSync(process.execPath, ['scripts/dev/local-postgres.mjs', 'reset'], { cwd: root, encoding: 'utf8' });
process.stdout.write(reset.stdout);
if (reset.status !== 0) { process.stderr.write(reset.stderr); process.exit(reset.status ?? 1); }
const { url } = JSON.parse(reset.stdout.trim().split('\n').at(-1));
const tests = ['tests/public-card-impacts.test.mjs'];
const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit', env: { ...process.env, JUDOJU_TEST_PG_URL: url } });
process.exit(run.status ?? 1);
