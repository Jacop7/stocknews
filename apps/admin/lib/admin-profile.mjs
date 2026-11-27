// Non-secret deployment selection. Import/build does not read private files.
import {AdminError} from './runtime-local.mjs';
export const previewOrigin='http://127.0.0.2:62333';
// CLOUD11-online: public HTTPS admin behind Caddy on the AWS worker (free sslip.io name).
export const onlineHost='admin.52-79-247-25.sslip.io',onlineOrigin='https://'+onlineHost;
export function adminProfile(){
  const value=process.env.JUDOJU_ADMIN_PROFILE;
  if(value===undefined||value==='local')return 'local';
  if(value==='preview')return 'preview';
  if(value==='online')return 'online';
  throw new AdminError('ADMIN_PROFILE_REJECTED',503);
}
// __Host- cookies require Secure, Path=/ and no Domain: bound to the exact HTTPS host.
export function adminCookie(){const p=adminProfile();return p==='online'?'__Host-judoju_admin':p==='preview'?'judoju_admin_preview_session':'judoju_admin_session';}
export function adminPendingCookie(){return '__Host-judoju_admin_mfa';}
export function adminCookieSecure(){return adminProfile()==='online';}
export function assertAdminRequest(headers,feature='editor'){
  const p=adminProfile();
  if(headers.get('host')!==(p==='online'?onlineHost:p==='preview'?'127.0.0.2:62333':'127.0.0.1:3100'))throw new AdminError('HOST_REJECTED',403);
  if(p!=='local'&&!['editor','catalog'].includes(feature))throw new AdminError('PREVIEW_FEATURE_NOT_CONNECTED',503);
}
