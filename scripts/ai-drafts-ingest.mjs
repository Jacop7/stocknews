// Publish stage 1A: feeds an AI export file (output of `cli.mjs export-drafts`) into the local database inbox.
// Each ready snapshot is mapped to AI_DRAFT_V1 and passed to private.ai_ingest_draft (postgres, its own transaction);
// each revoked issue version is passed to private.ai_withdraw_draft. A receipt of every outcome goes to
// .local-data/ai-inbox/ (git-ignored). Nothing is printed except counts and states.
// Usage: node scripts/ai-drafts-ingest.mjs --input <export.json> [--dry-run]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { toIntakePayload } from '../workers/ai-processing/runtime/publish-map.mjs';

const args = process.argv.slice(2);
const input = args[args.indexOf('--input') + 1];
if (!args.includes('--input') || !input) throw new Error('--input required');
const dryRun = args.includes('--dry-run');
const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const psql = ['exec', '-i', 'supabase_db_judoju-news-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const sql = statement => {
  const run = spawnSync(docker, psql, { input: statement, encoding: 'utf8', windowsHide: true });
  if (run.status !== 0) return { error: (run.stderr.match(/ERROR:\s+(?:[A-Z0-9]+:\s+)?([^\n]+)/)?.[1] ?? 'PSQL_FAILED').slice(0, 200) };
  return { value: run.stdout.trim().split(/\r?\n/).at(-1) };
};

const exported = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(exported?.ready) || !Array.isArray(exported?.revoked)) throw new Error('EXPORT_FILE_INVALID');
const receipt = { at: new Date().toISOString(), input, dryRun, ready: [], revoked: [] };
for (const snapshot of exported.ready) {
  const mapped = toIntakePayload(snapshot);
  const item = { aiIssueId: snapshot.issueId, version: snapshot.version };
  if (mapped.hold) { receipt.ready.push({ ...item, outcome: 'HOLD', reason: mapped.hold }); continue; }
  if (dryRun) { receipt.ready.push({ ...item, outcome: 'MAPPED', facts: mapped.payload.facts.length, impacts: mapped.payload.draft.impacts.length }); continue; }
  const result = sql(`select private.ai_ingest_draft(${q(mapped.effectKey)},${q(JSON.stringify(mapped.payload))}::jsonb)::text;`);
  receipt.ready.push(result.error ? { ...item, outcome: 'ERROR', reason: result.error } : { ...item, outcome: JSON.parse(result.value).state, result: JSON.parse(result.value) });
}
for (const revoked of exported.revoked) {
  if (dryRun) { receipt.revoked.push({ ...revoked, outcome: 'WOULD_WITHDRAW' }); continue; }
  const result = sql(`select private.ai_withdraw_draft(${q(revoked.issueId)},${Number(revoked.version)},'SOURCE_REVOKED')::text;`);
  receipt.revoked.push(result.error ? { ...revoked, outcome: 'ERROR', reason: result.error } : { ...revoked, outcome: JSON.parse(result.value).state });
}
mkdirSync(new URL('../.local-data/ai-inbox/', import.meta.url), { recursive: true });
const file = new URL(`../.local-data/ai-inbox/receipt-${receipt.at.replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(receipt, null, 2));
const count = list => list.reduce((acc, item) => ({ ...acc, [item.outcome]: (acc[item.outcome] ?? 0) + 1 }), {});
console.log(JSON.stringify({ ready: count(receipt.ready), revoked: count(receipt.revoked), receipt: file.pathname.split('/').slice(-2).join('/') }));
