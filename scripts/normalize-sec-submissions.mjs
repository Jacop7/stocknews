import { Buffer } from 'node:buffer';
import { parseSecSubmissions, secDocumentLimit } from '../workers/collectors/src/adapters/sec-submissions.ts';

try {
  const [cik, extra] = process.argv.slice(2);
  if (!cik || extra || process.stdin.isTTY) {
    throw new Error('Usage: pipe SEC Submissions JSON into this script with one 10-digit CIK');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > secDocumentLimit) throw new Error('SEC_SUBMISSIONS_SIZE');
    chunks.push(chunk);
  }
  const input = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  const filings = parseSecSubmissions(input, cik);
  console.log(JSON.stringify({ source: 'SEC_EDGAR', cik, filings }, null, 2));
} catch (error) {
  const message = error instanceof Error && /^(SEC_SUBMISSIONS_|Usage:)/.test(error.message) ?
    error.message : 'SEC_SUBMISSIONS_INVALID_INPUT';
  console.error(message);
  process.exitCode = 1;
}
