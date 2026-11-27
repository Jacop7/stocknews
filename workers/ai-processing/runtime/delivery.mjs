// Publish stage 2A (docs/publish-stage2-plan.md S5): durable delivery of AI drafts and withdrawals to the cloud preview
// intake. Every request is built once, stored exactly (canonical JSON text and its hash) and resent unchanged under the
// same effect key, so the database receipt makes a retry return the same result. A revocation stops every unfinished
// SUBMIT of that AI issue, wipes its content and queues a WITHDRAW, which is never given up by attempt count.
// Content is kept only while needed: terminal rows keep keys, hashes and a result summary; content-free rows go after
// 90 days. Nothing here talks to the network; send functions come from the caller (see createPgIntakeClient).
import { createHash } from 'node:crypto';
import { canonical, day } from './contracts.mjs';
import { toIntakePayload } from './publish-map.mjs';

export const TARGET = 'cloud';
export const SUBMIT_MAX_ATTEMPTS = 10, BATCH = 20, MAX_BACKOFF = 6 * 3600_000, KEEP_RECORDS = 90 * day;
const sha = text => createHash('sha256').update(text).digest('hex');

export function ensureDeliveries(db, now = Date.now()) {
  // Tables, back-fill and its completion marker commit together: a failed upgrade leaves nothing and runs again.
  let backfilled = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
  db.exec(`CREATE TABLE IF NOT EXISTS deliveries(target TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('SUBMIT','WITHDRAW')),
    ai_issue_id TEXT NOT NULL,ai_version INTEGER NOT NULL,effect_key TEXT NOT NULL,request TEXT,request_sha256 TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PENDING','DONE','FAILED','SUPERSEDED')),result TEXT,attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,expires_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(target,effect_key)) STRICT`);
  db.exec('CREATE TABLE IF NOT EXISTS delivery_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL) STRICT');
  if (db.prepare("SELECT 1 FROM delivery_meta WHERE key='backfill_done'").get()) { db.exec('COMMIT'); return { backfilled: 0 }; }
  // Upgrade of an existing processor database: still-present snapshots become deliveries.
    for (const row of db.prepare("SELECT issue_id,version,state,payload,expires_at FROM draft_exports ORDER BY created_at,issue_id,version").all()) {
      if (row.expires_at <= now) continue;
      if (row.state === 'READY') backfilled += enqueueSubmit(db, JSON.parse(row.payload), now, row.expires_at) ? 1 : 0;
    }
    for (const row of db.prepare("SELECT issue_id,max(version) version FROM draft_exports WHERE state='REVOKED' AND expires_at>? GROUP BY issue_id").all(now)) {
      backfilled += enqueueWithdraw(db, row.issue_id, row.version, now) ? 1 : 0;
    }
    db.prepare("INSERT INTO delivery_meta(key,value) VALUES ('backfill_done',?)").run(now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { backfilled };
}

// SUBMIT for one ready snapshot (called inside the snapshot's transaction). A snapshot the mapper holds is recorded
// as FAILED with its reason and no content. Older never-sent SUBMITs of the same AI issue are superseded.
export function enqueueSubmit(db, snapshot, now, snapshotExpiresAt = now + 30 * day) {
  // A mapping error never breaks the snapshot transaction: it is recorded like a hold.
  let mapped;
  try { mapped = toIntakePayload(snapshot); } catch { mapped = { hold: 'MAPPING_FAILED' }; }
  const issue = snapshot.issueId, version = snapshot.version;
  const key = `ai:${issue}:${version}`;
  if (mapped.hold) {
    return db.prepare(`INSERT INTO deliveries(target,operation,ai_issue_id,ai_version,effect_key,request,request_sha256,state,result,next_attempt_at,expires_at,created_at,updated_at)
      VALUES (?,'SUBMIT',?,?,?,NULL,?,'FAILED',?,?,?,?,?) ON CONFLICT(target,effect_key) DO NOTHING`)
      .run(TARGET, issue, version, key, sha(''), canonical({ hold: mapped.hold }), now, snapshotExpiresAt, now, now).changes > 0;
  }
  const request = canonical({ effectKey: mapped.effectKey, payload: mapped.payload });
  db.prepare(`UPDATE deliveries SET state='SUPERSEDED',request=NULL,updated_at=? WHERE target=? AND operation='SUBMIT' AND ai_issue_id=? AND ai_version<?
    AND state='PENDING' AND attempts=0`).run(now, TARGET, issue, version);
  return db.prepare(`INSERT INTO deliveries(target,operation,ai_issue_id,ai_version,effect_key,request,request_sha256,state,next_attempt_at,expires_at,created_at,updated_at)
    VALUES (?,'SUBMIT',?,?,?,?,?,'PENDING',?,?,?,?) ON CONFLICT(target,effect_key) DO NOTHING`)
    .run(TARGET, issue, version, mapped.effectKey, request, sha(request), now, Math.min(snapshotExpiresAt, now + 30 * day), now, now).changes > 0;
}

// Revocation of an AI issue (called inside the revocation's transaction): every unfinished SUBMIT stops and loses its
// content, and one WITHDRAW for the newest version is queued (identifiers only, kept until the server confirms).
export function enqueueWithdraw(db, issue, version, now) {
  // Only versions up to the withdrawn one stop; a newer version (received after a historical revocation) stays.
  db.prepare(`UPDATE deliveries SET state='SUPERSEDED',request=NULL,updated_at=? WHERE target=? AND operation='SUBMIT' AND ai_issue_id=? AND ai_version<=? AND state='PENDING'`).run(now, TARGET, issue, version);
  const key = `ai-withdraw:${issue}:${version}`;
  const request = canonical({ effectKey: key, aiIssueId: issue, version, reason: 'SOURCE_REVOKED' });
  return db.prepare(`INSERT INTO deliveries(target,operation,ai_issue_id,ai_version,effect_key,request,request_sha256,state,next_attempt_at,expires_at,created_at,updated_at)
    VALUES (?,'WITHDRAW',?,?,?,?,?,'PENDING',?,NULL,?,?) ON CONFLICT(target,effect_key) DO NOTHING`)
    .run(TARGET, issue, version, key, request, sha(request), now, now, now).changes > 0;
}

// Housekeeping, run with every delivery pass: expired SUBMITs end as FAILED(EXPIRED) without content; content-free
// terminal rows go after 90 days.
export function maintainDeliveries(db, now) {
  const expired = db.prepare(`UPDATE deliveries SET state='FAILED',request=NULL,result=?,updated_at=? WHERE operation='SUBMIT' AND state='PENDING' AND expires_at<=?`)
    .run(canonical({ reason: 'EXPIRED' }), now, now).changes;
  db.prepare("UPDATE deliveries SET request=NULL WHERE state<>'PENDING' AND request IS NOT NULL").run();
  const removed = db.prepare("DELETE FROM deliveries WHERE state<>'PENDING' AND request IS NULL AND updated_at<=?").run(now - KEEP_RECORDS).changes;
  return { expired, removed };
}

// Committed results the intake functions return; anything else (null, unknown) stays uncertain and is retried.
const COMMITTED = { SUBMIT: new Set(['RECEIVED', 'HOLD_EDITOR', 'STALE_VERSION', 'WITHDRAWN', 'CATALOG_DRIFT']), WITHDRAW: new Set(['WITHDRAWN', 'STALE_VERSION']) };
const backoff = attempts => Math.min(MAX_BACKOFF, 60_000 * 2 ** Math.max(0, attempts - 1));
// Server answers that are final: a committed result, or a definite refusal of the request itself.
const DEFINITE = /^(AI_DRAFT_[A-Z_]+|AI_EFFECT_KEY_MISMATCH|AI_WITHDRAW_INVALID|AI_PAYLOAD_[A-Z_]+|AI_INTAKE_[A-Z_]+|EFFECT_PAYLOAD_CONFLICT|REAL_[A-Z_]+|INVALID_[A-Z_]+)$/;

// One delivery pass. Due: every WITHDRAW whose time has come; every SUBMIT retry whose backoff has passed; first-time
// SUBMITs only when submitDue (the daily window). client.submit / client.withdraw throw
// Error objects whose `code` is 'P0001' (a raised refusal, message = reason) or anything else (uncertain).
export async function deliver(db, client, now, { submitDue = false, limit = BATCH } = {}) {
  const maintenance = maintainDeliveries(db, now);
  const rows = db.prepare(`SELECT * FROM deliveries WHERE target=? AND state='PENDING' AND next_attempt_at<=? AND (operation='WITHDRAW' OR attempts>0 OR ?)
    ORDER BY CASE operation WHEN 'WITHDRAW' THEN 0 ELSE 1 END, next_attempt_at, created_at LIMIT ?`).all(TARGET, now, submitDue ? 1 : 0, limit);
  const out = { sent: 0, done: 0, failed: 0, retry: 0, maintenance };
  let firstSubmits = 0;
  for (const row of rows) {
    // The stored request is sent exactly as stored, never rebuilt.
    if (row.request === null || sha(row.request) !== row.request_sha256) {
      db.prepare("UPDATE deliveries SET state='FAILED',request=NULL,result=?,updated_at=? WHERE target=? AND effect_key=?").run(canonical({ reason: 'REQUEST_MISSING' }), now, row.target, row.effect_key);
      out.failed++; continue;
    }
    const request = JSON.parse(row.request);
    out.sent++;
    if (row.operation === 'SUBMIT' && row.attempts === 0) firstSubmits++;
    try {
      const result = row.operation === 'SUBMIT' ? await client.submit(request.effectKey, request.payload)
        : await client.withdraw(request.effectKey, request.aiIssueId, request.version, request.reason);
      if (!COMMITTED[row.operation].has(result?.state)) throw Object.assign(new Error('RESULT_UNRECOGNIZED'), { code: 'UNCERTAIN' });
      db.prepare("UPDATE deliveries SET state='DONE',request=NULL,result=?,attempts=attempts+1,updated_at=? WHERE target=? AND effect_key=? AND state='PENDING'")
        .run(canonical({ state: result?.state ?? null }), now, row.target, row.effect_key);
      out.done++;
      setMeta(db, 'last_success', now);
    } catch (error) {
      const reason = typeof error?.message === 'string' ? error.message.slice(0, 120) : 'UNKNOWN';
      const attempts = row.attempts + 1;
      if (error?.code === 'P0001' && DEFINITE.test(reason) || row.operation === 'SUBMIT' && attempts >= SUBMIT_MAX_ATTEMPTS) {
        db.prepare("UPDATE deliveries SET state='FAILED',request=NULL,result=?,attempts=?,updated_at=? WHERE target=? AND effect_key=? AND state='PENDING'")
          .run(canonical({ reason: error?.code === 'P0001' ? reason : 'ATTEMPTS_EXHAUSTED' }), attempts, now, row.target, row.effect_key);
        out.failed++;
      } else {
        db.prepare("UPDATE deliveries SET attempts=?,next_attempt_at=?,result=?,updated_at=? WHERE target=? AND effect_key=? AND state='PENDING'")
          .run(attempts, now + backoff(attempts), canonical({ uncertain: /^[A-Z0-9_]{1,80}$/.test(reason) ? reason : 'NETWORK_OR_SERVER' }), now, row.target, row.effect_key);
        out.retry++;
      }
    }
  }
  // The daily window advances only when first-time submits were actually sent in it.
  if (submitDue && firstSubmits > 0) setMeta(db, 'last_submit_pass', now);
  return out;
}
export const setMeta = (db, key, value) => db.prepare('INSERT INTO delivery_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
export const getMeta = (db, key) => db.prepare('SELECT value FROM delivery_meta WHERE key=?').get(key)?.value ?? null;

// First-time SUBMITs once a day (since the last such window); retries follow their own backoff; WITHDRAWs every pass.
export function submitDue(db, now) {
  const last = db.prepare("SELECT value FROM delivery_meta WHERE key='last_submit_pass'").get()?.value ?? 0;
  return now - last >= day;
}

export function deliveryStatus(db, now) {
  const counts = Object.fromEntries(db.prepare('SELECT operation||\'_\'||state k,count(*) n FROM deliveries GROUP BY 1').all().map(row => [row.k, row.n]));
  const oldestWithdraw = db.prepare("SELECT min(created_at) t FROM deliveries WHERE operation='WITHDRAW' AND state='PENDING'").get()?.t ?? null;
  return { counts, oldestPendingWithdrawMs: oldestWithdraw === null ? null : now - oldestWithdraw,
    withdrawWarning: oldestWithdraw !== null && now - oldestWithdraw >= 6 * 3600_000, lastSuccess: getMeta(db, 'last_success'),
    lastSubmitWindow: getMeta(db, 'last_submit_pass'), connectFailures: getMeta(db, 'connect_failures') ?? 0, connectRetryAt: getMeta(db, 'connect_retry_at') };
}
