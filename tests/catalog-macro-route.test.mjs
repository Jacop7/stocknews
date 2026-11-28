// Macro filter in the gateway route (docs/sector-news-plan.md §1): only macro=1 is accepted, it adds p_macro to the
// RPC call and to the cursor context; without it the call, the context hash and existing cursors stay exactly as before.
// The app helpers (filter labels, feed query) are covered by the type check in verify:integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { catalogRoute } from '../scripts/catalog/public-route.mjs';

const S1 = '11111111-1111-4111-8111-111111111111';
const route = query => catalogRoute(new URL('http://x/v2/articles?' + query));
const oldContext = (head, sectors, period, limit) => createHash('sha256').update(JSON.stringify({ version: head, sectors, period, limit })).digest('hex');

test('without macro the call and the context are unchanged', () => {
  const r = route('version=7&sectors=' + S1 + '&period=TODAY&limit=20');
  assert.equal('p_macro' in r.args, false);
  assert.equal(r.context, oldContext('7', [S1], 'TODAY', 20));
});

test('macro=1 adds p_macro=true and a different cursor context; macro alone is allowed', () => {
  const r = route('version=7&macro=1&period=TODAY&limit=20');
  assert.equal(r.args.p_macro, true); assert.deepEqual(r.args.p_sectors, []);
  assert.notEqual(r.context, oldContext('7', [], 'TODAY', 20));
  const both = route('version=7&sectors=' + S1 + '&macro=1');
  assert.equal(both.args.p_macro, true); assert.deepEqual(both.args.p_sectors, [S1]);
});

test('any other macro value is rejected', () => {
  for (const v of ['0', 'true', '', '11']) assert.throws(() => route('version=7&macro=' + v), /INVALID_PARAMETER/);
});

test('a cursor from a macro feed is not valid for the plain feed and the other way round', () => {
  const plain = route('version=7&period=TODAY&limit=20');
  const cursor = Buffer.from(JSON.stringify({ version: 2, catalog_version: '7', filter_hash: plain.context, as_of: '2026-11-28T00:00:00Z',
    last_time: '2026-11-27T23:00:00Z', last_id: S1 })).toString('base64url');
  assert.equal(route('version=7&period=TODAY&limit=20&cursor=' + cursor).args.p_last_id, S1, 'old cursor still valid');
  assert.throws(() => route('version=7&period=TODAY&limit=20&macro=1&cursor=' + cursor), /INVALID_CURSOR_CONTEXT/);
});
