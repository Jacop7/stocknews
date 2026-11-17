// ADMIN_PREVIEW_WRITER_C1B. Only synthetic fixture output; ACTUAL is unconditionally closed.
import {createHash} from 'node:crypto';
import {readdirSync} from 'node:fs';
import {assertFixtureRoot,writeOwnedPreviewFixture,boundaryHold} from './preview-file-boundary.mjs';
import {previewApi,previewProject,editorFunctions,serverFunctions,uuid} from './preview-admin-config.mjs';
function plain(value,seen=new Set(),depth=0){
  if(value===null||['string','number','boolean'].includes(typeof value))return;
  if(typeof value!=='object'||depth>8||seen.has(value)||!(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype))boundaryHold('FIXTURE_DATA');
  seen.add(value);for(const d of Object.values(Object.getOwnPropertyDescriptors(value))){if(!Object.hasOwn(d,'value'))boundaryHold('FIXTURE_GETTER');plain(d.value,seen,depth+1);}seen.delete(value);
}
export function writePreviewFixture({mode,root,proof,secretSource}){
  if(mode!=='FIXTURE')boundaryHold('NOT_ACTIVATED');
  const base=assertFixtureRoot(root);
  const entries=readdirSync(base);if(entries.length!==1||entries[0]!=='fixture-owner.json')boundaryHold('FIXTURE_NOT_EMPTY');
  plain(proof);const p=structuredClone(proof),now=Date.now(),approved=Date.parse(p?.approvedAt),expires=Date.parse(p?.expiresAt),hex=/^[0-9a-f]{64}$/;
  const keys=['schemaVersion','stage','state','productId','projectRef','organizationRef','ownerUserId','fixture','approvedAt','expiresAt','activationDecisionSha256','implementationManifestSha256','sqlSha256','M2','realPublicationEnabled','workerEnabled','editorFunctions','serverFunctions'].sort();
  if(!p||Object.keys(p).sort().join('|')!==keys.join('|')||p.schemaVersion!==1||p.stage!=='CLOUD11A'||p.state!=='ADMIN_CONNECTION_ACTIVATED'||p.productId!=='judoju-news'||p.projectRef!==previewProject||p.organizationRef!=='qfzgicohgpuogehdyzfx'||!uuid.test(p.ownerUserId??'')||p.fixture!==true||p.M2!==false||p.realPublicationEnabled!==false||p.workerEnabled!==false||!Number.isFinite(approved)||!Number.isFinite(expires)||approved>now||expires<=now||expires-approved>86400000||!['activationDecisionSha256','implementationManifestSha256','sqlSha256'].every(k=>hex.test(p[k]??''))||JSON.stringify(p.editorFunctions)!==JSON.stringify(editorFunctions)||JSON.stringify(p.serverFunctions)!==JSON.stringify(serverFunctions))boundaryHold('FIXTURE_PROOF');
  const secret=secretSource();
  plain(secret);
  if(!secret||Object.keys(secret).sort().join('|')!=='encryptionKey|publishableKey|secretKey'||secret.publishableKey!=='FIXTURE_PUBLISHABLE'||secret.secretKey!=='FIXTURE_SECRET'||secret.encryptionKey!=='d'.repeat(64))boundaryHold('FIXTURE_SECRET');
  const proofBytes=Buffer.from(JSON.stringify(p)),c={schemaVersion:1,productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',projectRef:previewProject,apiUrl:previewApi,origin:'http://127.0.0.2:62333',ownerUserId:p.ownerUserId,...secret,proofSha256:createHash('sha256').update(proofBytes).digest('hex'),fixture:true};
  return writeOwnedPreviewFixture(root,{proof:proofBytes.toString('base64'),config:Buffer.from(JSON.stringify(c)).toString('base64')});
}
