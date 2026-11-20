import { isDeepStrictEqual } from 'node:util';
import { homeUuid, validateHomeDatabaseReply } from '../workers/home-ranking/src/database-contracts.ts';

const laneNames = ['A', 'B', 'C'];
const deadlineMs = 6000;
const rankingIntervalMs = 5 * 60 * 1000;
const maxFallbackAgeMicroseconds = 15n * 60n * 1000000n;

function calculating(rankingCutoff = null) {
  return {state: 'CALCULATING', ranking_cutoff: rankingCutoff, source_cutoff: null, lanes: {A: [], B: [], C: []}};
}

function timestampInMicroseconds(value) {
  // The validated UTC timestamps may retain PostgreSQL precision beyond Date.parse.
  return BigInt(Date.parse(value)) * 1000n + BigInt(value.slice(23, -1) || '0');
}

function validateSnapshotTiming(snapshot, checkedAt, checkedAtMicroseconds) {
  const expectedCutoffMs = Math.floor(Date.parse(checkedAt) / rankingIntervalMs) * rankingIntervalMs;
  const rankingCutoff = new Date(expectedCutoffMs).toISOString();
  if (snapshot.rankingCutoff !== rankingCutoff) throw new Error('HOME_RANKING_CUTOFF_MISMATCH');
  if (snapshot.state === 'CALCULATING') return;
  if (snapshot.state === 'FRESH' && snapshot.sourceCutoff === rankingCutoff) return;

  const sourceCutoffMs = Date.parse(snapshot.sourceCutoff);
  if (snapshot.state === 'DELAYED' && snapshot.sourceCutoff.length === 24 &&
      sourceCutoffMs % rankingIntervalMs === 0 && sourceCutoffMs < expectedCutoffMs &&
      checkedAtMicroseconds - timestampInMicroseconds(snapshot.sourceCutoff) <= maxFallbackAgeMicroseconds) return;

  throw new Error('HOME_SOURCE_CUTOFF_MISMATCH');
}

async function readSnapshot(readRanking, signal) {
  const value = validateHomeDatabaseReply('read_current_home', await readRanking(signal));
  if (value.principal.componentRole !== 'home_v1_internal_reader') throw new Error('HOME_READER_REQUIRED');
  const {checkedAt, ...snapshot} = value.result;
  const checkedAtMicroseconds = timestampInMicroseconds(checkedAt);
  validateSnapshotTiming(snapshot, checkedAt, checkedAtMicroseconds);
  return {
    checkedAtMicroseconds,
    snapshot,
    resourceId: value.resourceId,
    namespaceId: value.namespaceId,
    backendGeneration: value.backendGeneration,
    principal: value.principal,
  };
}

function validPublishedAt(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  const midnight = new Date(date + 'T00:00:00.000Z');
  return Number.isFinite(midnight.getTime()) && midnight.toISOString().slice(0, 10) === date;
}

function toCard(key, article) {
  if (article?.state !== 'PUBLISHED' || article.sample_kind !== 'SYNTHETIC' ||
      article.issue_id !== key.issueId || article.version_id !== key.articleVersionId) return null;
  const {title, summary, first_published_at: publishedAt} = article;
  if (typeof title !== 'string' || !title.trim() || [...title.trim()].length > 200 ||
      typeof summary !== 'string' || !summary.trim() || [...summary.trim()].length > 1500 ||
      !validPublishedAt(publishedAt)) return null;
  return {issue_id: key.issueId, title: title.trim(), summary: summary.trim(), first_published_at: publishedAt};
}

async function assemble(readRanking, readArticle, context, signal) {
  const first = await readSnapshot(readRanking, signal);
  signal.throwIfAborted();
  const {checkedAtMicroseconds: firstCheckedAt, ...binding} = first;
  const {snapshot} = binding;
  context.rankingCutoff = snapshot.rankingCutoff;
  if (snapshot.state === 'CALCULATING') return calculating(context.rankingCutoff);

  const entries = laneNames.flatMap(lane => snapshot.lanes[lane].map(key => ({lane, key})));
  if (entries.some(({key}) => !homeUuid(key.issueId))) return calculating(context.rankingCutoff);
  const lanes = {A: [], B: [], C: []};
  for (let index = 0; index < entries.length; index += 4) {
    const batch = entries.slice(index, index + 4);
    const cards = await Promise.allSettled(batch.map(async ({key}) => toCard(key, await readArticle(key.issueId, signal))));
    signal.throwIfAborted();
    if (cards.some(result => result.status !== 'fulfilled' || result.value === null)) return calculating(context.rankingCutoff);
    for (const [offset, result] of cards.entries()) lanes[batch[offset].lane].push(result.value);
  }

  const {checkedAtMicroseconds: checkedAt, ...currentBinding} = await readSnapshot(readRanking, signal);
  signal.throwIfAborted();
  if (checkedAt < firstCheckedAt) return calculating(context.rankingCutoff);
  if (!isDeepStrictEqual(binding, currentBinding)) {
    return calculating(currentBinding.snapshot.rankingCutoff);
  }
  return {state: snapshot.state, ranking_cutoff: snapshot.rankingCutoff, source_cutoff: snapshot.sourceCutoff, lanes};
}

export function createHomePublicReader({readRanking, readArticle}) {
  let inFlight = null;
  return function readHome() {
    if (inFlight) return inFlight;
    const controller = new AbortController();
    const context = {rankingCutoff: null};
    const response = Promise.withResolvers();
    inFlight = response.promise;
    const timer = setTimeout(() => {
      controller.abort();
      response.resolve(calculating(context.rankingCutoff));
    }, deadlineMs);
    timer.unref();

    const complete = value => {
      clearTimeout(timer);
      inFlight = null;
      response.resolve(value);
    };
    // Keep the single flight occupied until pending reads settle, including after a timeout.
    void assemble(readRanking, readArticle, context, controller.signal).then(
      complete,
      () => complete(calculating(context.rankingCutoff)),
    );
    return response.promise;
  };
}
