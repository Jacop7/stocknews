// Discovery leads: a news-discovery API only tells us that an article URL exists.
// Its title/summary/body is never evidence. Each lead becomes an ordinary FETCH job,
// so the exact original host still needs its own source grant before anything is read.
import assert from 'node:assert/strict';
import { day, urlKey } from './contracts.mjs';

export const LEADS_VERSION = 'DISCOVERY_LEADS_V1';
export const leadTtl = 2 * day;
const maxItems = 1000, maxAge = 3 * day, clockSkew = 300_000;

const providerName = value => {
  assert(typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value), 'INVALID_DISCOVERY_PROVIDER');
  return value;
};

// TickerTick /feed: { stories: [{ id, title, url, site, time(ms), description?, ... }] }.
// The README also describes a bare array, so both shapes are accepted.
function tickertickItems(raw) {
  const stories = Array.isArray(raw) ? raw : raw?.stories;
  assert(Array.isArray(stories), 'INVALID_DISCOVERY_RESPONSE');
  return stories.map(story => ({ url: story?.url, title: story?.title,
    publishedAt: Number.isSafeInteger(story?.time) ? story.time : NaN }));
}

// Our own provider-neutral format, for any API whose response was converted after its
// documented fields were confirmed: { version, provider, items: [{ url, title, publishedAt }] }.
function leadItems(raw) {
  assert(raw && typeof raw === 'object' && raw.version === LEADS_VERSION, 'INVALID_DISCOVERY_RESPONSE');
  assert(Array.isArray(raw.items), 'INVALID_DISCOVERY_RESPONSE');
  return raw.items.map(item => ({ url: item?.url, title: item?.title,
    publishedAt: typeof item?.publishedAt === 'string' ? Date.parse(item.publishedAt) : NaN }));
}

export function readDiscoveryLeads(raw, format, now) {
  assert(Number.isSafeInteger(now), 'INVALID_CLOCK');
  let provider, items;
  if (format === 'tickertick') { provider = 'tickertick'; items = tickertickItems(raw); }
  else if (format === 'leads') { provider = providerName(raw?.provider); items = leadItems(raw); }
  else assert.fail('INVALID_DISCOVERY_FORMAT');
  assert(items.length <= maxItems, 'DISCOVERY_INPUT_LIMIT');
  const entries = [], reasons = {}, seen = new Set();
  const reject = reason => { reasons[reason] = (reasons[reason] ?? 0) + 1; };
  for (const item of items) {
    let url;
    try { url = urlKey(item.url); } catch { reject('UNSAFE_URL'); continue; }
    if (!Number.isFinite(item.publishedAt)) { reject('PUBLISHED_AT_REQUIRED'); continue; }
    if (item.publishedAt > now + clockSkew) { reject('PUBLISHED_IN_FUTURE'); continue; }
    if (item.publishedAt < now - maxAge) { reject('STALE_LEAD'); continue; }
    if (seen.has(url)) { reject('DUPLICATE_IN_RESPONSE'); continue; }
    seen.add(url);
    // Only the locator and a short headline survive. Provider summaries/bodies are dropped here.
    entries.push({ sourceId: 'discovery:' + provider, url,
      title: typeof item.title === 'string' ? item.title.trim().slice(0, 300) : '',
      lastSeen: now, expiresAt: now + leadTtl });
  }
  return { provider, entries, rejected: Object.values(reasons).reduce((a, b) => a + b, 0), reasons };
}
