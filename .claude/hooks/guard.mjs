// PreToolUse guard for Bash. Blocks actions this project must never take
// without an explicit, current user instruction: remote servers, hosted DB
// changes, native/store builds, collection restart and admin activation.
// Exit code 2 blocks the call and shows the reason to Claude.
// Override for one command only after the user explicitly asked for it:
// prefix the command with JUDOJU_USER_APPROVED=1 and say so in the reply.
import { readFileSync } from 'node:fs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const command = String(input?.tool_input?.command ?? '');
if (!command || /(^|\s)JUDOJU_USER_APPROVED=1\s/.test(command)) process.exit(0);

const rules = [
  // Command position only (start, or after ; & | ( or sudo), so a grep for the word passes.
  [/(^|[;&|(]\s*|\bsudo\s+)(ssh|scp|sftp)\s/, 'Remote server access (AWS Lightsail worker etc.)'],
  [/(^|[;&|(]\s*|\bsudo\s+)rsync\s[^|;&]*\S+:/, 'Remote copy'],
  [/(^|[;&|(]\s*|\bsudo\s+)aws\s/, 'AWS access'],
  [/supabase\s+(db\s+(push|reset\s+--linked|remote)|link|functions\s+deploy|secrets|projects)/, 'Hosted Supabase change'],
  [/(^|[;&|(]\s*)(eas|npx\s+eas(-cli)?|pnpm\s+(exec\s+|dlx\s+)?eas(-cli)?)\s+(build|submit|update|credentials)/, 'EAS native build/submit/update'],
  [/judoju-news-(html-collector|telegram)|compose\.telegram\.yaml|activate-telegram|JUDOJU_TELEGRAM_LINKS|workers\/collectors\/compose/, 'Link collection is paused by the user (2026-11-21)'],
  [/admin-preview-actual-setup\.mjs(?!\s+status\b)|pnpm\s+(run\s+)?admin:actual(?!\s+status\b)/, 'Admin C2 activation needs separate human confirmation'],
  [/git\s+push\b[^\n]*(--force(?!-with-lease)|\s-f\b|\s(origin\s+)?main\b|:main\b)/, 'Push to main or force push'],
];
for (const [pattern, reason] of rules) {
  if (pattern.test(command)) {
    process.stderr.write(`BLOCKED by .claude/hooks/guard.mjs: ${reason}.\n` +
      'Ask the user first. Only after explicit approval, prefix the single command with JUDOJU_USER_APPROVED=1.\n');
    process.exit(2);
  }
}
process.exit(0);
