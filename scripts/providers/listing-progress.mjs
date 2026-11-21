import { identityForUrl, normalizeArticleUrl, permissionExpiry } from './policy.mjs';
import { createHash } from 'node:crypto';

const day = 24 * 60 * 60 * 1000;
const anchorLimit = 5;
const stageLimit = 400;
const progressTables = ['listing_checkpoint', 'listing_seen', 'listing_gap', 'listing_pending', 'listing_hold', 'listing_gap_report',
  'listing_detail_queue', 'listing_initial_head'];

export function initializeListingProgress(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listing_initial_head (
      endpoint_id TEXT NOT NULL, binding TEXT NOT NULL, url_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY (endpoint_id,binding,url_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listing_detail_queue (
      endpoint_id TEXT NOT NULL, binding TEXT NOT NULL, url TEXT NOT NULL, listing_hash TEXT NOT NULL,
      published_at TEXT, next_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('PENDING','CONFIRMED','UNAVAILABLE')),
      PRIMARY KEY (endpoint_id, binding, url)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS listing_detail_ready ON listing_detail_queue(endpoint_id,binding,state,next_at);
    CREATE TABLE IF NOT EXISTS listing_checkpoint (
      endpoint_id TEXT PRIMARY KEY, binding TEXT NOT NULL, anchors TEXT NOT NULL,
      baseline_at INTEGER NOT NULL, completed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, date_required INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listing_seen (
      endpoint_id TEXT NOT NULL, binding TEXT NOT NULL, url_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY (endpoint_id, binding, url_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listing_gap (
      endpoint_id TEXT PRIMARY KEY, binding TEXT NOT NULL, started_at INTEGER NOT NULL, misses INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, overflow INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listing_pending (
      endpoint_id TEXT NOT NULL, binding TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
      published_at TEXT, expires_at INTEGER NOT NULL, PRIMARY KEY (endpoint_id, binding, url)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listing_hold (
      endpoint_id TEXT NOT NULL, binding TEXT NOT NULL, url_id TEXT NOT NULL, eligible_after INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, PRIMARY KEY (endpoint_id, binding, url_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listing_gap_report (
      endpoint_id TEXT NOT NULL, binding TEXT NOT NULL, from_at INTEGER NOT NULL, until_at INTEGER NOT NULL,
      checked_items INTEGER NOT NULL, reason TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY (endpoint_id,binding,until_at)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listing_analysis_outbox (
      job_key TEXT PRIMARY KEY, endpoint_id TEXT NOT NULL, binding TEXT NOT NULL,
      url_id TEXT NOT NULL, revision INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
      published_at TEXT, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS listing_analysis_article ON listing_analysis_outbox(url_id, revision);
  `);
}

const cleanTitle = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const titleFingerprint = title => createHash('sha256').update(title).digest('hex');
const deletePendingDetail = `DELETE FROM listing_detail_queue WHERE endpoint_id=? AND binding=? AND url=? AND state='PENDING'`;
const upsertListingHold = `INSERT INTO listing_hold VALUES (?,?,?,?,?)
  ON CONFLICT(endpoint_id,binding,url_id) DO UPDATE SET
    eligible_after=max(eligible_after,excluded.eligible_after),expires_at=min(expires_at,excluded.expires_at)`;

function candidatesFor(source, candidates) {
  const origin = new URL(source.endpoint.url).origin;
  const entries = new Map();
  for (const item of candidates) {
    const url = normalizeArticleUrl(item.url);
    if (new URL(url).origin !== origin || entries.has(url)) continue;
    const title = cleanTitle(item.title);
    if (!title || title.length > 500) continue;
    const publishedAt = typeof item.publishedAt === 'string' && Number.isFinite(Date.parse(item.publishedAt))
      ? new Date(item.publishedAt).toISOString() : null;
    entries.set(url, { url, title, publishedAt });
  }
  return [...entries.values()];
}

function saveItems(db, source, items, time, expires, baselineAt, conservativeAfter, confirmedDetail = false) {
  const id = source.endpoint.endpoint_id;
  const { binding } = source;
  const seen = db.prepare('SELECT 1 FROM listing_seen WHERE endpoint_id=? AND binding=? AND url_id=?');
  const remember = db.prepare(`INSERT INTO listing_seen VALUES (?,?,?,?) ON CONFLICT(endpoint_id,binding,url_id)
    DO UPDATE SET expires_at=max(listing_seen.expires_at,excluded.expires_at)`);
  const prior = db.prepare('SELECT title,first_seen FROM candidates WHERE endpoint_id=? AND binding=? AND url=?');
  const hold = db.prepare('SELECT eligible_after FROM listing_hold WHERE endpoint_id=? AND binding=? AND url_id=?');
  const saveHold = db.prepare(upsertListingHold);
  const clearHold = db.prepare('DELETE FROM listing_hold WHERE endpoint_id=? AND binding=? AND url_id=?');
  const store = db.prepare(`INSERT INTO candidates VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(endpoint_id,url) DO UPDATE SET title=excluded.title,
      published_at=coalesce(excluded.published_at,candidates.published_at)`);
  const article = db.prepare('SELECT job_key,endpoint_id,binding,revision,title FROM listing_analysis_outbox WHERE url_id=? ORDER BY revision DESC LIMIT 1');
  const enqueue = db.prepare('INSERT INTO listing_analysis_outbox VALUES (?,?,?,?,?,?,?,?,?)');
  const cancelDetail = db.prepare(deletePendingDetail);
  const initialHead = db.prepare('SELECT 1 FROM listing_initial_head WHERE endpoint_id=? AND binding=? AND url_id=?');
  const stageDetail = db.prepare(`INSERT INTO listing_detail_queue VALUES (?,?,?,?,?,?,?,'PENDING')
    ON CONFLICT(endpoint_id,binding,url) DO UPDATE SET
      listing_hash=excluded.listing_hash,published_at=coalesce(excluded.published_at,listing_detail_queue.published_at),
      next_at=CASE WHEN state='PENDING' OR listing_hash=excluded.listing_hash THEN next_at ELSE excluded.next_at END,
      state=CASE WHEN listing_hash=excluded.listing_hash THEN state ELSE 'PENDING' END,
      expires_at=CASE WHEN state='PENDING' THEN min(expires_at,excluded.expires_at)
        WHEN listing_hash=excluded.listing_hash THEN expires_at ELSE excluded.expires_at END`);
  let inserted = 0;
  for (const { url, title, listingHash, publishedAt, expiresAt } of items) {
    const urlId = identityForUrl(url);
    const saved = prior.get(id, binding, url);
    const itemExpiry = Math.min(expires, expiresAt ?? expires);
    if (itemExpiry <= time) continue;
    const latest = article.get(urlId);
    const ownTitleEvidence = latest?.endpoint_id === id && latest.binding === binding;
    const admittedInitially = source.operator && initialHead.get(id, binding, urlId);
    if (!saved && !ownTitleEvidence && seen.get(id, binding, urlId)) {
      if (expiresAt === undefined) remember.run(id, binding, urlId, itemExpiry);
      continue;
    }
    const published = publishedAt ? Date.parse(publishedAt) : NaN;
    const priorHold = hold.get(id, binding, urlId)?.eligible_after;
    const requiresEvidence = conservativeAfter !== null || priorHold !== undefined;
    const cutoff = Math.max(baselineAt, priorHold ?? conservativeAfter ?? baselineAt);
    const datedTooEarly = Number.isFinite(published) && published <= baselineAt;
    if (!saved && !ownTitleEvidence && !admittedInitially &&
        (datedTooEarly || (requiresEvidence && !(published > cutoff && published <= time)))) {
      saveHold.run(id, binding, urlId, cutoff, itemExpiry);
      cancelDetail.run(id, binding, url);
      continue;
    }
    clearHold.run(id, binding, urlId);
    if (source.endpoint.confirm_article_title === true && !confirmedDetail) {
      stageDetail.run(id, binding, url, listingHash ?? titleFingerprint(title), publishedAt, time, itemExpiry);
      continue;
    }
    store.run(id, url, title, publishedAt, binding, saved?.first_seen ?? time, itemExpiry);
    remember.run(id, binding, urlId, itemExpiry);
    // An additional source supplies provenance, not a second initial analysis job or title authority.
    if (latest && (latest.endpoint_id !== id || latest.binding !== binding || latest.title === title)) continue;
    if (saved && !latest && cleanTitle(saved.title) === title) continue;
    const revision = latest ? latest.revision + 1 : 0;
    enqueue.run(`${urlId}:${revision}`, id, binding, urlId, revision, url, title, publishedAt, itemExpiry);
    if (revision === 0) inserted++;
  }
  return inserted;
}

export function recordListingDetail(db, source, slot, { title, httpStatus, unavailable }, time) {
  const { binding, endpoint } = source;
  const current = db.prepare(`SELECT published_at, expires_at FROM listing_detail_queue
    WHERE endpoint_id=? AND binding=? AND url=? AND listing_hash=? AND state='PENDING' AND next_at=? AND expires_at>?`)
    .get(endpoint.endpoint_id, binding, slot.url, slot.listing_hash, slot.reservedUntil, time);
  if (!current) return 0;
  const settle = db.prepare('UPDATE listing_detail_queue SET state=? WHERE endpoint_id=? AND binding=? AND url=?');
  if (unavailable || [401, 402, 403, 404, 410, 451].includes(httpStatus)) {
    settle.run('UNAVAILABLE', endpoint.endpoint_id, binding, slot.url);
    return 0;
  }
  if (typeof title !== 'string') return 0;
  const confirmedTitle = cleanTitle(title);
  if (!confirmedTitle || confirmedTitle.length > 500) return 0;
  const items = [{ url: slot.url, title: confirmedTitle, publishedAt: current.published_at }];
  const inserted = saveItems(db, source, items, time, current.expires_at, 0, null, true);
  settle.run('CONFIRMED', endpoint.endpoint_id, binding, slot.url);
  return inserted;
}

function checkpoint(db, id, binding, items, baselineAt, time, expires, dateRequired) {
  db.prepare(`INSERT INTO listing_checkpoint VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(endpoint_id) DO UPDATE SET binding=excluded.binding, anchors=excluded.anchors,
      baseline_at=excluded.baseline_at, completed_at=excluded.completed_at,
      expires_at=excluded.expires_at, date_required=excluded.date_required`)
    .run(id, binding, JSON.stringify(items.slice(0, anchorLimit).map(item => identityForUrl(item.url))),
      baselineAt, time, expires, dateRequired);
}

// Called in the same transaction as the current reservation settlement.
export function recordListingProgress(db, source, result, time) {
  const { endpoint, profile, binding } = source;
  const id = endpoint.endpoint_id;
  const confirmArticleTitle = endpoint.confirm_article_title === true;
  const expires = Math.min(time + profile.retention_days * day, permissionExpiry(profile));
  const items = candidatesFor(source, result.candidates);
  const previous = db.prepare('SELECT * FROM listing_checkpoint WHERE endpoint_id=? AND binding=?').get(id, binding);
  const legacy = previous ? [] : db.prepare(`SELECT url,first_seen FROM candidates WHERE endpoint_id=? AND binding=?
    ORDER BY first_seen DESC,url ASC LIMIT ?`).all(id, binding, anchorLimit);
  const status = value => db.prepare('UPDATE schedules SET status=? WHERE endpoint_id=?').run(value, id);
  if (!items.length) {
    status('CHECKPOINT_GAP');
    return 0;
  }
  const boundedHead = source.operator && result.status === 'PARTIAL' && result.reason === 'CANDIDATE_LIMIT';
  const completePage = result.status === 'CANDIDATES' || boundedHead;
  const newBaseline = !previous && !legacy.length;
  if (newBaseline) {
    if (!completePage) {
      status('CHECKPOINT_GAP');
      return 0;
    }
    if (source.operator) {
      // First activation starts from the visible head page, without paging older archives.
      const admit = db.prepare('INSERT INTO listing_initial_head VALUES (?,?,?,?) ON CONFLICT DO NOTHING');
      for (const item of items) admit.run(id, binding, identityForUrl(item.url), expires);
      saveItems(db, source, items, time, expires, 0, null);
      checkpoint(db, id, binding, items, time, time, expires, 0);
      status('BASELINE_ESTABLISHED');
      return 0;
    }
    const remember = db.prepare('INSERT INTO listing_seen VALUES (?,?,?,?) ON CONFLICT DO NOTHING');
    for (const item of items) remember.run(id, binding, identityForUrl(item.url), expires);
    checkpoint(db, id, binding, items, time, time, expires, 0);
    status('BASELINE_ESTABLISHED');
    return 0;
  }
  const anchors = new Set(previous ? JSON.parse(previous.anchors) : legacy.map(row => identityForUrl(row.url)));
  const matches = items.filter(item => anchors.has(identityForUrl(item.url))).length;
  const lastComplete = previous?.completed_at ?? Math.max(...legacy.map(row => row.first_seen));
  const baselineAt = previous?.baseline_at ?? lastComplete;
  const gap = db.prepare('SELECT * FROM listing_gap WHERE endpoint_id=? AND binding=?').get(id, binding);
  const clearGap = () => {
    db.prepare('DELETE FROM listing_gap WHERE endpoint_id=? AND binding=?').run(id, binding);
    db.prepare('DELETE FROM listing_pending WHERE endpoint_id=? AND binding=?').run(id, binding);
  };
  let recovered = false;
  if (!completePage || matches < Math.min(2, anchors.size)) {
    const startedAt = gap?.started_at ?? time;
    const misses = (gap?.misses ?? 0) + 1;
    if (!completePage || (misses < 3 && time - startedAt < day)) {
      let remaining = stageLimit - db.prepare('SELECT count(*) AS n FROM listing_pending WHERE endpoint_id=? AND binding=?').get(id, binding).n;
      let overflow = gap?.overflow ?? 0;
      const known = db.prepare('SELECT 1 FROM listing_pending WHERE endpoint_id=? AND binding=? AND url=?');
      const stage = db.prepare(`INSERT INTO listing_pending VALUES (?,?,?,?,?,?)
        ON CONFLICT(endpoint_id,binding,url) DO UPDATE SET title=excluded.title,
          published_at=coalesce(excluded.published_at,listing_pending.published_at),
          expires_at=min(listing_pending.expires_at,excluded.expires_at)`);
      const cancelDetail = db.prepare(deletePendingDetail);
      const saveHold = db.prepare(upsertListingHold);
      for (const item of items) {
        // A partial page can still provide firm evidence that a queued item is older than the baseline.
        const initial = source.operator && db.prepare('SELECT 1 FROM listing_initial_head WHERE endpoint_id=? AND binding=? AND url_id=?')
          .get(id, binding, identityForUrl(item.url));
        if (confirmArticleTitle && !initial && Date.parse(item.publishedAt) <= baselineAt &&
            cancelDetail.run(id, binding, item.url).changes > 0) {
          saveHold.run(id, binding, identityForUrl(item.url), baselineAt, expires);
        }
        const exists = known.get(id, binding, item.url);
        if (!exists && remaining <= 0) {
          overflow = 1;
          continue;
        }
        // The legacy staging column holds a fingerprint only in detail-confirmation mode.
        const stagedTitle = confirmArticleTitle ? `sha256:${titleFingerprint(item.title)}` : item.title;
        stage.run(id, binding, item.url, stagedTitle, item.publishedAt, expires);
        if (!exists) remaining--;
      }
      db.prepare(`INSERT INTO listing_gap VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint_id)
        DO UPDATE SET binding=excluded.binding,started_at=excluded.started_at,misses=excluded.misses,
          expires_at=excluded.expires_at,overflow=excluded.overflow`).run(id, binding, startedAt, misses, gap?.expires_at ?? expires, overflow);
      status('CHECKPOINT_GAP');
      return 0;
    }
    recovered = true;
  }
  // The registered head page is scanned in full: the generic adapter cannot identify pinned items.
  const held = db.prepare(`SELECT url,title,published_at AS publishedAt,expires_at AS expiresAt
    FROM listing_pending WHERE endpoint_id=? AND binding=?`).all(id, binding);
  const freshItems = new Map(items.map(item => [item.url, item]));
  for (const row of held) {
    const item = confirmArticleTitle ? {
      url: row.url, publishedAt: row.publishedAt, expiresAt: row.expiresAt,
      listingHash: /^sha256:[a-f0-9]{64}$/.test(row.title) ? row.title.slice(7) : titleFingerprint(row.title),
    } : row;
    const fresh = freshItems.get(item.url);
    if (!fresh) freshItems.set(item.url, item);
    else if (!fresh.publishedAt && item.publishedAt && item.expiresAt > time) {
      freshItems.set(item.url, { ...fresh, publishedAt: item.publishedAt, expiresAt: item.expiresAt });
    }
  }
  const strictAfter = recovered || previous?.date_required === 1 ? lastComplete : null;
  const inserted = saveItems(db, source, [...freshItems.values()], time, expires, baselineAt, strictAfter);
  checkpoint(db, id, binding, items, baselineAt, time, expires, 0);
  clearGap();
  if (recovered || gap?.overflow) {
    db.prepare('INSERT INTO listing_gap_report VALUES (?,?,?,?,?,?,?)')
      .run(id, binding, lastComplete, time, items.length, gap?.overflow ? 'STAGING_LIMIT_REACHED' : 'HEAD_SCOPE_RESUMED', expires);
    status('CHECKPOINT_REBASED_WITH_GAP');
  }
  return inserted;
}

function rebindOrRemoveJobs(db, jobs, bindings, time) {
  const alternate = db.prepare(`SELECT endpoint_id,binding,published_at,expires_at FROM candidates
    WHERE url=? AND title=? AND expires_at>? ORDER BY expires_at DESC,endpoint_id ASC`);
  const rebind = db.prepare('UPDATE listing_analysis_outbox SET endpoint_id=?,binding=?,published_at=?,expires_at=? WHERE job_key=?');
  const remove = db.prepare('DELETE FROM listing_analysis_outbox WHERE job_key=?');
  for (const job of jobs) {
    if (bindings.get(job.endpoint_id) === job.binding && job.expires_at > time) continue;
    const replacement = alternate.all(job.url, job.title, time)
      .find(row => bindings.get(row.endpoint_id) === row.binding);
    if (replacement) rebind.run(replacement.endpoint_id, replacement.binding, replacement.published_at, replacement.expires_at, job.job_key);
    else remove.run(job.job_key);
  }
}

export function removeListingBinding(db, id, binding, bindings, time) {
  for (const table of progressTables) db.prepare(`DELETE FROM ${table} WHERE endpoint_id=? AND binding=?`).run(id, binding);
  const jobs = db.prepare('SELECT * FROM listing_analysis_outbox WHERE endpoint_id=? AND binding=?').all(id, binding);
  rebindOrRemoveJobs(db, jobs, bindings, time);
}

export function pruneListingProgress(db, bindings, time) {
  db.prepare(`UPDATE listing_checkpoint SET date_required=1 WHERE EXISTS (
    SELECT 1 FROM json_each(listing_checkpoint.anchors) AS anchor
    JOIN listing_seen AS seen ON seen.url_id=anchor.value
    WHERE seen.endpoint_id=listing_checkpoint.endpoint_id AND seen.binding=listing_checkpoint.binding AND seen.expires_at<=?)`).run(time);
  db.prepare(`UPDATE listing_checkpoint SET date_required=1 WHERE EXISTS (
    SELECT 1 FROM listing_hold AS held WHERE held.endpoint_id=listing_checkpoint.endpoint_id
      AND held.binding=listing_checkpoint.binding AND held.expires_at<=?)`).run(time);
  for (const table of progressTables) {
    db.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).run(time);
    const remove = db.prepare(`DELETE FROM ${table} WHERE endpoint_id=? AND binding=?`);
    for (const row of db.prepare(`SELECT DISTINCT endpoint_id,binding FROM ${table}`).all()) {
      if (bindings.get(row.endpoint_id) !== row.binding) remove.run(row.endpoint_id, row.binding);
    }
  }
  rebindOrRemoveJobs(db, db.prepare('SELECT * FROM listing_analysis_outbox').all(), bindings, time);
}
