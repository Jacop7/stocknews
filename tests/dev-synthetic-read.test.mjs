import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startSyntheticReadServer } from '../scripts/dev/synthetic-read-server.mjs';

// The dev server must answer every public route the app uses, through the same
// route parsers/validators as the real gateway, with SYNTHETIC data only.
test('synthetic dev read server serves every app route with SYNTHETIC data', async t => {
  const server = await startSyntheticReadServer({ port: 0, now: Date.parse('2026-11-26T02:00:00Z') });
  t.after(() => server.close());
  const get = async path => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
    const body = await response.json();
    return { status: response.status, body };
  };
  const data = async path => {
    const { status, body } = await get(path);
    assert.equal(status, 200, path + ' ' + JSON.stringify(body));
    assert.equal(body.productId, 'judoju-news');
    assert.equal(body.mode, 'LOCAL_SYNTHETIC');
    return body.data;
  };

  const catalog = await data('/v2/catalog');
  assert.equal(catalog.parents.length, 11);
  assert(catalog.parents.every(p => p.sectors.every(s => s.name === s.name.trim())));

  const today = await data('/v2/articles?version=1&period=TODAY&limit=20');
  assert(today.items.length > 0);
  assert(today.items.every(x => x.sample_kind === 'SYNTHETIC' && x.title.startsWith('[합성]')));
  const lastMonth = await data('/v2/articles?version=1&period=LAST_MONTH&limit=20');
  assert(lastMonth.items.length > 0);

  const sector = catalog.parents.flatMap(p => p.sectors).find(s => s.name === '방산');
  const filtered = await data(`/v2/articles?version=1&period=THIS_MONTH&limit=20&sectors=${sector.id}`);
  assert(filtered.items.length > 0);
  assert(filtered.items.every(x => x.sector_id === sector.id || x.impacts.some(i => i.sector_id === sector.id)));

  const home = await data('/v2/home');
  assert.equal(home.state, 'FRESH');
  assert(home.lanes.A.length <= 2 && home.lanes.B.length <= 3 && home.lanes.C.length <= 20);

  const detail = await data('/articles/' + home.lanes.A[0].issue_id);
  assert.equal(detail.state, 'PUBLISHED');
  assert(detail.body.visible_sections.includes('KEY_ISSUES'));
  // Damage-only articles hide scenarios and show the risk checklist.
  const damageOnly = today.items.concat(lastMonth.items, (await data('/v2/articles?version=1&period=THIS_WEEK&limit=20')).items)
    .find(x => x.impacts.length && x.impacts.every(i => i.direction !== 'BENEFIT'));
  if (damageOnly) {
    const body = (await data('/articles/' + damageOnly.issue_id)).body;
    assert(!body.visible_sections.includes('SCENARIOS'));
    assert(body.visible_sections.includes('RISKS'));
  }

  const page = await data('/v2/sectors/' + sector.id);
  assert.equal(page.state, 'AVAILABLE');
  assert(page.ungrouped_members.every(m => m.price === null && m.change_percent === null));

  const companies = await data('/v2/search/companies?version=1&q=' + encodeURIComponent('한화') + '&limit=20');
  assert(companies.items.length > 0);
  const news = await data('/v2/search/news?version=1&q=' + encodeURIComponent('조선') + '&limit=20');
  assert(news.items.length > 0);

  const saved = await data('/v2/saved?version=1&ids=' + [home.lanes.A[0].issue_id, '00000000-0000-4000-a000-000000000000'].join(','));
  assert.deepEqual(saved.items.map(x => x.state), ['PUBLISHED', 'NOT_FOUND']);

  assert.equal((await get('/v2/articles?version=1&period=NEVER')).status, 400);
});
