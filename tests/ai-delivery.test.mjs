// Publish stage 2A (S5): the processor's cloud delivery queue. Exact stored requests, revocation stopping submits,
// withdrawal retried without an attempt limit, backoff, retention and the back-fill of an existing database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { deliver, deliveryStatus, enqueueSubmit, enqueueWithdraw, ensureDeliveries, submitDue, SUBMIT_MAX_ATTEMPTS, KEEP_RECORDS } from '../workers/ai-processing/runtime/delivery.mjs';
import { toIntakePayload } from '../workers/ai-processing/runtime/publish-map.mjs';
import { base, ID } from './fixtures/ai-snapshot.mjs';

const day = 86_400_000, T0 = Date.UTC(2026, 10, 28, 0);
function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-delivery-'));
  const store = new BacklogStore(path.join(dir, 'p.sqlite'));
  return { db: store.db, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const rows = db => db.prepare('SELECT * FROM deliveries ORDER BY created_at,effect_key').all();
const fail = (message, code = 'P0001') => Object.assign(new Error(message), { code });
const recorder = (outcomes = {}) => {
  const calls = [];
  return { calls, submit: async (key, payload) => { calls.push(['SUBMIT', key, payload]); const o = outcomes[key]?.shift?.(); if (o instanceof Error) throw o; return o ?? { state: 'RECEIVED' }; },
    withdraw: async (key, ai, version, reason) => { calls.push(['WITHDRAW', key, ai, version, reason]); const o = outcomes[key]?.shift?.(); if (o instanceof Error) throw o; return o ?? { state: 'WITHDRAWN' }; } };
};

test('a submit stores the exact request and is resent unchanged under the same key', async () => {
  const { db, close } = freshDb();
  try {
    const snapshot = base();
    assert.equal(enqueueSubmit(db, snapshot, T0), true);
    const [row] = rows(db);
    const mapped = toIntakePayload(snapshot);
    assert.equal(row.effect_key, mapped.effectKey);
    assert.deepEqual(JSON.parse(row.request).payload, JSON.parse(JSON.stringify(mapped.payload)));
    const client = recorder({ [mapped.effectKey]: [fail('connection reset', 'ECONNRESET')] });
    const first = await deliver(db, client, T0, { submitDue: true });
    assert.equal(first.retry, 1);
    // Not due again before its backoff; then resent with the identical stored body.
    assert.equal((await deliver(db, client, T0 + 30_000, { submitDue: true })).sent, 0);
    await deliver(db, client, T0 + 61_000, { submitDue: true });
    assert.equal(client.calls.length, 2);
    assert.deepEqual(client.calls[0], client.calls[1]);
    const done = rows(db)[0];
    assert.equal(done.state, 'DONE');
    assert.equal(done.request, null, 'terminal rows keep no content');
    assert.equal(JSON.parse(done.result).state, 'RECEIVED');
  } finally { close(); }
});

test('revocation stops every unfinished submit (also one already sent), wipes it and sends the withdrawal first', async () => {
  const { db, close } = freshDb();
  try {
    const v1 = base(), key = `ai:${ID}:2`;
    enqueueSubmit(db, v1, T0);
    const client = recorder({ [key]: [fail('timeout', 'ETIMEDOUT')] });
    await deliver(db, client, T0, { submitDue: true });
    enqueueWithdraw(db, ID, 2, T0 + 1000);
    const [submit, withdraw] = rows(db);
    assert.equal(submit.state, 'SUPERSEDED');
    assert.equal(submit.request, null);
    assert.equal(withdraw.operation, 'WITHDRAW');
    const pass = await deliver(db, client, T0 + 2000, { submitDue: false });
    assert.equal(pass.done, 1);
    assert.deepEqual(client.calls.at(-1), ['WITHDRAW', `ai-withdraw:${ID}:2`, ID, 2, 'SOURCE_REVOKED']);
  } finally { close(); }
});

test('a withdrawal is never given up by attempt count; a submit is, after its limit', async () => {
  const { db, close } = freshDb();
  try {
    enqueueSubmit(db, base(), T0);
    enqueueWithdraw(db, '99999999-2222-4333-8444-555555555555', 1, T0);
    const down = { submit: async () => { throw fail('down', 'ECONNREFUSED'); }, withdraw: async () => { throw fail('down', 'ECONNREFUSED'); } };
    let now = T0;
    for (let n = 0; n < SUBMIT_MAX_ATTEMPTS + 5; n++) { await deliver(db, down, now, { submitDue: true }); now += 7 * 3600_000; }
    const byOp = Object.fromEntries(rows(db).map(row => [row.operation, row]));
    assert.equal(byOp.SUBMIT.state, 'FAILED');
    assert.equal(JSON.parse(byOp.SUBMIT.result).reason, 'ATTEMPTS_EXHAUSTED');
    assert.equal(byOp.WITHDRAW.state, 'PENDING');
    assert.ok(byOp.WITHDRAW.attempts > SUBMIT_MAX_ATTEMPTS);
    assert.ok(byOp.WITHDRAW.request !== null, 'the withdrawal keeps its identifiers until confirmed');
    assert.equal(deliveryStatus(db, now).withdrawWarning, true);
    // Backoff is capped at six hours.
    assert.ok(byOp.WITHDRAW.next_attempt_at - byOp.WITHDRAW.updated_at <= 6 * 3600_000);
  } finally { close(); }
});

test('definite refusals end at once; uncertain errors retry', async () => {
  const { db, close } = freshDb();
  try {
    enqueueSubmit(db, base(), T0);
    const key = `ai:${ID}:2`;
    await deliver(db, recorder({ [key]: [fail('AI_DRAFT_CONFLICT')] }), T0, { submitDue: true });
    const [row] = rows(db);
    assert.equal(row.state, 'FAILED');
    assert.equal(JSON.parse(row.result).reason, 'AI_DRAFT_CONFLICT');
    enqueueWithdraw(db, ID, 2, T0 + 1);
    await deliver(db, recorder({ [`ai-withdraw:${ID}:2`]: [fail('canceling statement due to statement timeout', '57014')] }), T0 + 2, {});
    assert.equal(rows(db).find(r => r.operation === 'WITHDRAW').state, 'PENDING');
  } finally { close(); }
});

test('submits are due once a day; withdrawals every pass', async () => {
  const { db, close } = freshDb();
  try {
    assert.equal(submitDue(db, T0), true);
    // An empty pass does not use up the window.
    await deliver(db, recorder(), T0, { submitDue: true });
    assert.equal(submitDue(db, T0 + 1), true);
    enqueueSubmit(db, base({ top: { version: 7 } }), T0 + 1);
    await deliver(db, recorder(), T0 + 2, { submitDue: true });
    assert.equal(submitDue(db, T0 + day - 1), false);
    assert.equal(submitDue(db, T0 + 2 + day), true);
    enqueueSubmit(db, base(), T0 + 10);
    enqueueWithdraw(db, '99999999-2222-4333-8444-555555555555', 3, T0 + 10);
    const pass = await deliver(db, recorder(), T0 + 20, { submitDue: false });
    assert.equal(pass.sent, 1, 'only the withdrawal');
  } finally { close(); }
});

test('retention: expired submits end without content, old content-free rows are deleted, older unsent versions are superseded', async () => {
  const { db, close } = freshDb();
  try {
    const v2 = base(), v3 = base({ top: { version: 3 } });
    enqueueSubmit(db, v2, T0);
    enqueueSubmit(db, v3, T0 + 1);
    assert.deepEqual(rows(db).map(r => r.state), ['SUPERSEDED', 'PENDING']);
    await deliver(db, { submit: async () => { throw fail('x', 'ECONNRESET'); } }, T0 + 31 * day, { submitDue: true });
    const v3row = rows(db).find(r => r.ai_version === 3);
    assert.equal(v3row.state, 'FAILED');
    assert.equal(JSON.parse(v3row.result).reason, 'EXPIRED');
    assert.equal(v3row.request, null);
    await deliver(db, recorder(), T0 + 31 * day + KEEP_RECORDS + 1, {});
    assert.equal(rows(db).length, 0);
  } finally { close(); }
});

test('a held snapshot is recorded without content and never sent', async () => {
  const { db, close } = freshDb();
  try {
    const held = base({ top: { facts: [] } });
    enqueueSubmit(db, held, T0);
    const [row] = rows(db);
    assert.equal(row.state, 'FAILED');
    assert.equal(row.request, null);
    assert.ok(JSON.parse(row.result).hold);
    assert.equal((await deliver(db, recorder(), T0, { submitDue: true })).sent, 0);
  } finally { close(); }
});

test('an existing processor database is back-filled once: ready snapshots submit, revoked ones withdraw', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-delivery-up-'));
  try {
    const file = path.join(dir, 'old.sqlite');
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE draft_exports(issue_id TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(issue_id,version)) STRICT`);
    const now = Date.now();
    db.prepare("INSERT INTO draft_exports VALUES (?,?,'READY',?,?,?)").run(ID, 2, JSON.stringify(base()), now, now + 10 * day);
    db.prepare("INSERT INTO draft_exports VALUES (?,?,'REVOKED','{}',?,?)").run('99999999-2222-4333-8444-555555555555', 4, now, now + 10 * day);
    db.prepare("INSERT INTO draft_exports VALUES (?,?,'READY',?,?,?)").run('88888888-2222-4333-8444-555555555555', 1, JSON.stringify(base()), now - 40 * day, now - 10 * day);
    assert.equal(ensureDeliveries(db, now).backfilled, 2);
    assert.deepEqual(rows(db).map(r => r.operation + ':' + r.state).sort(), ['SUBMIT:PENDING', 'WITHDRAW:PENDING']);
    assert.equal(ensureDeliveries(db, now).backfilled, 0, 'only once');
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the delivery cycle runs only with the push setting on, connects only when something is due, and reads the secret strictly', async () => {
  const { deliveryCycle, loadPushConfig, loadIntakeSecret } = await import('../workers/ai-processing/runtime/intake-client.mjs');
  const { writeFileSync } = await import('node:fs');
  const { db, close } = freshDb();
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-push-'));
  try {
    const file = path.join(dir, 'push.json');
    assert.deepEqual(loadPushConfig(file), { enabled: false, target: null }, 'missing file is off');
    writeFileSync(file, '{"enabled":true,"target":"cloud","extra":1}');
    assert.equal(loadPushConfig(file).enabled, false, 'unknown keys are off');
    writeFileSync(file, '{"enabled":true,"target":"cloud"}');
    assert.equal(loadPushConfig(file).enabled, true);
    let connects = 0;
    const connect = async () => { connects++; return { ...recorder(), close: async () => {} }; };
    const loadSecret = () => ({});
    assert.equal((await deliveryCycle({ db, now: T0, loadPush: () => ({ enabled: false }), loadSecret, connect })).state, 'OFF');
    assert.equal((await deliveryCycle({ db, now: T0, loadPush: () => ({ enabled: true }), loadSecret, connect })).state, 'IDLE');
    assert.equal(connects, 0, 'no connection without work');
    enqueueWithdraw(db, ID, 2, T0);
    const pass = await deliveryCycle({ db, now: T0 + 1, loadPush: () => ({ enabled: true }), loadSecret, connect });
    assert.equal(pass.state, 'DELIVERED');
    assert.equal(pass.done, 1);
    assert.equal(connects, 1);
    const failing = await deliveryCycle({ db, now: T0 + 2, loadPush: () => ({ enabled: true }), loadSecret: () => { throw new Error('INTAKE_SECRET_MISSING'); }, connect,
      ...{} });
    assert.equal(failing.state, 'IDLE', 'nothing due after delivery');
    enqueueWithdraw(db, '99999999-2222-4333-8444-555555555555', 1, T0 + 3);
    const noSecret = await deliveryCycle({ db, now: T0 + 4, loadPush: () => ({ enabled: true }), loadSecret: () => { throw new Error('INTAKE_SECRET_MISSING'); }, connect });
    assert.deepEqual(noSecret, { state: 'CONNECT_FAILED', reason: 'INTAKE_SECRET_MISSING', failures: 1 });
    // A broken connection backs off instead of retrying every cycle; a success resets it.
    assert.equal((await deliveryCycle({ db, now: T0 + 30_000, loadPush: () => ({ enabled: true }), loadSecret, connect })).state, 'CONNECT_BACKOFF');
    assert.equal((await deliveryCycle({ db, now: T0 + 70_000, loadPush: () => ({ enabled: true }), loadSecret, connect })).state, 'DELIVERED');
    assert.equal(deliveryStatus(db, T0 + 70_000).connectFailures, 0);
    // Secret file: strict shape, SQL-safe password, owner-only permissions on POSIX.
    const secret = path.join(dir, 'db.json');
    const good = { host: 'aws-0-ap-northeast-2.pooler.supabase.com', port: 5432, database: 'postgres', user: 'judoju_ai_intake.nxfpfvsdwbziowkxsxnh', password: 'A'.repeat(40) };
    writeFileSync(secret, JSON.stringify(good), { mode: 0o600 });
    assert.deepEqual(loadIntakeSecret(secret), good);
    for (const bad of [{ ...good, password: "x'; drop" }, { ...good, user: 'postgres' }, { ...good, extra: 1 }, { ...good, host: 'evil host' }]) {
      writeFileSync(secret, JSON.stringify(bad), { mode: 0o600 });
      assert.throws(() => loadIntakeSecret(secret), /INTAKE_SECRET_INVALID/);
    }
    writeFileSync(secret, JSON.stringify(good), { mode: 0o644 });
    assert.throws(() => loadIntakeSecret(secret, { platform: 'linux' }), process.platform === 'win32' ? /INTAKE_SECRET_PERMISSIONS|INTAKE_SECRET_INVALID|/ : /INTAKE_SECRET_PERMISSIONS/);
    assert.throws(() => loadIntakeSecret(path.join(dir, 'none.json')), /INTAKE_SECRET_MISSING/);
  } finally { close(); rmSync(dir, { recursive: true, force: true }); }
});

test('review fixes: retries are not held by the daily window, housekeeping runs while off, the back-fill is atomic', async () => {
  const { deliveryCycle } = await import('../workers/ai-processing/runtime/intake-client.mjs');
  const { db, close } = freshDb();
  try {
    enqueueSubmit(db, base(), T0);
    const key = `ai:${ID}:2`;
    await deliver(db, recorder({ [key]: [fail('reset', 'ECONNRESET')] }), T0, { submitDue: true });
    // Inside the daily window, the retry still goes once its backoff has passed.
    assert.equal(submitDue(db, T0 + 61_000), false);
    const retry = await deliver(db, recorder(), T0 + 61_000, { submitDue: false });
    assert.equal(retry.done, 1);
    assert.ok(deliveryStatus(db, T0 + 61_000).lastSuccess >= T0);
    // Delivery off: an expired submit still loses its content.
    enqueueSubmit(db, base({ top: { version: 5 } }), T0 + 100);
    const off = await deliveryCycle({ db, now: T0 + 31 * day, loadPush: () => ({ enabled: false }) });
    assert.equal(off.state, 'OFF');
    const v5 = rows(db).find(row => row.ai_version === 5);
    assert.equal(v5.state, 'FAILED');
    assert.equal(v5.request, null);
  } finally { close(); }
  // A failed back-fill leaves no marker and no tables, so the next open runs it again.
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-delivery-atomic-'));
  try {
    const db = new DatabaseSync(path.join(dir, 'a.sqlite'));
    db.exec(`CREATE TABLE draft_exports(issue_id TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(issue_id,version)) STRICT`);
    const now = Date.now();
    db.prepare("INSERT INTO draft_exports VALUES (?,?,'READY','not json',?,?)").run(ID, 2, now, now + day);
    assert.throws(() => ensureDeliveries(db, now));
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('deliveries','delivery_meta')").get().n, 0);
    db.prepare("UPDATE draft_exports SET payload=?").run(JSON.stringify(base()));
    assert.equal(ensureDeliveries(db, now).backfilled, 1);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only recognised committed results finish a delivery', async () => {
  const { db, close } = freshDb();
  try {
    enqueueSubmit(db, base(), T0);
    const key = `ai:${ID}:2`;
    await deliver(db, { submit: async () => null }, T0, { submitDue: true });
    let [row] = rows(db);
    assert.equal(row.state, 'PENDING');
    assert.ok(row.request !== null);
    assert.equal(JSON.parse(row.result).uncertain, 'RESULT_UNRECOGNIZED');
    await deliver(db, recorder({ [key]: [{ state: 'SOMETHING' }] }), T0 + 61_000, {});
    assert.equal(rows(db)[0].state, 'PENDING');
    await deliver(db, recorder({ [key]: [{ state: 'HOLD_EDITOR' }] }), T0 + 200_000, {});
    assert.equal(rows(db)[0].state, 'DONE');
  } finally { close(); }
});

test('a historical withdrawal never supersedes a newer version (upgrade order)', () => {
  const { db, close } = freshDb();
  try {
    enqueueSubmit(db, base({ top: { version: 3 } }), T0);
    enqueueWithdraw(db, ID, 2, T0 + 1);
    assert.deepEqual(rows(db).map(r => r.operation + ':' + r.ai_version + ':' + r.state).sort(), ['SUBMIT:3:PENDING', 'WITHDRAW:2:PENDING']);
    enqueueWithdraw(db, ID, 3, T0 + 2);
    assert.equal(rows(db).find(r => r.operation === 'SUBMIT').state, 'SUPERSEDED');
  } finally { close(); }
});
