// ADMIN_PREVIEW_WRITER_C1B. Only synthetic fixture output; ACTUAL is unconditionally closed.
import {createHash} from 'node:crypto';
import {readdirSync} from 'node:fs';
import {assertFixtureRoot,writeOwnedPreviewFixture,boundaryHold,nativeActualJournal} from './preview-file-boundary.mjs';
import {previewApi,previewProject,editorFunctions,serverFunctions,uuid} from './preview-admin-config.mjs';
import {actualOwner,actualCanonical,actualHash,appendLoginJournal,makeLoginJournalEntry,validateLoginJournal} from './preview-actual-lifecycle.mjs';
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
// Called only after the native ACTUAL loader accepted the current live Job and server-clock lease.
export async function appendActualRuntimeJournal({phase,generation=null,authSessionId=null,capabilityHash=null},signal){
  const r=await nativeActualJournal('ReadActualJournal',{},signal);
  if(!Array.isArray(r.frames)||r.frames.length>512)boundaryHold('ACTUAL_JOURNAL');
  const old=validateLoginJournal(r.frames.map(f=>{const b=Buffer.from(f.bytes,'base64');if(actualHash(b)!==f.sha256)boundaryHold('ACTUAL_JOURNAL_HASH');return makeLoginJournalEntry(JSON.parse(b));}));
  const n=phase==='BEFORE_AUTH'?old.reduce((value,x)=>Math.max(value,x.generation),0)+1:generation;
  const entry={generation:n,phase,ownerUserId:actualOwner.id,authSessionId,capabilityHash};
  const next=appendLoginJournal(old,entry);
  if(next.length===old.length)return n;
  await nativeActualJournal('AppendActualJournal',{generation:next.length,previousSha256:r.frames.at(-1)?.sha256??'0'.repeat(64),bytes:Buffer.from(actualCanonical(entry)).toString('base64')},signal);return n;
}
export async function actualJournalGeneration(capabilityHash,authSessionId,signal){
  const r=await nativeActualJournal('ReadActualJournal',{},signal);if(!Array.isArray(r.frames)||r.frames.length>512)boundaryHold('ACTUAL_JOURNAL');
  const matches=validateLoginJournal(r.frames.map(f=>{const b=Buffer.from(f.bytes,'base64');if(actualHash(b)!==f.sha256)boundaryHold('ACTUAL_JOURNAL_HASH');return makeLoginJournalEntry(JSON.parse(b));}))
    .filter(x=>x.capabilityHash===capabilityHash&&x.authSessionId===authSessionId);
  if(!matches.length||matches.some(x=>x.generation!==matches[0].generation))boundaryHold('ACTUAL_JOURNAL_OWNER');return matches[0].generation;
}
