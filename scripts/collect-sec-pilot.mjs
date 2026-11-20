import { mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseSecSubmissions, secDocumentLimit } from '../workers/collectors/src/adapters/sec-submissions.ts';

const cik = '0001045810';
const sourceUrl = 'https://data.sec.gov/submissions/CIK0001045810.json';
const requestInterval = 5 * 60 * 1000;

function prepareDatabase(db) {
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sec_attempt (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      attempted_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sec_filings (
      accession TEXT PRIMARY KEY NOT NULL,
      form TEXT NOT NULL,
      filed_on TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      url TEXT NOT NULL
    ) STRICT;
  `);
}

async function readSubmissions(response) {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    await response.body?.cancel();
    throw new Error('SEC_PILOT_RESPONSE_REJECTED_' + response.status);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > secDocumentLimit) throw new Error('SEC_PILOT_RESPONSE_SIZE');
    parts.push(decoder.decode(chunk, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}

function storeFilings(db, filings) {
  const add = db.prepare('INSERT INTO sec_filings VALUES (?, ?, ?, ?, ?) ON CONFLICT(accession) DO NOTHING');
  const find = db.prepare('SELECT form, filed_on, accepted_at, url FROM sec_filings WHERE accession = ?');
  let inserted = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { accession, form, filedOn, acceptedAt, url } of filings) {
      if (add.run(accession, form, filedOn, acceptedAt, url).changes === 1) {
        inserted++;
        continue;
      }
      const saved = find.get(accession);
      if (saved.form !== form || saved.filed_on !== filedOn || saved.accepted_at !== acceptedAt || saved.url !== url) {
        throw new Error('SEC_PILOT_STORED_ACCESSION_CONFLICT');
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return inserted;
}

export async function collectSecPilot(db, { contact, request = fetch, now = Date.now() }) {
  if (typeof contact !== 'string' || contact.length > 100 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(contact)) {
    throw new Error('SEC_PILOT_CONTACT_REQUIRED');
  }
  prepareDatabase(db);
  const reserved = db.prepare(`
    INSERT INTO sec_attempt VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET attempted_at = excluded.attempted_at
    WHERE excluded.attempted_at - sec_attempt.attempted_at >= ?
  `).run(now, requestInterval);
  if (reserved.changes !== 1) return { status: 'COOLDOWN', source: 'SEC_EDGAR', cik };

  const response = await request(sourceUrl, {
    headers: { 'User-Agent': 'Judoju News ' + contact, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const filings = parseSecSubmissions(await readSubmissions(response), cik);
  const inserted = storeFilings(db, filings);
  const { count } = db.prepare('SELECT count(*) AS count FROM sec_filings').get();
  return { status: 'COLLECTED', source: 'SEC_EDGAR', cik, received: filings.length, inserted, stored: count };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (process.argv.length !== 2 || resolve(root) !== realpathSync(process.cwd())) {
    throw new Error('SEC_PILOT_REQUIRES_WORKSPACE_ROOT');
  }
  const data = join(root, '.local-data');
  const folder = join(data, 'collector-sec-pilot');
  for (const current of [data, folder]) {
    if (!lstatSync(current, { throwIfNoEntry: false })) mkdirSync(current);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(current) !== current) {
      throw new Error('SEC_PILOT_STORE_DIRECTORY');
    }
  }
  const file = join(folder, 'sec-filings.sqlite');
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file) !== file)) {
    throw new Error('SEC_PILOT_STORE_FILE');
  }
  const db = new DatabaseSync(file);
  try {
    console.log(JSON.stringify(await collectSecPilot(db, { contact: process.env.JUDOJU_SEC_CONTACT })));
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error && /^SEC_PILOT_/.test(error.message) ? error.message : 'SEC_PILOT_FAILED';
    console.error(message);
    process.exitCode = 1;
  }
}
