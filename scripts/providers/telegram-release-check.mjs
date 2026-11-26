import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function assertTelegramPreflight(filename, markerFile, oldImage) {
  if (!existsSync(filename)) return;
  assert(existsSync(markerFile), 'Unknown existing Telegram store');
  const marker = JSON.parse(readFileSync(markerFile, 'utf8'));
  assert.equal(marker.status, 'ROLLED_BACK_EMPTY');
  assert.equal(marker.oldImage, oldImage);
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(db.prepare('SELECT count(*) n FROM telegram_page_links').get().n, 0);
  } finally { db.close(); }
}

export function savedTelegramCount(filename) {
  if (!existsSync(filename)) return 0;
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return db.prepare('SELECT count(DISTINCT url) n FROM telegram_page_links').get().n; }
  finally { db.close(); }
}

export function telegramActivationEvidence(filename, timestamp, eligibleChannels = 47) {
  if (!existsSync(filename)) return { status: 'PENDING_FIRST_SWEEP', uniqueLinks: 0, attemptedChannels: 0, eligibleChannels, nextHostAt: null };
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const uniqueLinks = db.prepare('SELECT count(DISTINCT url) n FROM telegram_page_links WHERE expires_at>?').get(timestamp).n;
    const attemptedChannels = db.prepare("SELECT count(*) n FROM telegram_page_diagnostics WHERE status!='ROBOTS_READY'").get().n;
    const nextHostAt = db.prepare('SELECT next_at FROM telegram_page_host WHERE id=1').get()?.next_at ?? null;
    const status = uniqueLinks > 0 ? 'READY' : nextHostAt > timestamp + 5000 ? 'PENDING_HOST_WAIT' :
      attemptedChannels < eligibleChannels ? 'PENDING_FIRST_SWEEP' : 'PENDING_ELIGIBLE_LINK';
    return { status, uniqueLinks, attemptedChannels, eligibleChannels, nextHostAt };
  } finally { db.close(); }
}

export function assertTelegramStarted(filename) {
  assert(existsSync(filename), 'Telegram database did not start');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert(db.prepare('SELECT count(*) n FROM telegram_page_diagnostics').get().n > 0, 'No Telegram cycle completed');
  } finally { db.close(); }
}

export function assertCurrentTelegramCycle(logs, startedAt) {
  assert(Number.isFinite(startedAt), 'Container start time required');
  const live = logs.split('\n').some(line => {
    const split = line.indexOf(' ');
    if (split < 0 || !(Date.parse(line.slice(0, split)) >= startedAt)) return false;
    try {
      const event = JSON.parse(line.slice(split + 1));
      return event.event === 'TELEGRAM_PAGE_LINK_CYCLE' &&
        ['WAIT', 'ROBOTS_READY', 'LINKS_OBSERVED', 'PARTIAL', 'BASELINE_RECORDED', 'NO_NEW_POSTS'].includes(event.status);
    } catch { return false; }
  });
  assert(live, 'No current-container Telegram cycle');
}

export function assertWebPreserved(db, snapshot, timestamp) {
  const baseline = new DatabaseSync(snapshot, { readOnly: true });
  try {
    assert.equal(baseline.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    const eligible = baseline.prepare('SELECT endpoint_id,url,binding FROM candidates WHERE expires_at>?').all(timestamp);
    const get = db.prepare('SELECT binding FROM candidates WHERE endpoint_id=? AND url=?');
    for (const row of eligible) assert.equal(get.get(row.endpoint_id, row.url)?.binding, row.binding, 'Unexpired baseline web row missing');
    return eligible.length;
  } finally { baseline.close(); }
}
