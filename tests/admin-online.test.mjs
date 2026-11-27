// CLOUD11-online: session broker and online admin runtime with fake Supabase responses (no network, no keys).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createBroker, validateBrokerConfig } from '../scripts/admin-broker.mjs';
import { createOnlineRuntime, validateOnlineConfig, brokerSignature } from '../apps/admin/lib/runtime-online.mjs';
import { onlineHost, onlineOrigin } from '../apps/admin/lib/admin-profile.mjs';

const API = 'https://nxfpfvsdwbziowkxsxnh.supabase.co', OWNER = 'e85049b7-7306-42ad-ac16-6c4bf5e82212', OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333', FACTOR = '44444444-4444-4444-8444-444444444444';
const ipcKey = randomBytes(32).toString('hex'), email = 'owner@example.invalid';
const jwt = claims => ['e30', Buffer.from(JSON.stringify({ role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...claims })).toString('base64url'), 'sig'].join('.');
const brokerConfig = validateBrokerConfig({ apiUrl: API, secretKey: 'sb_secret_SYNTHETIC_ONLY_1234567890', publishableKey: 'sb_publishable_SYNTHETIC_ONLY_1234567890', ipcKey, ownerUserId: OWNER, socketPath: '/run/judoju-broker/broker.sock' });
const onlineConfig = validateOnlineConfig({ apiUrl: API, brokerSocket: '/run/judoju-broker/broker.sock', encryptionKey: randomBytes(32).toString('hex'), ipcKey, origin: onlineOrigin,
  ownerEmailSha256: createHash('sha256').update(email).digest('hex'), ownerUserId: OWNER, projectRef: 'nxfpfvsdwbziowkxsxnh', publishableKey: 'sb_publishable_SYNTHETIC_ONLY_1234567890' });

// A fake Supabase: Auth password/user/factors/challenge/verify/logout and the RPCs, recording every request.
function fakeSupabase({ verified = true, aalAfterVerify = 'aal2', userId = OWNER, failOthers = false, failLocal = false } = {}) {
  const calls = [], sessions = new Map();
  const aal1 = jwt({ sub: userId, session_id: SESSION, aal: 'aal1' }), aal2 = jwt({ sub: userId, session_id: SESSION, aal: aalAfterVerify });
  const fetcher = async (url, init) => {
    const route = url.replace(API, ''), body = init.body ? JSON.parse(init.body) : null; calls.push({ route, headers: init.headers, body });
    const ok = value => new Response(JSON.stringify(value), { status: 200 }), bad = (code, status = 400) => new Response(JSON.stringify({ message: code }), { status });
    if (route === '/rest/v1/rpc/m1_public_identity') return ok({ productId: 'judoju-news', environment: 'preview', sampleKind: 'SYNTHETIC', bootstrapId: null, contract: 'M1' });
    if (route === '/auth/v1/token?grant_type=password') return body.password === 'right' ? ok({ access_token: aal1, refresh_token: 'r' }) : bad('INVALID_CREDENTIALS');
    if (route === '/auth/v1/user') { const token = init.headers.Authorization.slice(7); const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); return ok({ id: c.sub, factors: verified ? [{ id: FACTOR, factor_type: 'totp', status: 'verified' }] : [] }); }
    if (route === '/auth/v1/factors' && init.method === 'POST') return ok({ id: FACTOR, totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABC' } });
    if (route.endsWith('/challenge')) return ok({ id: '55555555-5555-4555-8555-555555555555' });
    if (route.endsWith('/verify')) return body.code === '123456' ? ok({ access_token: aal2, refresh_token: 'r2' }) : bad('INVALID_TOTP', 422);
    if (route === '/auth/v1/logout?scope=others' && failOthers) return bad('AUTH_DOWN', 500);
    if (route === '/auth/v1/logout?scope=local' && failLocal) return bad('AUTH_DOWN', 500);
    if (route.startsWith('/auth/v1/logout')) return new Response(null, { status: 204 });
    if (route === '/rest/v1/rpc/m1_open_admin_session') { sessions.set(body.p_hash, { ciphertext: body.p_ciphertext, user_id: body.p_user, auth_session_id: body.p_auth_session, expires_at: body.p_expires }); return ok({ created: true }); }
    if (route === '/rest/v1/rpc/m1_read_admin_session') return ok(sessions.get(body.p_hash) ?? null);
    if (route === '/rest/v1/rpc/m1_close_admin_session') { sessions.delete(body.p_hash); return ok({ closed: true }); }
    if (route === '/rest/v1/rpc/m1_check_editor' || route === '/rest/v1/rpc/m1_editor_articles')
      return init.headers['x-judoju-capability'] && sessions.has(createHash('sha256').update(init.headers['x-judoju-capability']).digest('hex')) ? ok({ admin: true }) : bad('EDITOR_ONLY', 401);
    if (route === '/rest/v1/rpc/admin_online_revoke') return ok({ revoked: true });
    return bad('UNEXPECTED_ROUTE ' + route, 500);
  };
  return { fetcher, calls, aal1, aal2 };
}
const signed = (op, payload, { ts = Date.now(), nonce = randomBytes(16).toString('hex'), key = ipcKey } = {}) => {
  const body = JSON.stringify(payload); return [op, body, { 'x-ts': String(ts), 'x-nonce': nonce, 'x-sig': brokerSignature(key, String(ts), nonce, op, body) }];
};

test('broker refuses unsigned, stale, replayed, wrongly keyed and unknown requests', async () => {
  const fake = fakeSupabase(), broker = createBroker(brokerConfig, { fetcher: fake.fetcher });
  await assert.rejects(broker.handle('read', JSON.stringify({ hash: 'a'.repeat(64) }), {}), /BROKER_UNAUTHORIZED/);
  await assert.rejects(broker.handle(...signed('read', { hash: 'a'.repeat(64) }, { ts: Date.now() - 60000 })), /BROKER_UNAUTHORIZED/);
  await assert.rejects(broker.handle(...signed('read', { hash: 'a'.repeat(64) }, { key: randomBytes(32).toString('hex') })), /BROKER_UNAUTHORIZED/);
  const once = signed('read', { hash: 'a'.repeat(64) }); await broker.handle(...once); await assert.rejects(broker.handle(...once), /BROKER_REPLAY/);
  await assert.rejects(broker.handle(...signed('grant', {})), /BROKER_OP_REJECTED/);
  await assert.rejects(broker.handle(...signed('read', { hash: 'a'.repeat(64), extra: 1 })), /BROKER_INPUT_REJECTED/);
  assert.equal(fake.calls.at(-1).headers.apikey, brokerConfig.secretKey);
});

test('broker opens a session only for a live aal2 owner token and takes the ids from that token', async () => {
  const fake = fakeSupabase(), broker = createBroker(brokerConfig, { fetcher: fake.fetcher });
  const open = token => broker.handle(...signed('open', { accessToken: token, hash: 'b'.repeat(64), ciphertext: 'x'.repeat(40), expires: new Date(Date.now() + 600000).toISOString() }));
  await assert.rejects(open(fake.aal1), /BROKER_AAL2_OWNER_REQUIRED/);
  await assert.rejects(open(jwt({ sub: OTHER, session_id: SESSION, aal: 'aal2' })), /BROKER_AAL2_OWNER_REQUIRED/);
  await open(fake.aal2);
  const rpc = fake.calls.find(c => c.route === '/rest/v1/rpc/m1_open_admin_session');
  assert.deepEqual([rpc.body.p_user, rpc.body.p_auth_session, rpc.headers.apikey, rpc.headers.Authorization], [OWNER, SESSION, brokerConfig.secretKey, undefined]);
  await assert.rejects(broker.handle(...signed('open', { accessToken: fake.aal2, hash: 'c'.repeat(64), ciphertext: 'x'.repeat(40), expires: new Date(Date.now() + 9 * 3600000).toISOString() })), /BROKER_INPUT_REJECTED/);
});

function runtimeWith(fake, statePath, now = Date.now) {
  const broker = createBroker(brokerConfig, { fetcher: fake.fetcher });
  return createOnlineRuntime({ loadConfig: () => onlineConfig, fetcher: fake.fetcher, statePath: () => statePath, now,
    brokerTransport: async (op, body, headers) => broker.handle(op, body, headers) });
}

test('online login: owner only, password then TOTP; editor calls carry the capability; a stolen token alone fails', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'judoju-admin-online-'));
  try {
    const fake = fakeSupabase(), rt = runtimeWith(fake, path.join(dir, 'limits.json'));
    await assert.rejects(rt.login('someone@example.invalid', 'right', '203.0.113.1'), /LOGIN_INVALID/);
    assert.equal(fake.calls.some(c => c.route.startsWith('/auth/v1/token')), false);
    const step = await rt.login(email, 'right', '203.0.113.1');
    assert.equal(step.step, 'challenge'); assert.match(step.pendingId, /^[A-Za-z0-9_-]{43}$/);
    await assert.rejects(rt.mfaVerify(step.pendingId, '000000'), /MFA_CODE_INVALID/);
    const done = await rt.mfaVerify(step.pendingId, '123456');
    assert.ok(fake.calls.some(c => c.route === '/auth/v1/logout?scope=others'), 'other owner sessions end after aal2');
    await assert.rejects(rt.mfaVerify(step.pendingId, '123456'), /MFA_PENDING_REQUIRED/);
    const s = await rt.session(done.capability);
    assert.deepEqual(await rt.editorRpc('m1_editor_articles', {}, s), { admin: true });
    const call = fake.calls.at(-1); assert.equal(call.headers['x-judoju-capability'], done.capability); assert.equal(call.headers.Authorization, 'Bearer ' + fake.aal2);
    // The same JWT without the capability is refused by the (fake) DB, as is any non-editor function name.
    await assert.rejects(rt.editorRpc('m1_editor_articles', {}, { ...s, capability: undefined }), /EDITOR_ONLY/);
    await assert.rejects(rt.editorRpc('admin_online_revoke', {}, s), /RPC_NOT_ALLOWED/);
    await rt.logout(done.capability, s); await assert.rejects(rt.session(done.capability), /LOGIN_REQUIRED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('online login: first sign-in enrols TOTP; five wrong codes drop the pending login; aal1 sessions never open', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'judoju-admin-online-'));
  try {
    const fake = fakeSupabase({ verified: false }), rt = runtimeWith(fake, path.join(dir, 'limits.json'));
    const step = await rt.login(email, 'right', '203.0.113.2'); assert.equal(step.step, 'enroll');
    assert.deepEqual(await rt.mfaEnroll(step.pendingId), { qrCode: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABC' });
    for (let i = 0; i < 4; i++) await assert.rejects(rt.mfaVerify(step.pendingId, '999999'), /MFA_CODE_INVALID/);
    await assert.rejects(rt.mfaVerify(step.pendingId, '999999'), /MFA_CODE_INVALID/);
    await assert.rejects(rt.mfaVerify(step.pendingId, '123456'), /MFA_PENDING_REQUIRED/);
    const weak = fakeSupabase({ aalAfterVerify: 'aal1' }), rt2 = runtimeWith(weak, path.join(dir, 'limits2.json'));
    const s2 = await rt2.login(email, 'right', '203.0.113.3'); await assert.rejects(rt2.mfaVerify(s2.pendingId, '123456'), /MFA_NOT_AAL2/);
    assert.equal(weak.calls.some(c => c.route === '/rest/v1/rpc/m1_open_admin_session'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('online login: prior sessions must end before a session opens; expired pending logins are logged out with retry', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'judoju-admin-online-'));
  try {
    const down = fakeSupabase({ failOthers: true }), rt = runtimeWith(down, path.join(dir, 'a.json'));
    const step = await rt.login(email, 'right', '203.0.113.4');
    await assert.rejects(rt.mfaVerify(step.pendingId, '123456'), /PRIOR_SESSIONS_NOT_ENDED/);
    assert.equal(down.calls.some(c => c.route === '/rest/v1/rpc/m1_open_admin_session'), false);
    assert.ok(down.calls.some(c => c.route === '/auth/v1/logout?scope=local'), 'the new login is ended too');
    let t = Date.now(); const flaky = fakeSupabase({ failLocal: true }), rt2 = runtimeWith(flaky, path.join(dir, 'b.json'), () => t);
    const p = await rt2.login(email, 'right', '203.0.113.5'); t += 301000;
    await assert.rejects(rt2.mfaVerify(p.pendingId, '123456'), /MFA_PENDING_REQUIRED/);
    await rt2.login(email, 'right', '203.0.113.6').catch(() => {});
    const tries = () => flaky.calls.filter(c => c.route === '/auth/v1/logout?scope=local').length;
    assert.ok(tries() >= 1, 'expired pending login is logged out'); const before = tries();
    await rt2.login(email, 'right', '203.0.113.7').catch(() => {}); assert.ok(tries() > before, 'a failed logout is retried, not forgotten');
    // Auth logout down: neither five wrong codes nor a failed prior-session logout may forget the session to end.
    const out = fakeSupabase({ failOthers: true, failLocal: true }), rt3 = runtimeWith(out, path.join(dir, 'c.json'));
    const localTries = () => out.calls.filter(c => c.route === '/auth/v1/logout?scope=local').length;
    const q1 = await rt3.login(email, 'right', '203.0.113.8');
    for (let i = 0; i < 5; i++) await assert.rejects(rt3.mfaVerify(q1.pendingId, '999999'), /MFA_CODE_INVALID/);
    const q2 = await rt3.login(email, 'right', '203.0.113.9'); await assert.rejects(rt3.mfaVerify(q2.pendingId, '123456'), /PRIOR_SESSIONS_NOT_ENDED/);
    const n = localTries(); await rt3.login(email, 'right', '203.0.113.10').catch(() => {});
    assert.ok(localTries() >= n + 2, 'both the dropped aal1 login and the retired aal2 token are retried');
    const tick = async () => { await rt3.mfaVerify('A'.repeat(43), '123456').catch(() => {}); await new Promise(r => setTimeout(r, 5)); };
    for (let i = 0; i < 70; i++) await tick();
    const m = localTries(); await tick();
    assert.ok(localTries() > m, 'retries continue while the token is still valid, however many sweeps ran');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('login limits persist across restarts; writes need the public host, origin and CSRF', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'judoju-admin-online-'));
  try {
    const file = path.join(dir, 'limits.json'), fake = fakeSupabase();
    let rt = runtimeWith(fake, file);
    for (let i = 0; i < 5; i++) await assert.rejects(rt.login(email, 'wrong', '198.51.100.9'), /INVALID_CREDENTIALS|LOGIN_INVALID/);
    rt = runtimeWith(fake, file);
    await assert.rejects(rt.login(email, 'right', '198.51.100.9'), /LOGIN_RATE_LIMITED/);
    await assert.rejects(rt.login(email, 'right', 'not an address'), /CLIENT_ADDRESS_REQUIRED/);
    const h = (host, origin) => new Headers({ host, origin, 'content-type': 'application/json' });
    rt.assertWrite(h(onlineHost, onlineOrigin), 'a'.repeat(32), 'a'.repeat(32));
    assert.throws(() => rt.assertWrite(h(onlineHost, 'https://evil.example'), undefined, undefined), /ORIGIN_OR_CONTENT_TYPE_REJECTED/);
    assert.throws(() => rt.assertWrite(h('127.0.0.1:62333', onlineOrigin), undefined, undefined), /ORIGIN_OR_CONTENT_TYPE_REJECTED/);
    assert.throws(() => rt.assertWrite(h(onlineHost, onlineOrigin), 'a'.repeat(32), 'b'.repeat(32)), /CSRF_REJECTED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('configs: exact fields; the web admin config holds no secret key', () => {
  assert.equal('secretKey' in onlineConfig, false);
  assert.throws(() => validateOnlineConfig({ ...onlineConfig, secretKey: 'sb_secret_x' }), /ONLINE_CONFIG_REJECTED/);
  assert.throws(() => validateBrokerConfig({ ...brokerConfig, secretKey: 'sb_publishable_SYNTHETIC_ONLY_1234567890' }), /BROKER_CONFIG_REJECTED/);
});
