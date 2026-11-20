import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, rmSync} from 'node:fs';
import path from 'node:path';
import {validatePreviewActivationProof} from '../apps/admin/lib/preview-activation-proof.mjs';
import {editorFunctions, serverFunctions, loadPreviewAdminConfig, loadPreviewAdminFixture} from '../apps/admin/lib/preview-admin-config.mjs';
import {createPreviewFixtureRoot, assertFixtureRoot, writeOwnedPreviewFixture} from '../apps/admin/lib/preview-file-boundary.mjs';

const now = Date.parse('2026-11-18T00:00:00.000Z');
const owner = '10000000-0000-4000-8000-000000000001';
const expected = {
  ownerUserId: owner, fixture: true, activationDecisionSha256: 'a'.repeat(64),
  implementationManifestSha256: 'b'.repeat(64), sqlSha256: 'c'.repeat(64),
};
function proof(at = now) {
  return {
    schemaVersion: 1, stage: 'CLOUD11A', state: 'ADMIN_CONNECTION_ACTIVATED',
    productId: 'judoju-news', projectRef: 'nxfpfvsdwbziowkxsxnh',
    organizationRef: 'qfzgicohgpuogehdyzfx', ownerUserId: owner, fixture: true,
    approvedAt: new Date(at - 1000).toISOString(), expiresAt: new Date(at + 3600000).toISOString(),
    activationDecisionSha256: expected.activationDecisionSha256,
    implementationManifestSha256: expected.implementationManifestSha256, sqlSha256: expected.sqlSha256,
    M2: false, realPublicationEnabled: false, workerEnabled: false,
    editorFunctions: [...editorFunctions], serverFunctions: [...serverFunctions],
  };
}
const rejected = work => assert.throws(work, /^Error: PREVIEW_ACTIVATION_PROOF_REJECTED$/);

test('proof validation binds the selected owner, hashes, project and exact RPC roles without activation', () => {
  for (const fixture of [true, false]) {
    const input = {...proof(), fixture};
    const result = validatePreviewActivationProof(input, {...expected, fixture}, now);
    assert.deepEqual(result, input);
    assert(Object.isFrozen(result));
    assert(Object.isFrozen(result.editorFunctions));
    input.editorFunctions.reverse();
    assert.deepEqual(result.editorFunctions, editorFunctions);
  }
  assert.throws(loadPreviewAdminConfig, /PREVIEW_ADMIN_CONFIG_REJECTED/);
});

test('proof timestamps use the injected clock including exact expiry and the 24-hour boundary', () => {
  const input = proof();
  input.approvedAt = new Date(now).toISOString();
  input.expiresAt = new Date(now + 86400000).toISOString();
  validatePreviewActivationProof(input, expected, now);
  rejected(() => validatePreviewActivationProof(input, expected, now + 86400000));
  for (const patch of [
    {approvedAt: new Date(now + 1).toISOString()},
    {expiresAt: new Date(now).toISOString()},
    {expiresAt: new Date(now - 1).toISOString()},
    {expiresAt: new Date(now + 86400001).toISOString()},
    {approvedAt: '2026-02-30T00:00:00Z'},
    {approvedAt: 'yesterday'},
  ]) rejected(() => validatePreviewActivationProof({...input, ...patch}, expected, now));
  for (const clock of [NaN, Infinity, -1, now + 0.5, String(now), 8640000000000001]) {
    rejected(() => validatePreviewActivationProof(input, expected, clock));
  }
});

test('each fixed scope, activation flag, expected owner and digest must match', () => {
  for (const patch of [
    {schemaVersion: 2}, {stage: 'CLOUD11C2'}, {state: 'READY'}, {productId: 'other'},
    {projectRef: 'other'}, {organizationRef: 'other'}, {ownerUserId: owner.replace('001', '002')},
    {fixture: false}, {M2: true}, {realPublicationEnabled: true}, {workerEnabled: true},
    {sqlSha256: 'd'.repeat(64)}, {implementationManifestSha256: 'd'.repeat(64)},
    {activationDecisionSha256: 'd'.repeat(64)}, {secretKey: 'UNEXPECTED_FIELD'},
  ]) rejected(() => validatePreviewActivationProof({...proof(), ...patch}, expected, now));
  for (const key of Object.keys(proof())) {
    const missing = proof();
    delete missing[key];
    rejected(() => validatePreviewActivationProof(missing, expected, now));
    rejected(() => validatePreviewActivationProof({...proof(), [key]: null}, expected, now));
  }
  for (const key of Object.keys(expected)) {
    const missing = {...expected};
    delete missing[key];
    rejected(() => validatePreviewActivationProof(proof(), missing, now));
  }
});

test('RPC membership, order and role split are exact', () => {
  for (const patch of [
    {editorFunctions: editorFunctions.slice(1)},
    {editorFunctions: [...editorFunctions, editorFunctions[0]]},
    {editorFunctions: [...editorFunctions].reverse()},
    {editorFunctions: [...editorFunctions.slice(0, -1), serverFunctions[0]]},
    {serverFunctions: [...serverFunctions].reverse()},
    {serverFunctions: 'm1_open_admin_session'},
  ]) rejected(() => validatePreviewActivationProof({...proof(), ...patch}, expected, now));
});

test('getters, proxies, inherited fields, hidden fields and sparse arrays cannot supply a proof', () => {
  let reads = 0;
  const getter = Object.defineProperty(proof(), 'ownerUserId', {enumerable: true, get() { reads++; return owner; }});
  const proxy = new Proxy(proof(), {getPrototypeOf() { reads++; return Object.prototype; }});
  const hidden = Object.defineProperty(proof(), 'hidden', {value: true});
  const inherited = Object.assign(Object.create({extra: true}), proof());
  const sparse = proof();
  delete sparse.editorFunctions[0];
  const cyclic = proof();
  cyclic.editorFunctions[0] = cyclic;
  for (const input of [getter, proxy, hidden, inherited, sparse, cyclic]) {
    rejected(() => validatePreviewActivationProof(input, expected, now));
  }
  rejected(() => validatePreviewActivationProof(proof(), new Proxy(expected, {}), now));
  assert.equal(reads, 0);
});

test('shared proof conditions agree with the existing fixture loader on the same bytes', {skip: process.platform !== 'win32'}, t => {
  const at = Date.now();
  const cases = [
    p => p,
    p => ({...p, stage: 'other'}),
    p => ({...p, M2: true}),
    p => ({...p, approvedAt: new Date(at + 60000).toISOString()}),
    p => ({...p, expiresAt: new Date(at - 60000).toISOString()}),
    p => ({...p, expiresAt: new Date(at + 90000000).toISOString()}),
    p => ({...p, editorFunctions: [...p.editorFunctions].reverse()}),
    p => ({...p, serverFunctions: [...p.serverFunctions].reverse()}),
  ];
  for (const mutate of cases) {
    const handle = createPreviewFixtureRoot();
    t.after(() => {
      assertFixtureRoot(handle);
      assert.equal(path.basename(path.dirname(handle.path)), 'JudojuNewsAdminC1B');
      assert.match(path.basename(handle.path), /^fixture-[0-9a-f]{32}$/);
      assert.equal(lstatSync(handle.path).isSymbolicLink(), false);
      rmSync(handle.path, {recursive: true});
    });
    const input = mutate(proof(at));
    const bytes = Buffer.from(JSON.stringify(input));
    const config = {
      schemaVersion: 1, productId: 'judoju-news', environment: 'preview', sampleKind: 'SYNTHETIC',
      projectRef: 'nxfpfvsdwbziowkxsxnh', apiUrl: 'https://nxfpfvsdwbziowkxsxnh.supabase.co',
      origin: 'http://127.0.0.2:62333', ownerUserId: owner,
      publishableKey: 'FIXTURE_PUBLISHABLE', secretKey: 'FIXTURE_SECRET', encryptionKey: 'd'.repeat(64),
      proofSha256: createHash('sha256').update(bytes).digest('hex'), fixture: true,
    };
    writeOwnedPreviewFixture(handle, {
      proof: bytes.toString('base64'), config: Buffer.from(JSON.stringify(config)).toString('base64'),
    });
    let currentAccepted = false;
    let nextAccepted = false;
    try { loadPreviewAdminFixture(handle.path); currentAccepted = true; } catch {}
    try { validatePreviewActivationProof(input, expected, at); nextAccepted = true; } catch {}
    assert.equal(nextAccepted, currentAccepted);
  }
});
