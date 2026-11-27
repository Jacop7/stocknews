// Select explicitly; preview and online never fall back to local credentials or endpoints.
import * as local from './runtime-local.mjs';
import {previewRuntime} from './runtime-preview.mjs';
import {onlineRuntime} from './runtime-online.mjs';
import {adminProfile} from './admin-profile.mjs';
import {AdminError} from './runtime-local.mjs';
export {AdminError,hash,seal,unseal} from './runtime-local.mjs';
const current=()=>{const p=adminProfile();return p==='online'?onlineRuntime:p==='preview'?previewRuntime:local;};
export const config=(...a)=>current().config(...a);
export const serverRpc=(...a)=>current().serverRpc(...a);
export const editorRpc=(...a)=>current().editorRpc(...a);
export const assertFingerprint=(...a)=>current().assertFingerprint(...a);
export const login=(...a)=>current().login(...a);
export const session=(...a)=>current().session(...a);
export const logout=(...a)=>current().logout(...a);
export const assertWrite=(...a)=>current().assertWrite(...a);
// Two-step login (password, then TOTP) exists only in the online profile.
const online=()=>{if(adminProfile()!=='online')throw new AdminError('ROUTE_NOT_FOUND',404);return onlineRuntime;};
export const mfaEnroll=(...a)=>online().mfaEnroll(...a);
export const mfaVerify=(...a)=>online().mfaVerify(...a);
