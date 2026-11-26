import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeArticleUrl } from '../../../scripts/providers/policy.mjs';

export const VERSION = 'BACKLOG_DRAFT_V1';
export const day = 86_400_000;
export function canonical(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item);
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export function urlKey(value) {
  assert(typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u0020\u007f]/u.test(value), 'UNSAFE_URL');
  const normalized = normalizeArticleUrl(value), url = new URL(normalized), host = url.hostname.toLowerCase();
  assert(host.includes('.') && !isIP(host) && !host.startsWith('[') &&
    !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|t\.me|telegram\.org|telegram\.me)$/.test(host), 'UNSAFE_URL');
  return normalized;
}
export function exact(raw, keys) {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_OBJECT');
  assert.deepEqual(Object.keys(raw).sort(), [...keys].sort(), 'INVALID_FIELDS');
  return raw;
}
export function text(value, max = 4000, blank = false) {
  assert(typeof value === 'string' && value.length <= max && (blank || value.trim()), 'INVALID_TEXT');
  return value;
}
export function list(value, max = 100) { assert(Array.isArray(value) && value.length <= max, 'INVALID_LIST'); return value; }
export const numericTokens = value => [...new Set(value.match(/[+-]?\d+(?:[,.]\d+)*(?:%p|%|조원|억원|달러|원)?/gi) ?? [])];
export function sourceGrant(config, rawUrl, now) {
  const url = new URL(urlKey(rawUrl));
  if (config.excludedDomains.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return null;
  if (config.excludedUrls.includes(url.href)) return null;
  const grant = config.sources.find(item => item.host === url.hostname);
  if (!grant || grant.status !== 'ENABLED' || grant.revokedAt ||
      grant.expiresAt !== null && Date.parse(grant.expiresAt) <= now) return null;
  return grant;
}
export function validateConfig(raw) {
  const value = JSON.parse(JSON.stringify(raw));
  assert(value.version === VERSION && value.mode === 'BACKLOG_ONLY', 'INVALID_RUNTIME_MODE');
  assert(typeof value.readOriginals === 'boolean' && typeof value.callModels === 'boolean', 'INVALID_SWITCH');
  // Decision B: news hosts are signals only (never read). Absent means the earlier behaviour (news read with a grant).
  assert(value.newsAsSignalOnly === undefined || typeof value.newsAsSignalOnly === 'boolean', 'INVALID_SWITCH');
  assert(Number.isSafeInteger(value.maxDailyCalls) && value.maxDailyCalls >= 0 && value.maxDailyCalls <= 10000, 'INVALID_BUDGET');
  list(value.excludedDomains).forEach(host => assert(/^[a-z0-9.-]+$/.test(host) && !host.startsWith('.')));
  list(value.excludedUrls).forEach(urlKey);
  assert(value.catalog && typeof value.catalog.version === 'string', 'CATALOG_REQUIRED');
  const sectors = list(value.catalog.sectors, 200), entities = list(value.catalog.entities, 2000);
  for (const group of [sectors, entities]) {
    assert(new Set(group.map(item => item.id)).size === group.length, 'DUPLICATE_CATALOG_ID');
    group.forEach(item => { text(item.id, 100); text(item.name, 200); });
  }
  assert(value.models && ['triage', 'draft', 'verify'].every(stage => typeof value.models[stage] === 'string'), 'MODEL_CONFIG_REQUIRED');
  if (value.callModels) assert(value.models.draft && value.models.verify && value.models.draft !== value.models.verify, 'SEPARATE_VERIFIER_REQUIRED');
  const sources = list(value.sources, 500);
  value.documentOrigins ??= [];
  for (const origin of list(value.documentOrigins, 20000)) {
    urlKey(origin.url); assert(/^[a-f0-9]{64}$/.test(origin.bodyHash), 'INVALID_ORIGIN_HASH');
    text(origin.originGroupId, 100); text(origin.quote, 500);
    assert(origin.verified === true, 'ORIGIN_ATTESTATION_REQUIRED');
  }
  assert(new Set(sources.map(item => item.host)).size === sources.length, 'DUPLICATE_SOURCE_HOST');
  for (const grant of sources) {
    assert(new URL('https://' + grant.host).host === grant.host && !grant.host.includes('/'), 'INVALID_HOST');
    assert(['ENABLED', 'DISABLED'].includes(grant.status) && ['NEWS', 'OFFICIAL', 'REPORT'].includes(grant.kind), 'INVALID_SOURCE');
    text(grant.id, 100); text(grant.version, 100);
    assert(grant.basis === 'EXPLICIT_INTERNAL_REVIEW' && grant.publicationAuthorized === false, 'SOURCE_BASIS_REQUIRED');
    assert(list(grant.evidence, 10).length > 0 && grant.evidence.every(item => typeof item === 'string' && item.trim()), 'ACCESS_EVIDENCE_REQUIRED');
    assert(Number.isInteger(grant.retentionDays) && grant.retentionDays >= 1 && grant.retentionDays <= 7, 'INVALID_RETENTION');
    assert(grant.expiresAt === null || Number.isFinite(Date.parse(grant.expiresAt)), 'INVALID_EXPIRY');
    assert(grant.revokedAt === null || Number.isFinite(Date.parse(grant.revokedAt)), 'INVALID_REVOCATION');
    assert(typeof grant.provenanceVerified === 'boolean', 'INVALID_PROVENANCE');
    for (const id of ['originGroupId', 'newsroomId', 'ownerGroupId']) assert(grant[id] === null || typeof grant[id] === 'string' && grant[id].trim(), 'INVALID_PROVENANCE');
  }
  return value;
}
