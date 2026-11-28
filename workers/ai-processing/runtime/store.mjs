import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { digest, canonical, day, urlKey, sourceGrant } from './contracts.mjs';
import { ensureDeliveries, enqueueSubmit, enqueueWithdraw } from './delivery.mjs';

const decode = row => row ? { ...row, payload: JSON.parse(row.payload) } : null;
// Retention (2026-11-26 user decision): an original's title/body is deleted as soon as its analysis is written
// (or it is excluded), and in any case at its source/link deadline (max 7 days). Extracted facts with short
// quotes and the source record stay 30 days for corrections and same-story updates. Unpublished drafts stay
// 30 days and no longer disappear with their originals. Revocation still removes everything immediately.
export const EVIDENCE_DAYS = 30, DRAFT_DAYS = 30;
const activeStates = "('FETCH','TRIAGE','DRAFT','VERIFY')";
export class BacklogStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename, { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,state TEXT NOT NULL,
        next_at INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS sightings(job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(job_id,source_id)) STRICT;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,published_at TEXT,
        expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS document_sources(doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        url TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS triages(doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        config_hash TEXT NOT NULL,story_key TEXT NOT NULL,partition_key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(doc_id,config_hash)) STRICT;
      CREATE TABLE IF NOT EXISTS runs(key TEXT PRIMARY KEY,scope TEXT NOT NULL,stage TEXT NOT NULL,model TEXT NOT NULL,
        state TEXT NOT NULL,response TEXT,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY,story_key TEXT NOT NULL,angle_key TEXT NOT NULL,version INTEGER NOT NULL,
        manual_protected INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL,fact_ids TEXT NOT NULL,created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,UNIQUE(story_key,angle_key)) STRICT;
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,payload TEXT NOT NULL,reason TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS host_slots(host TEXT PRIMARY KEY,next_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS robots_rules(origin TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS run_documents(run_key TEXT NOT NULL,doc_id TEXT NOT NULL,PRIMARY KEY(run_key,doc_id)) STRICT;
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,job_id TEXT,state TEXT NOT NULL,reason TEXT,observed_at INTEGER NOT NULL) STRICT;
    `);
    // News is never read (decision B): only where and when a story link was seen, for discovery and ranking.
    this.db.exec(`CREATE TABLE IF NOT EXISTS news_signals(url TEXT PRIMARY KEY,host TEXT NOT NULL,first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,sources TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT`);
    // GNews signals keep their headline (2026-11-28); every insert names its columns.
    if (!this.db.prepare('PRAGMA table_info(news_signals)').all().some(column => column.name === 'title')) this.db.exec('ALTER TABLE news_signals ADD COLUMN title TEXT');
    // Publish stage 1A: an export snapshot per DRAFT_READY issue version, written in the same transaction. It holds the
    // draft and its independently verified facts (statements and source links only, never quotes or bodies). A source
    // revocation marks it REVOKED and wipes its content; it expires with the 30-day draft clock.
    this.db.exec(`CREATE TABLE IF NOT EXISTS draft_exports(issue_id TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('READY','REVOKED')),
      payload TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(issue_id,version)) STRICT`);
    if (!this.db.prepare('PRAGMA table_info(documents)').all().some(column => column.name === 'body_expires_at')) {
      this.db.exec('ALTER TABLE documents ADD COLUMN body_expires_at INTEGER');
    }
    // Publish stage 2A: the cloud delivery queue (created and back-filled from existing snapshots on first open).
    ensureDeliveries(this.db);
  }
  close() { this.db.close(); }
  transaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  importLinks(entries, now) {
    assert(Array.isArray(entries) && entries.length <= 20000, 'IMPORT_LIMIT');
    let added = 0, rejected = 0;
    this.transaction(() => {
      for (const entry of entries) {
        let url; try { url = urlKey(entry.url); } catch { rejected++; continue; }
        if (typeof entry.sourceId !== 'string' || !entry.sourceId.trim() || !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= now || !Number.isSafeInteger(entry.lastSeen) || entry.lastSeen > now + 300000) { rejected++; continue; }
        const expires = Math.min(entry.expiresAt, now + 7 * day), id = digest(url);
        const payload = canonical({ fetchUrl: url, redirects: 0, title: typeof entry.title === 'string' ? entry.title.slice(0, 500) : '' });
        added += Number(this.db.prepare("INSERT OR IGNORE INTO jobs(id,url,state,next_at,payload,expires_at) VALUES (?,?,'FETCH',?,?,?)").run(id, url, now, payload, expires).changes);
        this.db.prepare('UPDATE jobs SET expires_at=max(expires_at,?) WHERE id=?').run(expires, id);
        this.db.prepare('INSERT INTO sightings VALUES (?,?,?,?) ON CONFLICT(job_id,source_id) DO UPDATE SET last_seen=max(last_seen,excluded.last_seen),expires_at=max(expires_at,excluded.expires_at)')
          .run(id, String(entry.sourceId).slice(0, 150), entry.lastSeen, expires);
      }
    });
    return { added, rejected, jobs: this.db.prepare('SELECT count(*) n FROM jobs').get().n };
  }
  claim(now) {
    return this.transaction(() => {
      // Later stages first: an original already read should reach analysis before the backlog of new links.
      const row = this.db.prepare(`SELECT * FROM jobs WHERE state IN ('FETCH','TRIAGE','DRAFT','VERIFY') AND next_at<=? AND expires_at>? AND lease_until<=?
        ORDER BY CASE state WHEN 'VERIFY' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'TRIAGE' THEN 2 ELSE 3 END, next_at, id LIMIT 1`).get(now, now, now);
      if (!row) return null;
      const lease = randomUUID();
      this.db.prepare('UPDATE jobs SET lease=?,lease_until=? WHERE id=?').run(lease, now + 120000, row.id);
      return { ...decode(row), lease, lease_until: now + 120000 };
    });
  }
  owns(job, now) {
    const row = this.db.prepare('SELECT lease,lease_until,expires_at FROM jobs WHERE id=?').get(job.id);
    return row?.lease === job.lease && row.lease_until > now && row.expires_at > now;
  }
  settle(job, state, payload, now, reason = null, nextAt = now) {
    return this.transaction(() => {
      assert(this.owns(job, now), 'LEASE_STALE');
      this.db.prepare('UPDATE jobs SET state=?,payload=?,next_at=?,lease=NULL,lease_until=0 WHERE id=? AND lease=?')
        .run(state, canonical(payload), nextAt, job.id, job.lease);
      this.db.prepare('INSERT INTO events(job_id,state,reason,observed_at) VALUES (?,?,?,?)').run(job.id, state, reason, now);
      return { jobId: job.id, state, reason };
    });
  }
  reserveHost(host, now, delay, extend = false) {
    return this.transaction(() => {
      const until = this.db.prepare('SELECT next_at FROM host_slots WHERE host=?').get(host)?.next_at ?? 0;
      if (!extend && until > now) return { allowed: false, nextAt: until };
      const nextAt = Math.max(until, now + delay);
      this.db.prepare('INSERT INTO host_slots VALUES (?,?) ON CONFLICT(host) DO UPDATE SET next_at=max(next_at,excluded.next_at)').run(host, nextAt);
      return { allowed: true, nextAt };
    });
  }
  loadRobots(origin, now) {
    const row = this.db.prepare('SELECT payload FROM robots_rules WHERE origin=? AND expires_at>?').get(origin, now);
    return row ? JSON.parse(row.payload) : null;
  }
  saveRobots(origin, value) {
    this.db.prepare('INSERT INTO robots_rules VALUES (?,?,?) ON CONFLICT(origin) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at')
      .run(origin, canonical(value), value.until);
  }
  saveOriginal(job, original, grant, configHash, now) {
    return this.transaction(() => {
      assert(this.owns(job, now), 'LEASE_STALE');
      const expires = Math.min(job.expires_at, now + grant.retentionDays * day, grant.expiresAt === null ? Infinity : Date.parse(grant.expiresAt));
      const record = Math.min(now + EVIDENCE_DAYS * day, grant.expiresAt === null ? Infinity : Date.parse(grant.expiresAt));
      // A re-fetched copy of an already deleted body restores it; it is deleted again on completion.
      this.db.prepare(`INSERT INTO documents(id,title,body,published_at,expires_at,body_expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        expires_at=max(expires_at,excluded.expires_at),body_expires_at=max(coalesce(body_expires_at,0),excluded.body_expires_at),
        title=CASE WHEN body='' THEN excluded.title ELSE title END,body=CASE WHEN body='' THEN excluded.body ELSE body END`)
        .run(original.bodyHash, original.title, original.text, original.publishedAt, record, expires);
      const source = { ...grant, url: original.url, publishedAt: original.publishedAt };
      this.db.prepare('INSERT INTO document_sources VALUES (?,?,?,?) ON CONFLICT(url) DO UPDATE SET doc_id=excluded.doc_id,payload=excluded.payload,expires_at=excluded.expires_at')
        .run(original.bodyHash, original.url, canonical(source), record);
      const payload = { ...job.payload, docId: original.bodyHash, configHash };
      this.db.prepare("UPDATE jobs SET state='TRIAGE',payload=?,expires_at=?,lease=NULL,lease_until=0,next_at=? WHERE id=? AND lease=?")
        .run(canonical(payload), expires, now, job.id, job.lease);
      return { jobId: job.id, state: 'TRIAGE', docId: original.bodyHash };
    });
  }
  documents(ids, config, now) {
    return [...new Set(ids)].map(id => {
      const doc = this.db.prepare('SELECT * FROM documents WHERE id=? AND expires_at>?').get(id, now);
      if (!doc) return null;
      const sources = this.db.prepare('SELECT payload,url,expires_at FROM document_sources WHERE doc_id=? AND expires_at>?').all(id, now)
        .filter(source => sourceGrant(config, source.url, now)).map(source => {
          // After the body is deleted, the attested body hash still binds the origin record to this exact text.
          const origin = config.documentOrigins?.find(item => item.url === source.url && item.bodyHash === id && item.verified && (doc.body === '' || doc.body.includes(item.quote)));
          return { ...sourceGrant(config, source.url, now),
          articleOriginVerified: Boolean(origin), originGroupId: origin?.originGroupId ?? null,
          url: source.url, publishedAt: JSON.parse(source.payload).publishedAt,
          expiresAt: Math.min(source.expires_at, sourceGrant(config, source.url, now).expiresAt === null ? Infinity : Date.parse(sourceGrant(config, source.url, now).expiresAt)) };
        });
      const dates = sources.map(source => source.publishedAt).filter(value => Number.isFinite(Date.parse(value))).sort();
      return sources.length ? { id, title: doc.title, text: doc.body, purged: doc.body === '', publishedAt: dates[0] ?? null,
        bodyExpiresAt: doc.body_expires_at ?? doc.expires_at,
        expiresAt: Math.min(doc.expires_at, ...sources.map(source => source.expiresAt)), sources } : null;
    }).filter(Boolean);
  }
  // News-API discoveries (GNews, 2026-11-28) go straight to news signals: no job, no fetch path, no body, whatever
  // the destination host or the configuration. Title and publication time are kept; repeats refresh last_seen,
  // sources and expiry. Returns counts only.
  recordNewsSignals(entries, now) {
    assert(Array.isArray(entries) && entries.length <= 1000, 'SIGNAL_LIMIT');
    let added = 0, updated = 0, rejected = 0;
    this.transaction(() => {
      for (const entry of entries) {
        let url; try { url = urlKey(entry.url); } catch { rejected++; continue; }
        if (typeof entry.sourceId !== 'string' || !/^gnews:[a-z0-9-]{1,60}$/.test(entry.sourceId) || !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= now
          || !Number.isSafeInteger(entry.lastSeen) || entry.lastSeen > now + 300000) { rejected++; continue; }
        const expires = Math.min(entry.expiresAt, now + 7 * day), host = new URL(url).hostname.toLowerCase();
        const prior = this.db.prepare('SELECT sources FROM news_signals WHERE url=?').get(url);
        const sources = JSON.stringify([...new Set([...(prior ? JSON.parse(prior.sources) : []), entry.sourceId])].sort());
        this.db.prepare(`INSERT INTO news_signals(url,host,first_seen,last_seen,sources,expires_at,title) VALUES (?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET
          first_seen=min(first_seen,excluded.first_seen),last_seen=max(last_seen,excluded.last_seen),sources=excluded.sources,
          expires_at=max(expires_at,excluded.expires_at),title=coalesce(excluded.title,title)`)
          .run(url, host, entry.lastSeen, now, sources, expires, typeof entry.title === 'string' && entry.title ? entry.title.slice(0, 300) : null);
        prior ? updated++ : added++;
      }
    });
    return { added, updated, rejected };
  }
  // Records a news link as a signal (no fetch, no body) and closes the job. Several short links to the same
  // story merge into one row; the channels that carried it are kept for counting distinct sources.
  recordSignal(job, url, now) {
    return this.transaction(() => {
      assert(this.owns(job, now), 'LEASE_STALE');
      const host = new URL(url).hostname.toLowerCase();
      const sources = this.db.prepare('SELECT source_id FROM sightings WHERE job_id=?').all(job.id).map(row => row.source_id);
      const prior = this.db.prepare('SELECT sources FROM news_signals WHERE url=?').get(url);
      const merged = [...new Set([...(prior ? JSON.parse(prior.sources) : []), ...sources])].sort();
      this.db.prepare(`INSERT INTO news_signals(url,host,first_seen,last_seen,sources,expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET
        last_seen=max(last_seen,excluded.last_seen),sources=excluded.sources,expires_at=max(expires_at,excluded.expires_at)`)
        .run(url, host, now, now, JSON.stringify(merged), job.expires_at);
      this.db.prepare("UPDATE jobs SET state='SIGNAL',payload=?,lease=NULL,lease_until=0 WHERE id=? AND lease=?")
        .run(canonical({ signalUrl: url, publicationAuthorized: false }), job.id, job.lease);
      this.db.prepare("INSERT INTO events(job_id,state,reason,observed_at) VALUES (?,'SIGNAL','NEWS_SIGNAL_ONLY',?)").run(job.id, now);
      return { jobId: job.id, state: 'SIGNAL', host };
    });
  }
  // The stored extraction for this exact body and configuration: reused without a model call, even after
  // the original body and the model response were deleted.
  knownTriage(docId, configHash) {
    const row = this.db.prepare('SELECT story_key,payload FROM triages WHERE doc_id=? AND config_hash=?').get(docId, configHash);
    return row ? { storyKey: row.story_key, value: JSON.parse(row.payload) } : null;
  }
  purgeBody(id) {
    this.db.prepare("UPDATE documents SET title='',body='' WHERE id=?").run(id);
    this.db.prepare('UPDATE runs SET response=NULL WHERE key IN (SELECT run_key FROM run_documents WHERE doc_id=?) OR scope LIKE ?').run(id, id + ':%');
  }
  // Deletes original bodies once nothing still needs them: no fetch/triage job for that document and no
  // draft/verify job in flight for the same story (verification compares against the originals).
  releaseOriginals(ids) {
    const run = () => {
      let released = 0;
      for (const id of new Set(ids)) {
        const stories = new Set(this.db.prepare('SELECT story_key FROM triages WHERE doc_id=?').all(id).map(row => row.story_key));
        const busy = this.db.prepare('SELECT payload FROM jobs WHERE state IN ' + activeStates).all().some(row => {
          const payload = JSON.parse(row.payload);
          return payload.docId === id || stories.has(payload.storyKey);
        });
        if (busy) continue;
        released += Number(this.db.prepare("SELECT 1 FROM documents WHERE id=? AND body<>''").get(id) !== undefined);
        this.purgeBody(id);
      }
      return released;
    };
    return this.db.isTransaction ? run() : this.transaction(run);
  }
  saveTriage(job, triage, configHash, now) {
    this.transaction(() => {
      assert(this.owns(job, now), 'LEASE_STALE');
      this.db.prepare('INSERT INTO triages VALUES (?,?,?,?,?) ON CONFLICT(doc_id,config_hash) DO UPDATE SET payload=excluded.payload')
        .run(job.payload.docId, configHash, triage.storyKey, triage.partition, canonical(triage.value));
      // Evidence holds wake only when another document for the same event actually arrives.
      for (const held of this.db.prepare("SELECT * FROM jobs WHERE state='HOLD_EVIDENCE' AND expires_at>?").all(now)) {
        const payload = JSON.parse(held.payload);
        if (payload.storyKey === triage.storyKey && payload.docId !== job.payload.docId) this.db.prepare("UPDATE jobs SET state='DRAFT',next_at=? WHERE id=?").run(now, held.id);
      }
    });
  }
  context(storyKey, configHash, config, now, requiredDocId) {
    const rows = this.db.prepare('SELECT doc_id,payload FROM triages WHERE story_key=? AND config_hash=? ORDER BY doc_id').all(storyKey, configHash);
    rows.sort((a, b) => Number(b.doc_id === requiredDocId) - Number(a.doc_id === requiredDocId));
    const documents = this.documents(rows.slice(0, 8).map(row => row.doc_id), config, now);
    const kept = new Set(documents.map(doc => doc.id));
    const triages = rows.filter(row => kept.has(row.doc_id)).map(row => JSON.parse(row.payload));
    const issues = this.db.prepare('SELECT * FROM issues WHERE story_key=? AND expires_at>? ORDER BY id').all(storyKey, now).map(decode);
    return { documents, triages, issues, overflow: rows.length > 8 };
  }
  beginRun(key, scope, stage, model, maxDailyCalls, now, expiresAt, docIds = [scope.split(':')[0]]) {
    return this.transaction(() => {
      const known = this.db.prepare('SELECT * FROM runs WHERE key=?').get(key);
      if (known) return known.state === 'COMPLETE' && known.response !== null && known.expires_at > now ? { state: 'CACHED', value: JSON.parse(known.response) } : { state: 'HOLD', reason: known.state === 'INTENT' || known.state === 'UNKNOWN' ? 'MODEL_RESPONSE_UNKNOWN' : 'MODEL_' + known.state };
      if (this.db.prepare("SELECT 1 FROM runs WHERE scope=? AND state IN ('INTENT','UNKNOWN')").get(scope)) return { state: 'HOLD', reason: 'MODEL_RESPONSE_UNKNOWN' };
      const midnight = Math.floor((now + 9 * 3600000) / day) * day - 9 * 3600000;
      if (this.db.prepare('SELECT count(*) n FROM runs WHERE created_at>=?').get(midnight).n >= maxDailyCalls) return { state: 'HOLD', reason: 'MODEL_DAILY_BUDGET' };
      this.db.prepare("INSERT INTO runs VALUES (?,?,?,?,'INTENT',NULL,?,?)").run(key, scope, stage, model, now, expiresAt);
      for (const id of new Set(docIds)) this.db.prepare('INSERT INTO run_documents VALUES (?,?)').run(key, id);
      return { state: 'DISPATCH_ONCE' };
    });
  }
  // Undo an INTENT whose request the provider did not process (HTTP 429), so it does not count as dispatched.
  releaseRun(key) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM run_documents WHERE run_key=? AND EXISTS (SELECT 1 FROM runs WHERE key=? AND state='INTENT')").run(key, key);
      this.db.prepare("DELETE FROM runs WHERE key=? AND state='INTENT'").run(key);
    });
  }
  finishRun(key, state, response = null) {
    assert(['COMPLETE', 'UNKNOWN', 'REJECTED'].includes(state));
    this.db.prepare("UPDATE runs SET state=?,response=? WHERE key=? AND state='INTENT'").run(state, response === null ? null : canonical(response), key);
  }
  recordDuplicate(job, issue, documents, now) {
    return this.transaction(() => {
      assert(this.owns(job, now), 'LEASE_STALE');
      const current = this.db.prepare('SELECT * FROM issues WHERE id=?').get(issue.id);
      assert(current?.version === issue.version, 'REVISION_CONFLICT');
      if (!current.manual_protected) {
        const payload = JSON.parse(current.payload), seen = new Set(payload.source_refs.map(source => source.url));
        for (const doc of documents) for (const source of doc.sources) if (!seen.has(source.url) && payload.source_refs.length < 32) {
          payload.source_refs.push({ docId: doc.id, url: source.url, name: source.name ?? source.id,
            role: source.kind === 'OFFICIAL' ? 'PRIMARY' : 'REPORTED', publishedAt: source.publishedAt }); seen.add(source.url);
        }
        this.db.prepare('UPDATE issues SET payload=? WHERE id=?').run(canonical(payload), current.id);
      }
      this.db.prepare("UPDATE jobs SET state='DUPLICATE',payload=?,lease=NULL,lease_until=0 WHERE id=?")
        .run(canonical({ docId: job.payload.docId, issueId: issue.id }), job.id);
      this.releaseOriginals(documents.map(doc => doc.id));
      return { state: 'DUPLICATE', issueId: issue.id, jobId: job.id };
    });
  }
  // Snapshot of one ready issue version for the publish inbox (stage 1A). Facts reach the writer only after independent
  // verification; commitDraft runs only after that verification approved every fact and the Korea path.
  exportSnapshot(issueId, version, storyKey, draft, facts, catalogRef, now) {
    // Every source link of every document a fact cites, with its role (PRIMARY original or REPORTED coverage); the
    // database still decides officialness from the host. Values, units and periods stay for the editor's evidence view.
    const sourcesOf = docId => (draft.source_refs ?? []).filter(source => source.docId === docId).map(source => ({ docId, url: source.url, role: source.role }));
    const snapshot = { format: 'AI_DRAFT_EXPORT_V1', issueId, version, storyKey, angleKey: draft.angleKey, draft, catalogRef, verifiedAt: now,
      facts: facts.map(fact => {
        const sources = [...new Map(fact.refs.flatMap(ref => sourcesOf(ref.docId)).map(source => [source.url, source])).values()];
        return { id: fact.id, subjectId: fact.subjectId, predicate: fact.predicate, value: fact.value, unit: fact.unit, period: fact.period,
          statement: fact.statement, verificationClass: fact.verificationClass, independentlyVerified: true, koreaPathVerified: true, recordedAt: now,
          sources, sourceUrls: sources.map(source => source.url) };
      }) };
    const inserted = this.db.prepare("INSERT INTO draft_exports(issue_id,version,state,payload,created_at,expires_at) VALUES (?,?,'READY',?,?,?) ON CONFLICT(issue_id,version) DO NOTHING")
      .run(issueId, version, canonical(snapshot), now, now + 30 * day).changes > 0;
    // Stage 2A: the same transaction queues its cloud delivery (stored exactly as it will be sent).
    if (inserted) enqueueSubmit(this.db, JSON.parse(canonical(snapshot)), now, now + 30 * day);
  }
  revokeExports(issueId, now = Date.now()) {
    this.db.prepare("UPDATE draft_exports SET state='REVOKED',payload='{}' WHERE issue_id=?").run(issueId);
    // Stage 2A: unfinished cloud submits stop and lose their content; a withdrawal is queued for the newest version.
    const newest = this.db.prepare('SELECT max(version) v FROM draft_exports WHERE issue_id=?').get(issueId)?.v;
    if (newest) enqueueWithdraw(this.db, issueId, newest, now);
  }
  // Ready snapshots whose job is still DRAFT_READY for exactly that issue version, plus revoked ones (for withdrawal).
  exports(now) {
    // One read transaction, so a version can never appear both ready and revoked.
    return this.transaction(() => {
    const ready = this.db.prepare(`SELECT e.issue_id issueId,e.version,e.payload FROM draft_exports e JOIN issues i ON i.id=e.issue_id AND i.version=e.version
      WHERE e.state='READY' AND e.expires_at>? AND EXISTS(SELECT 1 FROM jobs j WHERE j.state='DRAFT_READY' AND json_extract(j.payload,'$.issueId')=e.issue_id
        AND json_extract(j.payload,'$.version')=e.version) ORDER BY e.created_at,e.issue_id`).all(now).map(row => JSON.parse(row.payload));
    const revoked = this.db.prepare("SELECT issue_id issueId,max(version) version FROM draft_exports WHERE state='REVOKED' AND expires_at>? GROUP BY issue_id ORDER BY issue_id").all(now)
      .map(row => ({ issueId: row.issueId, version: row.version }));
    return { ready, revoked };
    });
  }
  // Operator re-queue of an existing DRAFT_READY job so it is processed again and leaves an export snapshot (stage 1A,
  // for drafts committed before snapshots existed). The issue row stays; the job restarts from FETCH.
  requeueForExport(jobId, now) {
    return this.transaction(() => {
      const job = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
      // A re-queue that ended on hold may be re-queued again (its issue is still the committed version).
      assert(job && (job.state === 'DRAFT_READY' || job.state.startsWith('HOLD_') && JSON.parse(job.payload).exportRequeue === true), 'REQUEUE_REQUIRES_DRAFT_READY');
      assert(job.expires_at > now, 'REQUEUE_JOB_EXPIRED');
      const payload = JSON.parse(job.payload);
      this.db.prepare("UPDATE jobs SET state='FETCH',next_at=?,lease=NULL,lease_until=0,payload=? WHERE id=?")
        .run(now, canonical({ ...payload, exportRequeue: true, exportRequeueAt: now }), jobId);
      this.db.prepare("INSERT INTO events(job_id,state,reason,observed_at) VALUES (?,'FETCH','EXPORT_REQUEUE',?)").run(jobId, now);
      return { jobId, state: 'FETCH', exportRequeue: true };
    });
  }
  commitDraft(job, draft, facts, expectedIssues, now, expiresAt = job.expires_at, catalogRef = null) {
    return this.transaction(() => {
      assert(this.owns(job, now), 'LEASE_STALE');
      const current = this.db.prepare('SELECT * FROM issues WHERE story_key=? AND angle_key=?').get(job.payload.storyKey, draft.angleKey);
      const expected = current && expectedIssues.find(item => item.id === current.id);
      let action, id = current?.id ?? randomUUID(), version = (current?.version ?? 0) + 1;
      if (current && (current.manual_protected || !expected || current.version !== expected.version)) {
        const reason = current.manual_protected ? 'MANUAL_PROTECTED' : 'REVISION_CONFLICT';
        this.db.prepare('INSERT OR IGNORE INTO proposals VALUES (?,?,?,?,?)').run(digest([job.id, draft]), job.id, canonical(draft), reason, expiresAt);
        this.db.prepare("UPDATE jobs SET state='HOLD_EDITOR',lease=NULL,lease_until=0 WHERE id=?").run(job.id);
        return { state: 'HOLD_EDITOR', reason, jobId: job.id };
      }
      const previousIds = current ? JSON.parse(current.fact_ids) : [];
      const newIds = facts.map(item => item.id).sort();
      assert(!current || previousIds.every(id => newIds.includes(id)), 'INCOMPLETE_UPDATE');
      // An operator re-queue (exportRequeue) commits a new version even with the same facts, so the draft gets an export
      // snapshot with its fresh verification. Ordinary duplicates are unchanged.
      if (current && newIds.every(fact => previousIds.includes(fact)) && !job.payload.exportRequeue) {
        this.db.prepare("UPDATE jobs SET state='DUPLICATE',lease=NULL,lease_until=0 WHERE id=?").run(job.id);
        this.releaseOriginals((draft.source_refs ?? []).map(source => source.docId));
        return { state: 'DUPLICATE', issueId: id, jobId: job.id };
      }
      action = current ? 'UPDATE' : expectedIssues.length ? 'NEW_ANGLE' : 'NEW_STORY';
      this.db.prepare('INSERT INTO issues(id,story_key,angle_key,version,payload,fact_ids,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(story_key,angle_key) DO UPDATE SET version=excluded.version,payload=excluded.payload,fact_ids=excluded.fact_ids,updated_at=excluded.updated_at,expires_at=excluded.expires_at')
        .run(id, job.payload.storyKey, draft.angleKey, version, canonical(draft), canonical(newIds), current?.created_at ?? now, now, expiresAt);
      if (catalogRef) this.exportSnapshot(id, version, job.payload.storyKey, draft, facts, catalogRef, now);
      const { exportRequeue, exportRequeueAt, ...rest } = job.payload;
      this.db.prepare("UPDATE jobs SET state='DRAFT_READY',payload=?,lease=NULL,lease_until=0,expires_at=max(expires_at,?) WHERE id=?").run(canonical({ ...rest, issueId: id, version, action }), expiresAt, job.id);
      this.db.prepare('INSERT INTO events(job_id,state,reason,observed_at) VALUES (?,?,?,?)').run(job.id, 'DRAFT_READY', action, now);
      this.releaseOriginals((draft.source_refs ?? []).map(source => source.docId));
      return { state: 'DRAFT_READY', action, issueId: id, version, jobId: job.id, publicationAuthorized: false };
    });
  }
  maintain(config, now) {
    this.transaction(() => {
      // Bodies past their source/link deadline are deleted; the 30-day fact record remains.
      for (const row of this.db.prepare("SELECT id FROM documents WHERE body<>'' AND coalesce(body_expires_at,expires_at)<=?").all(now)) this.purgeBody(row.id);
      const expired = new Set(this.db.prepare('SELECT doc_id FROM document_sources WHERE expires_at<=?').all(now).map(row => row.doc_id));
      const removed = new Set();
      for (const table of ['jobs', 'sightings', 'document_sources', 'proposals', 'robots_rules', 'news_signals']) this.db.prepare('DELETE FROM ' + table + ' WHERE expires_at<=?').run(now);
      // INTENT/UNKNOWN tombstones remain text-free: they must still prevent an uncertain redispatch.
      this.db.prepare('UPDATE runs SET response=NULL WHERE expires_at<=?').run(now);
      // Unpublished drafts expire on their own 30-day clock, not with their originals.
      this.db.prepare('DELETE FROM issues WHERE expires_at<=?').run(now);
      this.db.prepare('DELETE FROM draft_exports WHERE expires_at<=?').run(now);
      if (config) {
        for (const source of this.db.prepare('SELECT url,doc_id FROM document_sources').all()) if (!sourceGrant(config, source.url, now)) {
          removed.add(source.doc_id); this.db.prepare('DELETE FROM document_sources WHERE url=?').run(source.url);
        }
        for (const issue of this.db.prepare('SELECT id,payload FROM issues WHERE expires_at>?').all(now)) {
          if ((JSON.parse(issue.payload).source_refs ?? []).some(source => !sourceGrant(config, source.url, now))) {
            this.db.prepare('UPDATE issues SET payload=?,fact_ids=? WHERE id=?').run(canonical({ state: 'HOLD_SOURCE_REVOKED', publicationAuthorized: false }), '[]', issue.id);
            this.revokeExports(issue.id, now);
          }
        }
        // Editor proposals carry their own source_refs and can outlive the 30-day source record.
        for (const proposal of this.db.prepare('SELECT id,payload FROM proposals').all()) {
          const granted = source => { try { return Boolean(sourceGrant(config, source.url, now)); } catch { return false; } };
          // Refs without a URL are tied to documents by docId and handled with the removed-document pass.
          if ((JSON.parse(proposal.payload).source_refs ?? []).some(source => typeof source.url === 'string' && !granted(source))) this.db.prepare('DELETE FROM proposals WHERE id=?').run(proposal.id);
        }
      }
      // A link held only because its host had no grant becomes fetchable once an operator registers that host.
      // Remote refusals (robots, 4xx, paywall) keep their own reasons and are never woken here.
      if (config?.readOriginals) for (const held of this.accessHeld()) if (sourceGrant(config, held.url, now)) {
        this.db.prepare("UPDATE jobs SET state='FETCH',next_at=?,lease=NULL,lease_until=0 WHERE id=? AND state='HOLD_ORIGINAL'").run(now, held.id);
        this.db.prepare("INSERT INTO events(job_id,state,reason,observed_at) VALUES (?,'FETCH','SOURCE_GRANT_AVAILABLE',?)").run(held.id, now);
      }
      for (const row of this.db.prepare('SELECT id FROM documents WHERE expires_at<=?').all(now)) expired.add(row.id);
      // The fact record expiring keeps written drafts; it only stops in-flight work that still needed it.
      for (const id of expired) if (!removed.has(id)) {
        this.db.prepare('UPDATE runs SET response=NULL WHERE key IN (SELECT run_key FROM run_documents WHERE doc_id=?) OR scope LIKE ?').run(id, id + ':%');
        for (const job of this.db.prepare('SELECT id,payload FROM jobs WHERE state IN ' + activeStates).all()) {
          const payload = JSON.parse(job.payload);
          if (payload.docId === id || payload.triage?.facts?.some(fact => fact.refs.some(ref => ref.docId === id))) this.db.prepare("UPDATE jobs SET payload=?,state='HOLD_SOURCE_CHANGED',lease=NULL,lease_until=0 WHERE id=?")
            .run(canonical({ state: 'HOLD_SOURCE_CHANGED', publicationAuthorized: false }), job.id);
        }
        for (const proposal of this.db.prepare('SELECT id,payload FROM proposals').all()) {
          if ((JSON.parse(proposal.payload).source_refs ?? []).some(source => source.docId === id)) this.db.prepare('DELETE FROM proposals WHERE id=?').run(proposal.id);
        }
      }
      // Revocation or an excluded source: drafts and everything derived from that source are withdrawn.
      for (const id of removed) {
        this.db.prepare('UPDATE runs SET response=NULL WHERE key IN (SELECT run_key FROM run_documents WHERE doc_id=?) OR scope LIKE ?').run(id, id + ':%');
        for (const issue of this.db.prepare('SELECT id,payload FROM issues').all()) if ((JSON.parse(issue.payload).source_refs ?? []).some(source => source.docId === id)) {
          this.db.prepare("UPDATE issues SET payload=?,fact_ids='[]' WHERE id=?")
            .run(canonical({ state: 'HOLD_SOURCE_CHANGED', publicationAuthorized: false }), issue.id);
          this.revokeExports(issue.id, now);
        }
        for (const job of this.db.prepare('SELECT id,payload FROM jobs').all()) {
          const payload = JSON.parse(job.payload);
          const referenced = payload.docId === id || payload.draft?.source_refs?.some(source => source.docId === id) ||
            payload.triage?.facts?.some(fact => fact.refs.some(ref => ref.docId === id));
          if (referenced) this.db.prepare("UPDATE jobs SET payload=?,state='HOLD_SOURCE_CHANGED',lease=NULL,lease_until=0 WHERE id=?")
            .run(canonical({ state: 'HOLD_SOURCE_CHANGED', publicationAuthorized: false }), job.id);
        }
        for (const proposal of this.db.prepare('SELECT id,payload FROM proposals').all()) {
          if ((JSON.parse(proposal.payload).source_refs ?? []).some(source => source.docId === id)) {
            this.db.prepare('DELETE FROM proposals WHERE id=?').run(proposal.id);
          }
        }
      }
      for (const doc of this.db.prepare('SELECT id FROM documents WHERE id NOT IN (SELECT doc_id FROM document_sources)').all()) {
        this.db.prepare('UPDATE runs SET response=NULL WHERE scope LIKE ?').run(doc.id + ':%');
        this.db.prepare('DELETE FROM documents WHERE id=?').run(doc.id);
      }
      this.db.prepare('DELETE FROM documents WHERE expires_at<=?').run(now);
      this.db.prepare('DELETE FROM events WHERE observed_at<=?').run(now - 7 * day);
    });
  }
  accessHeld() {
    return this.db.prepare(`SELECT j.id,j.payload,EXISTS(SELECT 1 FROM sightings s WHERE s.job_id=j.id AND s.source_id LIKE 'discovery:%') discovered
      FROM jobs j WHERE j.state='HOLD_ORIGINAL' AND
      (SELECT e.reason FROM events e WHERE e.job_id=j.id ORDER BY e.id DESC LIMIT 1)='ORIGINAL_ACCESS_NOT_ENABLED'`).all()
      .map(row => ({ id: row.id, url: JSON.parse(row.payload).fetchUrl, discovered: row.discovered }));
  }
  status() {
    // Hosts only, no URLs: which publishers would need an internal access review before their links can be read.
    const hosts = new Map();
    for (const held of this.accessHeld()) {
      const host = new URL(held.url).hostname, entry = hosts.get(host) ?? { host, jobs: 0, discovered: 0 };
      entry.jobs++; entry.discovered += Number(held.discovered); hosts.set(host, entry);
    }
    return { jobs: this.db.prepare('SELECT state,count(*) count FROM jobs GROUP BY state').all(),
      accessReviewHosts: [...hosts.values()].sort((a, b) => b.jobs - a.jobs || a.host.localeCompare(b.host, 'en')).slice(0, 50),
      documents: this.db.prepare('SELECT count(*) n FROM documents').get().n,
      drafts: this.db.prepare('SELECT count(*) n FROM issues').get().n,
      newsSignals: { links: this.db.prepare('SELECT count(*) n FROM news_signals').get().n,
        topHosts: this.db.prepare('SELECT host,count(*) links FROM news_signals GROUP BY host ORDER BY links DESC,host LIMIT 20').all().map(row => ({ ...row })) },
      modelRuns: this.db.prepare('SELECT state,count(*) count FROM runs GROUP BY state').all(), publicationAuthorized: false };
  }
}
