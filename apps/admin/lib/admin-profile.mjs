// Non-secret deployment selection. Import/build does not read private files.
import {AdminError} from './runtime-local.mjs';
export const previewOrigin='http://127.0.0.2:62333';
export function adminProfile(){
  const value=process.env.JUDOJU_ADMIN_PROFILE;
  if(value===undefined||value==='local')return 'local';
  if(value==='preview')return 'preview';
  throw new AdminError('ADMIN_PROFILE_REJECTED',503);
}
export function adminCookie(){return adminProfile()==='preview'?'judoju_admin_preview_session':'judoju_admin_session';}
export function assertAdminRequest(headers,feature='editor'){
  const preview=adminProfile()==='preview';
  if(headers.get('host')!==(preview?'127.0.0.2:62333':'127.0.0.1:3100'))throw new AdminError('HOST_REJECTED',403);
  if(preview&&!['editor','catalog'].includes(feature))throw new AdminError('PREVIEW_FEATURE_NOT_CONNECTED',503);
}
