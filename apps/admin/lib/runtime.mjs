// Select explicitly; preview never falls back to local credentials or endpoints.
import * as local from './runtime-local.mjs';
import {previewRuntime} from './runtime-preview.mjs';
import {adminProfile} from './admin-profile.mjs';
export {AdminError,hash,seal,unseal} from './runtime-local.mjs';
const current=()=>adminProfile()==='preview'?previewRuntime:local;
export const config=(...a)=>current().config(...a);
export const serverRpc=(...a)=>current().serverRpc(...a);
export const editorRpc=(...a)=>current().editorRpc(...a);
export const assertFingerprint=(...a)=>current().assertFingerprint(...a);
export const login=(...a)=>current().login(...a);
export const session=(...a)=>current().session(...a);
export const logout=(...a)=>current().logout(...a);
export const assertWrite=(...a)=>current().assertWrite(...a);
