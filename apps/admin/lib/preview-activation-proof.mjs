// Pure C2 proof validation. Calling this function does not activate the preview.
import {types} from 'node:util';
import {previewProject, editorFunctions, serverFunctions, uuid} from './preview-admin-config.mjs';

const proofKeys = [
  'schemaVersion', 'stage', 'state', 'productId', 'projectRef', 'organizationRef',
  'ownerUserId', 'fixture', 'approvedAt', 'expiresAt', 'activationDecisionSha256',
  'implementationManifestSha256', 'sqlSha256', 'M2', 'realPublicationEnabled',
  'workerEnabled', 'editorFunctions', 'serverFunctions',
];
const expectedKeys = [
  'ownerUserId', 'fixture', 'activationDecisionSha256',
  'implementationManifestSha256', 'sqlSha256',
];
const hashPattern = /^[a-f0-9]{64}$/;

function reject() {
  throw new Error('PREVIEW_ACTIVATION_PROOF_REJECTED');
}

function copyData(value, parents = new Set(), depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.length <= 4096) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) || depth > 4 || parents.has(value)) reject();
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (array ? prototype !== Array.prototype || value.length > 24 || keys.length !== value.length + 1
    : prototype !== Object.prototype && prototype !== null || keys.length > 24) reject();
  parents.add(value);
  const output = array ? [] : {};
  const names = array ? Array.from({length: value.length}, (_, index) => String(index)) : keys;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (typeof name !== 'string' || !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) reject();
    Object.defineProperty(output, name, {
      value: copyData(descriptor.value, parents, depth + 1),
      enumerable: true, writable: true, configurable: true,
    });
  }
  parents.delete(value);
  return output;
}

function exact(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) reject();
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) reject();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) reject();
  return parsed;
}

/** Expected hashes and owner come from the trusted reviewed activation candidate. */
export function validatePreviewActivationProof(rawProof, rawExpected, now) {
  const proof = copyData(rawProof);
  const expected = copyData(rawExpected);
  exact(proof, proofKeys);
  exact(expected, expectedKeys);
  if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000) reject();
  if (!uuid.test(expected.ownerUserId ?? '') || typeof expected.fixture !== 'boolean') reject();
  for (const key of ['activationDecisionSha256', 'implementationManifestSha256', 'sqlSha256']) {
    if (typeof expected[key] !== 'string' || !hashPattern.test(expected[key]) || proof[key] !== expected[key]) reject();
  }
  if (proof.schemaVersion !== 1 || proof.stage !== 'CLOUD11A'
    || proof.state !== 'ADMIN_CONNECTION_ACTIVATED' || proof.productId !== 'judoju-news'
    || proof.projectRef !== previewProject || proof.organizationRef !== 'qfzgicohgpuogehdyzfx'
    || proof.ownerUserId !== expected.ownerUserId || proof.fixture !== expected.fixture
    || proof.M2 !== false || proof.realPublicationEnabled !== false || proof.workerEnabled !== false) reject();
  if (!Array.isArray(proof.editorFunctions) || !Array.isArray(proof.serverFunctions)
    || JSON.stringify(proof.editorFunctions) !== JSON.stringify(editorFunctions)
    || JSON.stringify(proof.serverFunctions) !== JSON.stringify(serverFunctions)) reject();
  const approvedAt = timestamp(proof.approvedAt);
  const expiresAt = timestamp(proof.expiresAt);
  if (approvedAt > now || expiresAt <= now || expiresAt <= approvedAt || expiresAt - approvedAt > 86400000) reject();
  Object.freeze(proof.editorFunctions);
  Object.freeze(proof.serverFunctions);
  return Object.freeze(proof);
}
