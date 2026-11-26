import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const guard = fileURLToPath(new URL('../.claude/hooks/guard.mjs', import.meta.url));
const run = command => spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' }).status;

test('Claude guard blocks remote, hosted, native, collection and C2 actions', () => {
  for (const command of [
    'ssh ubuntu@203.0.113.1', 'cd x && ssh host', 'sudo scp a host:b', 'rsync -a dist/ host:/srv',
    'aws lightsail get-instances', 'npx supabase db push', 'supabase link --project-ref x',
    'eas build -p ios', 'npx eas-cli submit', 'docker compose -f workers/collectors/compose.yaml up -d',
    'docker start judoju-news-html-collector-collector-1', 'bash scripts/providers/activate-telegram.sh',
    'node scripts/admin-preview-actual-setup.mjs apply', 'git push origin main', 'git push -f origin feat/x',
  ]) assert.equal(run(command), 2, command);
});

test('Claude guard allows local development and searches', () => {
  for (const command of [
    'grep -rn ssh docs', "grep -rn 'aws lightsail' docs", 'rsync -a a/ b/', 'eas whoami',
    'node scripts/admin-preview-actual-setup.mjs status', 'git push -u origin feat/app-vertical-slice',
    'git push --force-with-lease origin feat/x', 'pnpm test:dev-read', 'node --test tests/telegram-config.test.mjs',
    'JUDOJU_USER_APPROVED=1 ssh host',
  ]) assert.equal(run(command), 0, command);
});
