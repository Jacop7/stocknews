// Pure preparation helpers; no Supabase, credentials, HTTP, Docker or activation CLI.
import {createHash} from 'node:crypto';
const defaultOwnerEmailSha256='7bd88947e82eccad28360716d82f516c01b90733dd82ba1fe3bce5ba50c36f8d';
export const previewSqlOwnerEmailSha256=defaultOwnerEmailSha256;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,hex=/^[0-9a-f]{64}$/;
export function renderAdminPreviewSql(template,input){
  if(typeof template!=='string'||!input||!['decisionSha256,effectKey,expiresAt,implementationManifestSha256,ownerUserId','decisionSha256,effectKey,expiresAt,implementationManifestSha256,ownerEmailSha256,ownerUserId'].includes(Object.keys(input).sort().join(','))||Object.hasOwn(input,'ownerEmailSha256')&&!hex.test(input.ownerEmailSha256??'')||!uuid.test(input.ownerUserId??'')||!uuid.test(input.effectKey??'')||!hex.test(input.decisionSha256??'')||!hex.test(input.implementationManifestSha256??'')||typeof input.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expiresAt)||!Number.isFinite(Date.parse(input.expiresAt)))throw Error('ADMIN_PREVIEW_RENDER_INPUT');
  const values={OWNER_UUID:input.ownerUserId,OWNER_EMAIL_SHA:input.ownerEmailSha256??defaultOwnerEmailSha256,EFFECT_UUID:input.effectKey,EXPIRES_AT:input.expiresAt,DECISION_SHA:input.decisionSha256,IMPLEMENTATION_SHA:input.implementationManifestSha256,TEMPLATE_SHA:createHash('sha256').update(template).digest('hex')};
  const seen=new Set();const sql=template.replace(/__([A-Z_]+)__/g,(_,name)=>{if(!Object.hasOwn(values,name))throw Error('ADMIN_PREVIEW_RENDER_MARKER');seen.add(name);return values[name];});
  if(seen.size!==7||/__[A-Z_]+__/.test(sql))throw Error('ADMIN_PREVIEW_RENDER_MARKER');
  return Object.freeze({sql,templateSha256:values.TEMPLATE_SHA,renderedSqlSha256:createHash('sha256').update(sql).digest('hex')});
}
