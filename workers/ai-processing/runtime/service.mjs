// Long-running AI processing service for the server container.
// Every 10 minutes it imports saved links from the collector databases (read-only connections), then steps the
// processor one job at a time. Original reads and model calls need BOTH the config flags and JUDOJU_AI_EXECUTE=1;
// otherwise the service only imports and reports status. The API key is read from a file only when calls are on,
// kept in memory, and never logged.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { BacklogStore } from './store.mjs';
import { validateConfig } from './contracts.mjs';
import { createOriginalReader, createOriginalTransport } from './original.mjs';
import { createCompanyFeedDiscovery, startCompanyFeedLoop } from './company-feeds.mjs';
import { createGnewsClient, startGnewsLoop } from './gnews.mjs';
import { createFinlightClient, startFinlightLoop } from './finlight.mjs';
import { createLinkResolver } from './resolver.mjs';
import { createOpenAiModel } from './model.mjs';
import { createBacklogProcessor } from './pipeline.mjs';
import { readSavedLinks } from './cli.mjs';
import { createDartClient, createDartReader, readCorpCodes } from './dart.mjs';
import { buildCompanyIndex, learnStockCodes, matchIssues, matchStatus } from './evidence-match.mjs';
import { sourceStatus } from './news-report.mjs';
import { linkSignals } from './ranking.mjs';
import { deliveryCycle } from './intake-client.mjs';
import { deliveryStatus } from './delivery.mjs';

const env = process.env;
const paths = { db: env.JUDOJU_AI_DB ?? '/ai/processing.sqlite', config: env.JUDOJU_AI_CONFIG ?? '/ai/config.json',
  telegram: env.JUDOJU_TELEGRAM_DB ?? '/collector/telegram-links.sqlite', web: env.JUDOJU_WEB_DB ?? '/collector/collection.sqlite',
  key: env.JUDOJU_AI_KEY_FILE ?? '/run/secrets/openai.key', dartKey: env.JUDOJU_DART_KEY_FILE ?? '/run/secrets/opendart.key', gnewsKey: env.JUDOJU_GNEWS_KEY_FILE ?? '/run/secrets/gnews.key', finlightKey: env.JUDOJU_FINLIGHT_KEY_FILE ?? '/run/secrets/finlight.key',
  corpCodes: env.JUDOJU_DART_CORP_CODES ?? new URL('../../../data/dart-corp-codes.tsv', import.meta.url), heartbeat: env.JUDOJU_AI_HEARTBEAT ?? '/ai/heartbeat', status: env.JUDOJU_AI_STATUS ?? '/ai/status.json' };
const execute = env.JUDOJU_AI_EXECUTE === '1';
const importEvery = 10 * 60_000, dartEvery = 30 * 60_000;

const log = event => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
export function effectiveConfig(raw, executeAllowed) {
  const value = validateConfig(raw);
  return { ...value, readOriginals: value.readOriginals && executeAllowed, callModels: value.callModels && executeAllowed };
}

async function main() {
  const store = new BacklogStore(paths.db);
  const loadConfig = () => effectiveConfig(JSON.parse(readFileSync(paths.config, 'utf8')), execute);
  const initial = loadConfig();
  const model = initial.callModels ? createOpenAiModel({ apiKey: readFileSync(paths.key, 'utf8').trim() })
    : async () => { throw new Error('MODEL_EXECUTION_DISABLED'); };
  const robots = { loadRobots: (origin, now) => store.loadRobots(origin, now), saveRobots: (origin, value) => store.saveRobots(origin, value) };
  // OpenDART: filings are listed and read only through the official API (the DART website disallows robots).
  const dart = existsSync(paths.dartKey) ? createDartClient({ apiKey: readFileSync(paths.dartKey, 'utf8').trim() }) : null;
  const corpCodes = dart ? readCorpCodes(readFileSync(paths.corpCodes, 'utf8')) : new Map();
  const readOriginal = createDartReader({ client: dart, fallback: createOriginalReader(robots) });
  const processor = createBacklogProcessor({ store, loadConfig, model, readOriginal, resolveLink: createLinkResolver(robots) });
  const stop = new AbortController(); process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
  log({ event: 'AI_SERVICE_START', execute, readOriginals: initial.readOriginals, callModels: initial.callModels, maxDailyCalls: initial.maxDailyCalls, dart: Boolean(dart), watchedCompanies: corpCodes.size });
  // Company press/newsroom/IR feeds (2026-11-28): a separate background loop (one host per minute, each host once a
  // day), so its polite waits never hold up processing, delivery or the heartbeat.
  const pause = ms => sleep(ms, undefined, { signal: stop.signal });
  const discoverOne = createCompanyFeedDiscovery({ transport: createOriginalTransport(), store, sleep: pause, signal: stop.signal });
  const companyLoop = startCompanyFeedLoop({ discoverOne, loadConfig, importLinks: links => store.importLinks(links, Date.now()), log, signal: stop.signal, sleep: pause });
  // GNews Essential (2026-11-28): news discovery as signals only, every 15 minutes (<=300 requests a day).
  // Signals only, recorded straight into news_signals (never queued for reading); its own background loop.
  const gnews = existsSync(paths.gnewsKey) ? createGnewsClient({ apiKey: readFileSync(paths.gnewsKey, 'utf8').trim(), db: store.db, signal: stop.signal }) : null;
  const gnewsLoop = gnews ? startGnewsLoop({ client: gnews, record: entries => store.recordNewsSignals(entries, Date.now()), log, signal: stop.signal, sleep: pause }) : Promise.resolve();
  // Finlight Pro Light (2026-11-28): Korean news signals with tickers, every 10 minutes, its own background loop.
  const finlight = existsSync(paths.finlightKey) ? createFinlightClient({ apiKey: readFileSync(paths.finlightKey, 'utf8').trim(), db: store.db, signal: stop.signal }) : null;
  const finlightLoop = finlight ? startFinlightLoop({ client: finlight, record: entries => store.recordNewsSignals(entries, Date.now()), log, signal: stop.signal, sleep: pause }) : Promise.resolve();
  let nextImport = 0, nextDart = 0, nextMatch = 0, sources = null, matches = null, nextSources = 0;
  try {
    while (!stop.signal.aborted) {
      const now = Date.now();
      if (now >= nextImport) {
        const entries = [];
        for (const [file, kind] of [[paths.telegram, 'telegram'], [paths.web, 'web']]) {
          try { if (existsSync(file)) entries.push(...readSavedLinks(file, kind, now)); } catch { log({ event: 'AI_IMPORT_SOURCE_FAILED', kind }); }
        }
        log({ event: 'AI_IMPORT', ...store.importLinks(entries, now) });
        nextImport = now + importEvery;
      }
      if (dart && loadConfig().readOriginals && now >= nextDart) {
        try { const filings = await dart.newFilings(corpCodes, now); log({ event: 'AI_DART_LIST', filings: filings.length, stockCodes: learnStockCodes(store.db, filings, now), ...store.importLinks(filings, now) }); }
        catch (error) { log({ event: 'AI_DART_LIST_FAILED', reason: /^DART_[A-Z_0-9]+$/.test(error.message) ? error.message : 'DART_LIST_FAILED' }); }
        nextDart = now + dartEvery;
      }
      // Issue → evidence matching: news-API company issues move that company's queued DART and company-site documents forward.
      if (now >= nextMatch) {
        try { log({ event: 'AI_ISSUE_MATCH', ...matchIssues(store.db, buildCompanyIndex(loadConfig(), [...corpCodes.values()]), now) }); }
        catch { log({ event: 'AI_ISSUE_MATCH_FAILED' }); }
        // Home ranking v2 R1: news signal → issue links for the diagnostic preview.
        try { log({ event: 'AI_SIGNAL_LINKS', ...linkSignals(store.db, loadConfig(), now) }); } catch { log({ event: 'AI_SIGNAL_LINKS_FAILED' }); }
        nextMatch = now + importEvery;
      }
      let result;
      try { result = await processor.step(); } catch { result = { state: 'STEP_FAILED' }; }
      if (result.state !== 'IDLE' && result.state !== 'PAUSED') log({ event: 'AI_STEP', state: result.state, reason: result.reason ?? null });
      // Publish stage 2A: cloud delivery, only while the push setting file says so (re-read every cycle).
      try {
        const delivery = await deliveryCycle({ db: store.db });
        if (!['OFF', 'IDLE'].includes(delivery.state)) log({ event: 'AI_DELIVERY', ...delivery });
      } catch { log({ event: 'AI_DELIVERY_FAILED' }); }
      writeFileSync(paths.heartbeat, String(Date.now()));
      // Per-source status (24 hours), refreshed once a minute.
      if (Date.now() >= nextSources) {
        try { sources = sourceStatus(store.db, Date.now()); } catch { sources = null; }
        try { matches = matchStatus(store.db, Date.now()); } catch { matches = null; }
        nextSources = Date.now() + 60_000;
      }
      writeFileSync(paths.status + '.pending', JSON.stringify({ at: Date.now(), execute, ...store.status(), issueMatches: matches, sources, delivery: deliveryStatus(store.db, Date.now()) }));
      renameSync(paths.status + '.pending', paths.status);
      const idle = result.state === 'IDLE' || result.state === 'PAUSED';
      await sleep(idle ? 30_000 : 1000, undefined, { signal: stop.signal }).catch(error => { if (!stop.signal.aborted) throw error; });
    }
  } finally {
    stop.abort();
    // Let an in-flight feed request finish (8 s timeout) before the database closes.
    await Promise.race([Promise.all([companyLoop, gnewsLoop, finlightLoop]), sleep(10_000)]).catch(() => {});
    store.close();
  }
}

if (process.argv[1]?.endsWith('service.mjs')) main().catch(() => { console.error('AI_SERVICE_FAILED'); process.exitCode = 1; });
