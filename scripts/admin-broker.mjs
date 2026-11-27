// CLOUD11-online session broker. The only process holding the Supabase secret key (service_role power).
// Listens on one Unix socket in a volume shared with the admin container; no network port.
// Every request is HMAC-signed (shared IPC key, timestamp within 30 s, nonce never reused) and limited to:
//   open   {accessToken,hash,ciphertext,expires}  - validates the user's token with Auth, requires aal2 and the owner,
//                                                   and fills user/session ids only from that validated token
//   read   {hash}   close {hash}   revoke {}       - fixed RPCs, fixed argument shapes
import { createServer } from 'node:http';
import { readFileSync, lstatSync, unlinkSync, chmodSync, existsSync } from 'node:fs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API = 'https://nxfpfvsdwbziowkxsxnh.supabase.co';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, hex64 = /^[0-9a-f]{64}$/;
const fields = ['apiUrl', 'ipcKey', 'ownerUserId', 'publishableKey', 'secretKey', 'socketPath'];
export class BrokerError extends Error { constructor(code, status = 400) { super(code); this.status = status; } }
const fail = (code, status = 400) => { throw new BrokerError(code, status); };

export function validateBrokerConfig(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).sort().join(',') !== fields.join(',')) fail('BROKER_CONFIG_REJECTED', 503);
  if (c.apiUrl !== API || !/^sb_secret_[A-Za-z0-9_-]{16,256}$/.test(c.secretKey) || !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(c.publishableKey)
    || !hex64.test(c.ipcKey) || !uuid.test(c.ownerUserId) || !/^\/[A-Za-z0-9/_.-]{1,200}\.sock$/.test(c.socketPath)) fail('BROKER_CONFIG_REJECTED', 503);
  return Object.freeze({ ...c });
}
export function readBrokerConfig(file) {
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || (st.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid())) fail('BROKER_CONFIG_REJECTED', 503);
  return validateBrokerConfig(JSON.parse(readFileSync(file, 'utf8')));
}

export function createBroker(c, { fetcher = globalThis.fetch, now = Date.now } = {}) {
  const nonces = new Map(); let opens = [];
  function verify(op, body, headers) {
    const ts = String(headers['x-ts'] ?? ''), nonce = String(headers['x-nonce'] ?? ''), sig = String(headers['x-sig'] ?? '');
    if (!/^\d{13}$/.test(ts) || Math.abs(now() - Number(ts)) > 30000 || !/^[0-9a-f]{32}$/.test(nonce) || !hex64.test(sig)) fail('BROKER_UNAUTHORIZED', 401);
    for (const [k, t] of nonces) if (t < now() - 60000) nonces.delete(k);
    if (nonces.has(nonce)) fail('BROKER_REPLAY', 401);
    const expected = createHmac('sha256', Buffer.from(c.ipcKey, 'hex')).update(`${ts}.${nonce}.${op}.${createHash('sha256').update(body).digest('hex')}`).digest('hex');
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) fail('BROKER_UNAUTHORIZED', 401);
    nonces.set(nonce, now());
  }
  async function supabase(route, { method = 'POST', body, token, secret = false }) {
    const headers = { apikey: secret ? c.secretKey : c.publishableKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let r; try { r = await fetcher(c.apiUrl + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) }); }
    catch { fail('BACKEND_UNAVAILABLE', 503); }
    const text = await r.text(); if (text.length > 262144) fail('BACKEND_RESPONSE_TOO_LARGE', 502);
    let v = null; try { v = text ? JSON.parse(text) : null; } catch { fail('BACKEND_RESPONSE_INVALID', 502); }
    if (!r.ok) { const code = String(v?.message ?? v?.msg ?? 'REQUEST_REJECTED'); fail(/^[A-Z0-9_]{1,80}$/.test(code) ? code : 'REQUEST_REJECTED', r.status === 401 || r.status === 403 ? 403 : 409); }
    return v;
  }
  const exact = (data, keys) => { if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== [...keys].sort().join(',')) fail('BROKER_INPUT_REJECTED'); };
  const ops = {
    async open(data) {
      exact(data, ['accessToken', 'ciphertext', 'expires', 'hash']);
      opens = opens.filter(t => t > now() - 60000); if (opens.length >= 10) fail('BROKER_RATE_LIMITED', 429); opens.push(now());
      if (typeof data.accessToken !== 'string' || data.accessToken.length > 16384 || data.accessToken.split('.').length !== 3 || !hex64.test(data.hash)
        || typeof data.ciphertext !== 'string' || data.ciphertext.length < 20 || data.ciphertext.length > 32768 || !Number.isFinite(Date.parse(data.expires))) fail('BROKER_INPUT_REJECTED');
      // Auth confirms the token is live; the ids then come only from that confirmed token, never from the caller.
      const user = await supabase('/auth/v1/user', { method: 'GET', token: data.accessToken });
      let claim; try { claim = JSON.parse(Buffer.from(data.accessToken.split('.')[1], 'base64url').toString('utf8')); } catch { fail('BROKER_INPUT_REJECTED'); }
      if (user?.id !== c.ownerUserId || claim.sub !== user.id || claim.aal !== 'aal2' || !uuid.test(claim.session_id ?? '') || claim.role !== 'authenticated') fail('BROKER_AAL2_OWNER_REQUIRED', 403);
      const expires = Date.parse(data.expires);
      if (expires <= now() + 5000 || expires > now() + 8 * 3600000 || expires > claim.exp * 1000) fail('BROKER_INPUT_REJECTED');
      return supabase('/rest/v1/rpc/m1_open_admin_session', { secret: true, body: { p_user: user.id, p_auth_session: claim.session_id, p_hash: data.hash, p_ciphertext: data.ciphertext, p_expires: new Date(expires).toISOString() } });
    },
    async read(data) { exact(data, ['hash']); if (!hex64.test(data.hash)) fail('BROKER_INPUT_REJECTED'); return supabase('/rest/v1/rpc/m1_read_admin_session', { secret: true, body: { p_hash: data.hash } }); },
    async close(data) { exact(data, ['hash']); if (!hex64.test(data.hash)) fail('BROKER_INPUT_REJECTED'); return supabase('/rest/v1/rpc/m1_close_admin_session', { secret: true, body: { p_hash: data.hash } }); },
    async revoke(data) { exact(data, []); return supabase('/rest/v1/rpc/admin_online_revoke', { secret: true, body: {} }); },
  };
  async function handle(op, body, headers) {
    if (!Object.hasOwn(ops, op)) fail('BROKER_OP_REJECTED', 404);
    if (body.length > 65536) fail('BROKER_INPUT_REJECTED', 413);
    verify(op, body, headers);
    let data; try { data = JSON.parse(body); } catch { fail('BROKER_INPUT_REJECTED'); }
    return ops[op](data);
  }
  return { handle };
}

export async function startBroker(configPath = process.env.JUDOJU_BROKER_CONFIG ?? '/opt/judoju/.local-data/admin-broker/config.json') {
  const c = readBrokerConfig(configPath), broker = createBroker(c);
  if (existsSync(c.socketPath)) { const st = lstatSync(c.socketPath); if (!st.isSocket()) fail('BROKER_SOCKET_PATH_TAKEN', 503); unlinkSync(c.socketPath); }
  const server = createServer((req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (req.method !== 'POST') return send(405, { error: 'METHOD_REJECTED' });
    const chunks = []; let size = 0;
    req.on('data', b => { size += b.length; if (size > 65536) req.destroy(); else chunks.push(b); });
    req.on('end', async () => {
      try { send(200, { data: await broker.handle(String(req.url ?? '').replace(/^\//, ''), Buffer.concat(chunks).toString('utf8'), req.headers) ?? null }); }
      catch (e) { send(e instanceof BrokerError ? e.status : 500, { error: e instanceof BrokerError ? e.message : 'BROKER_FAILED' }); }
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(c.socketPath, resolve); });
  chmodSync(c.socketPath, 0o600);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  console.log(JSON.stringify({ component: 'ADMIN_SESSION_BROKER', socket: 'listening', secretPrinted: false }));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startBroker();
