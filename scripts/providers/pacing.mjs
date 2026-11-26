// Visit spacing agreed for collectors (2026-11-26):
// - the same host keeps its minimum gap (at least 5s) plus a random 0-3s on top;
// - consecutive requests to different hosts wait a random 1-3s.
// Robots crawl-delay, Retry-After, 429 and access-denied waits are applied separately and always win.
// The random source is injected so library callers and tests stay deterministic (default: no jitter).
import assert from 'node:assert/strict';

export const hostJitterMs = 3000;
export const crossHostGapMs = [1000, 3000];

const draw = random => {
  const value = random();
  assert(Number.isFinite(value) && value >= 0 && value < 1, 'INVALID_RANDOM');
  return value;
};
export const noJitter = () => 0;
export const hostGap = (baseMs, random = noJitter) => baseMs + Math.floor(draw(random) * hostJitterMs);
export const betweenRequests = (random = noJitter) =>
  crossHostGapMs[0] + Math.floor(draw(random) * (crossHostGapMs[1] - crossHostGapMs[0]));
