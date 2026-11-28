import assert from 'node:assert/strict';
import { canonical, digest, validateConfig, sourceGrant, day } from './contracts.mjs';
import { validateTriage, mergeFacts, evidenceSufficient, validateDraft, validateVerification } from './editorial.mjs';
import { writingBrief } from './writer.mjs';
import { DRAFT_DAYS } from './store.mjs';
import { routeLink } from './routing.mjs';

const hold = reason => ({ state: 'HOLD', reason });
export function createBacklogProcessor({ store, readOriginal, resolveLink, model, loadConfig, now = Date.now }) {
  async function executeModel(job, stage, input, config, authorize, retentionUntil = job.expires_at, documentIds = [job.payload.docId]) {
    if (!config.callModels) return hold('MODEL_EXECUTION_DISABLED');
    if (!authorize()) return hold('AUTHORITY_CHANGED');
    const modelId = config.models[stage];
    if (!modelId.trim() || modelId.length >= 120 || canonical(input).length > 150000) return hold('MODEL_INPUT_LIMIT');
    // An operator re-queue (publish 1A) asks for a fresh writing and verification: its own run identity, so an earlier,
    // already purged run with the same input is not taken as its answer.
    const requeue = stage !== 'triage' && job.payload.exportRequeueAt ? { requeue: job.payload.exportRequeueAt } : {};
    const key = digest({ stage, model: modelId, input, config: digest(config), prompt: 'BACKLOG_PROMPTS_V13', ...requeue });
    const scope = job.payload.docId + ':' + stage;
    const reserved = store.beginRun(key, scope, stage, modelId, config.maxDailyCalls, now(), retentionUntil, documentIds);
    if (reserved.state === 'CACHED') return { state: 'RESULT', value: reserved.value };
    if (reserved.state !== 'DISPATCH_ONCE') return reserved;
    try {
      const value = await model({ stage, model: modelId, input });
      if (!authorize()) { store.finishRun(key, 'REJECTED'); return hold('AUTHORITY_CHANGED'); }
      store.finishRun(key, 'COMPLETE', value);
      return { state: 'RESULT', value };
    } catch (error) {
      // 429 (rate limit or no credit) means the request was not processed: release the reservation so the same
      // input is retried later instead of being blocked for good. Other outcomes keep the no-redispatch rule.
      if (error.httpStatus === 429) { store.releaseRun(key); return hold('MODEL_RATE_LIMITED'); }
      store.finishRun(key, error.knownRejection ? 'REJECTED' : 'UNKNOWN');
      // The HTTP status (never the response body) tells a schema error (400) from limits (429) or a refusal.
      return hold(error.knownRejection ? (error.httpStatus ? 'MODEL_REJECTED_HTTP_' + error.httpStatus : error.message === 'MODEL_REFUSED' ? 'MODEL_REFUSED' : 'MODEL_REJECTED') : 'MODEL_RESPONSE_UNKNOWN');
    }
  }
  return {
    async step() {
      store.maintain(null, now());
      let config; try { config = validateConfig(loadConfig()); } catch { return hold('CONFIG_INVALID'); }
      store.maintain(config, now());
      // Merely importing modules or inspecting status never starts networking.
      if (!config.readOriginals && !config.callModels) return { state: 'PAUSED' };
      const job = store.claim(now()); if (!job) return { state: 'IDLE' };
      const expectedConfig = digest(config);
      const authority = (docIds = []) => {
        try {
          return store.owns(job, now()) && digest(validateConfig(loadConfig())) === expectedConfig &&
            store.documents(docIds, config, now()).length === new Set(docIds).size;
        } catch { return false; }
      };
      const settle = (state, payload = job.payload, reason = null, nextAt = now()) => store.settle(job, state, payload, now(), reason, nextAt);
      const modelHold = result => ['MODEL_EXECUTION_DISABLED', 'MODEL_DAILY_BUDGET'].includes(result.reason)
        ? settle(job.state, job.payload, result.reason, now() + 60000)
        : result.reason === 'MODEL_RATE_LIMITED' ? settle(job.state, job.payload, result.reason, now() + 15 * 60000)
          : settle('HOLD_MODEL', job.payload, result.reason);
      try {
        if (job.state === 'FETCH') {
          if (!config.readOriginals) return settle('FETCH', job.payload, 'ORIGINAL_EXECUTION_DISABLED', now() + 60000);
          // Decision B: short links are resolved first; news stays a signal and is never read.
          const route = config.newsAsSignalOnly ? routeLink(job.payload.fetchUrl, config) : null;
          if (route === 'REDIRECT') {
            if (!resolveLink) return settle('HOLD_ORIGINAL', job.payload, 'LINK_RESOLVER_UNAVAILABLE');
            const link = await resolveLink({ url: job.payload.fetchUrl, hops: job.payload.redirects ?? 0, enabled: config.readOriginals,
              authorize: () => authority(), reserveHost: (...args) => store.reserveHost(...args) });
            if (link.state === 'DEFER') return settle('FETCH', { ...job.payload, fetchUrl: link.url, redirects: link.hops }, 'LINK_DEFERRED', link.nextAt);
            if (link.state === 'RESOLVED') return settle('FETCH', { ...job.payload, fetchUrl: link.url, redirects: link.hops,
              shortLink: job.payload.shortLink ?? job.payload.fetchUrl }, 'LINK_RESOLVED', now());
            return settle('HOLD_ORIGINAL', job.payload, link.reason);
          }
          if (route === 'IRRELEVANT') return settle('EXCLUDED', job.payload, 'IRRELEVANT_LINK');
          if (route === 'EXCLUDED') return settle('EXCLUDED', job.payload, 'EXCLUDED_SOURCE');
          if (route === 'SIGNAL') return store.recordSignal(job, job.payload.fetchUrl, now());
          const original = await readOriginal({ url: job.payload.fetchUrl, redirects: job.payload.redirects,
            loadConfig: () => validateConfig(loadConfig()), expectedConfig, authorize: () => authority(),
            reserveHost: (...args) => store.reserveHost(...args) });
          if (original.state === 'DEFER') return settle('FETCH', { ...job.payload, fetchUrl: original.url, redirects: original.redirects }, 'ORIGINAL_DEFERRED', original.nextAt);
          if (original.state !== 'ORIGINAL') return settle('HOLD_ORIGINAL', job.payload, original.reason);
          assert(authority(), 'AUTHORITY_CHANGED');
          const grant = sourceGrant(config, original.url, now()); assert(grant, 'AUTHORITY_CHANGED');
          return store.saveOriginal(job, original, grant, expectedConfig, now());
        }
        const documents = store.documents([job.payload.docId], config, now());
        assert(documents.length === 1, 'ORIGINAL_EXPIRED_OR_REVOKED');
        const document = documents[0];
        if (job.state === 'TRIAGE') {
          const published = Date.parse(document.publishedAt);
          if (!Number.isFinite(published) || published > now() + 300000) return settle('HOLD_DATE', job.payload, 'PUBLICATION_TIME_UNVERIFIED');
          const known = store.knownTriage(document.id, expectedConfig);
          if (known) return settle('DRAFT', { ...job.payload, storyKey: known.storyKey, triage: known.value, configHash: expectedConfig });
          const result = await executeModel(job, 'triage', { document: { id: document.id, title: document.title, text: document.text, publishedAt: document.publishedAt }, catalog: config.catalog }, config, () => authority([document.id]), document.expiresAt);
          if (result.state !== 'RESULT') return modelHold(result);
          const triage = validateTriage(result.value, documents, config.catalog);
          if (triage.state === 'EXCLUDED') {
            // Excluded originals (ads, price recaps, unrelated) are not kept for later.
            const result = settle('EXCLUDED', job.payload, triage.reason); store.releaseOriginals([document.id]); return result;
          }
          if (triage.state !== 'RELEVANT') return settle('HOLD_TRIAGE', job.payload, triage.reason);
          store.saveTriage(job, triage, expectedConfig, now());
          return settle('DRAFT', { ...job.payload, storyKey: triage.storyKey, triage: triage.value, configHash: expectedConfig });
        }
        if (job.payload.configHash !== expectedConfig) return settle('HOLD_CONFIG_CHANGED', job.payload, 'RECHECK_ORIGINAL_AND_TRIAGE');
        const context = store.context(job.payload.storyKey, expectedConfig, config, now(), document.id);
        if (context.overflow) return settle('HOLD_CONTEXT_LIMIT', job.payload, 'EVENT_CONTEXT_REQUIRES_COMPACTION');
        const docIds = context.documents.map(doc => doc.id);
        assert(docIds.includes(document.id) && authority(docIds), 'ORIGINAL_EXPIRED_OR_REVOKED');
        const facts = mergeFacts(context.triages);
        if (facts.length > 80) return settle('HOLD_CONTEXT_LIMIT', job.payload, 'FACT_CONTEXT_REQUIRES_COMPACTION');
        if (!facts.length || facts.some(fact => !evidenceSufficient(fact, context.documents))) return settle('HOLD_EVIDENCE', job.payload, 'CORROBORATION_INCOMPLETE');
        const keys = new Map();
        for (const fact of facts) {
          const key = digest([fact.subjectId, fact.predicate, fact.unit, fact.period]);
          assert(!keys.has(key) || keys.get(key) === fact.value, 'SOURCE_FACT_CONFLICT'); keys.set(key, fact.value);
        }
        const published = Date.parse(document.publishedAt);
        if (!Number.isFinite(published) || published > now() + 300000) return settle('HOLD_DATE', job.payload, 'PUBLICATION_TIME_UNVERIFIED');
        const eventDate = Date.parse(job.payload.triage.event.date ?? '');
        if (published < now() - 3 * day && (!Number.isFinite(eventDate) || eventDate < now() - 3 * day)) return settle('HOLD_OLD_EVENT', job.payload, 'OLD_EVENT_NOT_NEW_CATALYST');
        const snapshot = context.issues.map(issue => ({ id: issue.id, version: issue.version }));
        // A deleted body's past deadline must not make a new model run expire on arrival.
        const retentionUntil = Math.min(job.expires_at, ...context.documents.map(doc => doc.purged ? doc.expiresAt : Math.min(doc.expiresAt, doc.bodyExpiresAt)));
        const input = { facts, triage: job.payload.triage, catalog: config.catalog,
          // A deleted original arrives as purged: the verifier checks those facts against their stored quotes.
          originals: context.documents.map(doc => ({ id: doc.id, title: doc.title, text: doc.text, publishedAt: doc.publishedAt, ...(doc.purged ? { purged: true } : {}) })),
          // An operator re-queue re-issues its own issue: that issue is the one being rewritten, not another existing
          // story, so the writer and the verifier do not see it as a duplicate (the commit still checks its version).
          existingIssues: context.issues.filter(issue => !(job.payload.exportRequeue && issue.id === job.payload.issueId)).map(issue => ({ id: issue.id, version: issue.version, title: issue.payload.title,
            angleKey: issue.angle_key, factIds: JSON.parse(issue.fact_ids) })) };
        if (job.state === 'DRAFT') {
          const angle = digest(job.payload.triage.impacts.map(item => [item.sectorId, item.direction, item.conditionalDirection, item.category]).sort());
          const duplicate = context.issues.find(issue => issue.angle_key === angle &&
            facts.every(fact => JSON.parse(issue.fact_ids).includes(fact.id)));
          // An operator re-queue for export goes on to writing and verification so its snapshot carries a fresh check.
          if (duplicate && !job.payload.exportRequeue) return store.recordDuplicate(job, duplicate, context.documents, now());
          const prior = context.issues.find(issue => issue.angle_key === angle);
          if (prior && JSON.parse(prior.fact_ids).some(id => !facts.some(fact => fact.id === id))) {
            return settle('HOLD_INCOMPLETE_UPDATE', job.payload, 'PRIOR_FACTS_REQUIRE_REBASE');
          }
          // The writer gets verified facts only: no original titles, bodies or evidence quotes.
          const brief = writingBrief({ facts, triage: job.payload.triage, documents: context.documents, catalog: config.catalog,
            existingIssues: input.existingIssues });
          const result = await executeModel(job, 'draft', brief, config, () => authority(docIds), retentionUntil, docIds);
          if (result.state !== 'RESULT') return modelHold(result);
          const draft = validateDraft(result.value, { facts, documents: context.documents, triage: job.payload.triage, catalog: config.catalog, now: now() });
          return settle('VERIFY', { ...job.payload, draft, contextDigest: digest(input), expectedIssues: snapshot });
        }
        assert(job.state === 'VERIFY' && job.payload.contextDigest === digest(input), 'CONTEXT_CHANGED');
        const result = await executeModel(job, 'verify', { ...input, draft: job.payload.draft }, config, () => authority(docIds), retentionUntil, docIds);
        if (result.state !== 'RESULT') return modelHold(result);
        validateVerification(result.value, facts, input.existingIssues.length > 0);
        assert(authority(docIds), 'AUTHORITY_CHANGED');
        return store.commitDraft(job, job.payload.draft, facts, job.payload.expectedIssues, now(), now() + DRAFT_DAYS * day,
          { registry: config.catalog.version, sha256: digest(config.catalog) });
      } catch (error) {
        const reason = /^[A-Z][A-Z_]{2,80}$/.test(error.message ?? '') ? error.message : 'PROCESSING_VALIDATION_FAILED';
        if (!store.owns(job, now())) return hold('LEASE_STALE');
        return settle('HOLD_VALIDATION', job.payload, reason);
      }
    },
  };
}
