// Publish stage 1B (B5): every reader serves exactly one article kind. The response validators take the expected kind
// as a required argument, the local gateway has a separate review mode for real articles, and each mode starts only
// against the matching database identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoute, createPublicGateway, READ_MODES } from '../scripts/public-read-gateway.mjs';
import { catalogResponse } from '../scripts/catalog/public-route.mjs';
import { searchResponse } from '../scripts/catalog/search-route.mjs';
import { previewResponse } from '../scripts/cloud-preview-public-read.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const when = '2026-11-27T00:00:00.123456+00:00';
const card = kind => ({ issue_id: id(1), version_id: id(2), title: 't', summary: 's', first_published_at: when, material_change_at: when, sample_kind: kind, article_kind: 'SECTOR' });
const cfg = { productId: 'judoju-news', environment: 'local', sampleKind: 'SYNTHETIC', bootstrapId: 'test-owned', apiUrl: 'http://127.0.0.1:62321', webOrigins: ['http://127.0.0.1:8084'] };
const identity = mode => ({ productId: 'judoju-news', environment: 'local', sampleKind: READ_MODES[mode].sampleKind, bootstrapId: cfg.bootstrapId, contract: READ_MODES[mode].contract });

test('validators require an expected kind and refuse the other kind', () => {
  const articles = readRoute(`/v2/articles?version=2&sectors=${id(9)}`);
  const page = kind => ({ catalog_version: '2', as_of: when, items: [card(kind)], next: null });
  for (const bad of [undefined, null, '', 'REVIEW_REAL', 'synthetic']) {
    assert.throws(() => catalogResponse(articles, page('SYNTHETIC'), bad), /EXPECTED_KIND_REQUIRED/);
    assert.throws(() => searchResponse(readRoute('/v2/search/news?version=2&q=a'), { catalog_version: '2', as_of: when, items: [] }, bad), /EXPECTED_KIND_REQUIRED/);
  }
  for (const [expected, other] of [['SYNTHETIC', 'PERMITTED_REAL'], ['PERMITTED_REAL', 'SYNTHETIC']]) {
    assert.equal(catalogResponse(articles, page(expected), expected).items.length, 1);
    assert.throws(() => catalogResponse(articles, page(other), expected), /SYNTHETIC_DTO_REQUIRED/);
    const news = readRoute('/v2/search/news?version=2&q=a');
    assert.equal(searchResponse(news, { catalog_version: '2', as_of: when, items: [card(expected)] }, expected).items.length, 1);
    assert.throws(() => searchResponse(news, { catalog_version: '2', as_of: when, items: [card(other)] }, expected), /INVALID_SEARCH_DTO/);
    const saved = readRoute(`/v2/saved?version=2&ids=${id(1)}`);
    const item = kind => ({ catalog_version: '2', items: [{ requested_issue_id: id(1), state: 'PUBLISHED', canonical_issue_id: id(1), card: card(kind) }] });
    assert.equal(searchResponse(saved, item(expected), expected).items.length, 1);
    assert.throws(() => searchResponse(saved, item(other), expected), /INVALID_SEARCH_DTO/);
  }
});

test('the cloud preview reader stays synthetic and refuses real items', () => {
  const route = readRoute(`/v2/articles?version=2&sectors=${id(9)}`);
  assert.throws(() => previewResponse(route, { catalog_version: '2', as_of: when, items: [card('PERMITTED_REAL')], next: null }));
  assert.equal(previewResponse(route, { catalog_version: '2', as_of: when, items: [card('SYNTHETIC')], next: null }).items.length, 1);
});

test('each local mode starts only against its own identity, and the review mode is loopback only', async () => {
  await assert.rejects(createPublicGateway(cfg, { port: 0, transport: async () => identity('LOCAL_REVIEW_REAL') }), /PRODUCT_FINGERPRINT_MISMATCH/);
  await assert.rejects(createPublicGateway(cfg, { mode: 'LOCAL_REVIEW_REAL', port: 0, transport: async () => identity('LOCAL_SYNTHETIC') }), /PRODUCT_FINGERPRINT_MISMATCH/);
  await assert.rejects(createPublicGateway(cfg, { mode: 'LOCAL_REVIEW_REAL', lan: true, port: 0, transport: async () => identity('LOCAL_REVIEW_REAL') }), /REVIEW_REAL_LOOPBACK_ONLY/);
  await assert.rejects(createPublicGateway(cfg, { mode: 'LOCAL_REVIEW_REAL', port: 0, readHomeRanking: async () => null, transport: async () => identity('LOCAL_REVIEW_REAL') }), /REVIEW_REAL_LOOPBACK_ONLY/);
  await assert.rejects(createPublicGateway(cfg, { mode: 'PREVIEW_SYNTHETIC', port: 0, transport: async () => identity('LOCAL_SYNTHETIC') }), /READ_MODE_REJECTED/);
  assert.equal(READ_MODES.LOCAL_REVIEW_REAL.port, 62332);
});

test('the review gateway serves real articles under its own mode and refuses synthetic ones', async () => {
  let payload = [card('PERMITTED_REAL')];
  const g = await createPublicGateway(cfg, { mode: 'LOCAL_REVIEW_REAL', port: 0, transport: async (c, name) => name === 'm1_public_identity' ? identity('LOCAL_REVIEW_REAL') : payload });
  try {
    const ok = await fetch(`http://127.0.0.1:${g.port}/articles`);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.mode, 'LOCAL_REVIEW_REAL');
    assert.equal(body.data[0].sample_kind, 'PERMITTED_REAL');
    payload = [card('SYNTHETIC')];
    assert.equal((await fetch(`http://127.0.0.1:${g.port}/articles`)).status, 502);
    payload = { state: 'PUBLISHED', sample_kind: 'SYNTHETIC' };
    assert.equal((await fetch(`http://127.0.0.1:${g.port}/articles/${id(1)}`)).status, 502);
  } finally { await g.close(); }
});

test('the app resolves the review mode only for this computer in explicit local builds', async () => {
  const { resolveReadTarget } = await import('../apps/mobile/src/data/read-target.ts');
  assert.deepEqual(resolveReadTarget({ base: 'http://127.0.0.1:62332', mode: 'LOCAL_REVIEW_REAL', environment: 'local' }), { url: 'http://127.0.0.1:62332', mode: 'LOCAL_REVIEW_REAL' });
  for (const input of [
    { base: 'http://127.0.0.1:62332', mode: 'LOCAL_REVIEW_REAL' },
    { base: 'http://127.0.0.1:62332', mode: 'LOCAL_REVIEW_REAL', environment: 'development' },
    { base: 'http://127.0.0.1:62332', mode: 'LOCAL_REVIEW_REAL', environment: 'preview' },
    { base: 'http://127.0.0.1:62332', mode: 'LOCAL_REVIEW_REAL', environment: 'production' },
    { base: 'http://192.168.200.132:62332', mode: 'LOCAL_REVIEW_REAL', environment: 'local' },
    { base: 'http://127.0.0.1:62330', mode: 'LOCAL_REVIEW_REAL', environment: 'local' },
    { base: 'http://127.0.0.1:62332', mode: 'LOCAL_SYNTHETIC', environment: 'local' },
    { base: 'http://127.0.0.1:62332/', mode: 'LOCAL_REVIEW_REAL', environment: 'local' },
  ]) assert.throws(() => resolveReadTarget(input), JSON.stringify(input));
});

test('the app shows the review band on every screen and a badge on real articles', async () => {
  const { readFileSync } = await import('node:fs');
  const screen = readFileSync(new URL('../apps/mobile/src/components/Screen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /<SafeAreaView style=\{s\.root\}><ReviewBand\/>/);
  assert.match(screen, /내부 검토용 실데이터 · 투자 권유 아님/);
  assert.match(screen, /kind==='PERMITTED_REAL'\?<Text testID='real-badge'/);
  // The synthetic notice is never shown in the real review mode.
  assert.ok(screen.includes("{currentReadMode()==='LOCAL_REVIEW_REAL'?'개발 DB · 내부 검토용 실데이터 · 순위/시세 미연결':'개발 DB · 합성 기사 · 순위/시세 미연결'}"));
  assert.equal(screen.split('합성 기사').length - 1, 1);
  assert.match(readFileSync(new URL('../apps/mobile/src/components/NewsCard.tsx', import.meta.url), 'utf8'), /<RealBadge kind=\{n\.sample_kind\}\/>/);
  assert.match(readFileSync(new URL('../apps/mobile/src/app/article/[id].tsx', import.meta.url), 'utf8'), /<RealBadge kind=\{article\.sample_kind\}\/>/);
});

test('the admin shows the publish button for a real draft only when the server allows it, never scheduling', async () => {
  const { readFileSync } = await import('node:fs');
  const ui = readFileSync(new URL('../apps/admin/components/AdminConsole.tsx', import.meta.url), 'utf8');
  assert.match(ui, /const realPublishAllowed=realDraft&&draft\?\.real_publish_allowed===true;/);
  assert.match(ui, /\{\(!realDraft\|\|realPublishAllowed\)&&<button className='primary'/);
  assert.match(ui, /\{!previewMode&&!realDraft&&<ReservationManager/);
  for (const reason of ['AI_SOURCE_REVOKED', 'FACT_RECORD_EXPIRED', 'CORRECTION_TIMEOUT']) assert.ok(ui.includes(reason + ':'), reason);
});

test('the admin offers adoption of a held AI version only when the server marks it adoptable', async () => {
  const { readFileSync } = await import('node:fs');
  const panel = readFileSync(new URL('../apps/admin/components/AiOriginPanel.tsx', import.meta.url), 'utf8');
  assert.ok(panel.includes("{origin.pending && origin.adoptable === true && onAdopt && <button"));
  assert.ok(panel.includes('직접 고친 내용은 사라집니다'));
  const route = readFileSync(new URL('../apps/admin/app/api/editor/[...action]/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes("adopt:'m1_adopt_ai_version'"));
  const ui = readFileSync(new URL('../apps/admin/components/AdminConsole.tsx', import.meta.url), 'utf8');
  assert.ok(ui.includes("api('adopt',{p_issue:issue,p_ai_version:version,p_expected_revision:draft.draft_revision,p_effect_key:crypto.randomUUID()},csrf)"));
});
