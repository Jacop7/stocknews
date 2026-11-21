import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openTelegramPageStore } from '../scripts/providers/telegram-link-worker.mjs';
import { assertTelegramPreflight, assertWebPreserved, savedTelegramCount, telegramActivationEvidence, assertTelegramStarted, assertCurrentTelegramCycle } from '../scripts/providers/telegram-release-check.mjs';

test('empty and PARTIAL stored evidence, marked rollback retry and unknown installation are distinguished', t => {
  const dir = mkdtempSync(join(tmpdir(), 'judoju-tg-release-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'links.sqlite'), marker = join(dir, 'rollback.json');
  assert.equal(savedTelegramCount(file), 0);
  assert.throws(() => assertTelegramStarted(file), /did not start/);
  assert.doesNotThrow(() => assertTelegramPreflight(file, marker, 'old'));
  const db = openTelegramPageStore(file);
  try {
    assert.throws(() => assertTelegramStarted(file), /No Telegram cycle/);
    assert.throws(() => assertTelegramPreflight(file, marker, 'old'), /Unknown existing/);
    writeFileSync(marker, JSON.stringify({ status: 'ROLLED_BACK_EMPTY', oldImage: 'old' }));
    assert.doesNotThrow(() => assertTelegramPreflight(file, marker, 'old'));
    assert.throws(() => assertTelegramPreflight(file, marker, 'other'));
    db.prepare('INSERT INTO telegram_page_links VALUES (?,?,?,?,?)').run('a', 'b', 'https://publisher.co.kr/one', 1, 10);
    assert.equal(savedTelegramCount(file), 1); // No dependency on LINKS_OBSERVED vs PARTIAL log spelling.
    assert.throws(() => assertTelegramPreflight(file, marker, 'old'));
    db.exec('DELETE FROM telegram_page_links');
    assert.doesNotThrow(() => assertTelegramPreflight(file, marker, 'old'));
  } finally { db.close(); }
});

test('old diagnostics and an old process log cannot attest a replacement; its own WAIT event can', () => {
  const started = Date.parse('2026-11-21T01:00:00Z');
  const event = status => JSON.stringify({ event: 'TELEGRAM_PAGE_LINK_CYCLE', status, links: 0 });
  assert.throws(() => assertCurrentTelegramCycle('', started), /current-container/);
  assert.throws(() => assertCurrentTelegramCycle('2026-11-21T00:59:59Z ' + event('LINKS_OBSERVED'), started), /current-container/);
  assert.throws(() => assertCurrentTelegramCycle('2026-11-21T01:00:01Z ' + event('FAILED'), started), /current-container/);
  assert.doesNotThrow(() => assertCurrentTelegramCycle('2026-11-21T01:00:01.123456789Z ' + event('WAIT'), started));
});

test('first sweep and persisted host waits remain pending; only a positive live URL proves success', t => {
  const dir = mkdtempSync(join(tmpdir(), 'judoju-tg-sweep-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'links.sqlite'), db = openTelegramPageStore(file);
  try {
    const record = db.prepare('INSERT INTO telegram_page_diagnostics VALUES (?,?,?,?,?,?,?)');
    for (let index = 0; index < 46; index++) record.run('e' + index, 'b', 1, 'LINKS_OBSERVED', 200, null, 0);
    assert.doesNotThrow(() => assertTelegramStarted(file));
    assert.equal(telegramActivationEvidence(file, 180_000).status, 'PENDING_FIRST_SWEEP');
    db.prepare('INSERT INTO telegram_page_host VALUES (1,?)').run(3_600_000);
    assert.equal(telegramActivationEvidence(file, 180_000).status, 'PENDING_HOST_WAIT');
    db.exec('DELETE FROM telegram_page_host');
    record.run('e46', 'b', 230_000, 'LINKS_OBSERVED', 200, null, 0);
    assert.equal(telegramActivationEvidence(file, 230_000).status, 'PENDING_ELIGIBLE_LINK');
    db.prepare('INSERT INTO telegram_page_links VALUES (?,?,?,?,?)').run('e46', 'b', 'https://publisher.co.kr/one', 230_000, 250_000);
    assert.equal(telegramActivationEvidence(file, 230_000).status, 'READY');
    assert.equal(telegramActivationEvidence(file, 250_000).status, 'PENDING_ELIGIBLE_LINK');
  } finally { db.close(); }
});

test('web preservation permits normal TTL expiry but rejects loss of unexpired baseline rows', t => {
  const dir = mkdtempSync(join(tmpdir(), 'judoju-web-preserve-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'baseline.sqlite'), baseline = new DatabaseSync(file), current = new DatabaseSync(':memory:');
  const schema = 'CREATE TABLE candidates(endpoint_id TEXT,url TEXT,binding TEXT,expires_at INTEGER)';
  baseline.exec(schema); current.exec(schema);
  try {
    baseline.prepare('INSERT INTO candidates VALUES (?,?,?,?)').run('expired', 'u1', 'b1', 100);
    baseline.prepare('INSERT INTO candidates VALUES (?,?,?,?)').run('live', 'u2', 'b2', 200);
    current.prepare('INSERT INTO candidates VALUES (?,?,?,?)').run('live', 'u2', 'b2', 200);
    assert.equal(assertWebPreserved(current, file, 101), 1);
    current.exec('DELETE FROM candidates');
    assert.throws(() => assertWebPreserved(current, file, 101), /Unexpired baseline/);
    assert.equal(assertWebPreserved(current, file, 201), 0);
  } finally { baseline.close(); current.close(); }
});
