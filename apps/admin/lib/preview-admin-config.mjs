// Server only. Import/build never activate the dev administrator or read private configuration.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {nativeBoundary,nativeActualBoundary} from './preview-file-boundary.mjs';
import {validatePreviewActivationProof} from './preview-activation-proof.mjs';
import {actualOwner,actualCanonical,actualHash,checkActualApproval} from './preview-actual-lifecycle.mjs';
import {AdminError} from './runtime-local.mjs';
// Hoisted data-only getter: safe from either side of the config/lifecycle import cycle.
export function previewOwnerIdentity(){return Object.freeze({id:'e85049b7-7306-42ad-ac16-6c4bf5e82212',emailSha256:'7bd88947e82eccad28360716d82f516c01b90733dd82ba1fe3bce5ba50c36f8d',createdAt:'2026-11-17T19:44:19.125036+00:00'});}
export const previewProject='nxfpfvsdwbziowkxsxnh';
export const previewApi='https://'+previewProject+'.supabase.co';
export const editorFunctions=Object.freeze(['m1_check_editor','m1_editor_articles','m1_get_draft','m1_operation_status','m1_create_draft','m1_save_draft','catalog_save_draft','m1_preview_draft','m1_publish_draft','m1_set_state','catalog_editor_sectors','catalog_editor_index','catalog_editor_tree','catalog_editor_sector','catalog_editor_companies','catalog_editor_company','catalog_editor_group','catalog_editor_membership','catalog_editor_impact','catalog_apply','catalog_operation_status']);
export const serverFunctions=Object.freeze(['m1_open_admin_session','m1_read_admin_session','m1_close_admin_session']);
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=x=>createHash('sha256').update(x).digest('hex'),hex=/^[0-9a-f]{64}$/;
const actualConfigs=new WeakSet(),fixtureConfigs=new WeakSet();
const actualClocks=new WeakMap();let cachedActual=null;
// Bundled Next server modules do not retain the source module's on-disk location.
// Resolve the owned workspace only when loading, never while importing/building.
function productRoot(){
  try{const cwd=process.cwd(),name=JSON.parse(regular(cwd,'package.json',32768)).name;
    const root=name==='@judoju/news'?cwd:name==='@judoju/admin'?path.resolve(cwd,'../..'):null;
    if(!root||JSON.parse(regular(root,'package.json',32768)).name!=='@judoju/news')fail();return root;
  }catch{fail();}
}
const fail=()=>{throw new AdminError('PREVIEW_ADMIN_CONFIG_REJECTED',503);};
function regular(root,relative,max){
  const base=path.resolve(root),real=realpathSync(base);if(lstatSync(base).isSymbolicLink()||!lstatSync(base).isDirectory())fail();
  let current=base;const parts=relative.split('/');
  for(let n=0;n<parts.length;n++){
    current=path.join(current,parts[n]);const stat=lstatSync(current);
    if(stat.isSymbolicLink()||!(n===parts.length-1?stat.isFile():stat.isDirectory()))fail();
    const inside=path.relative(real,realpathSync(current));if(!inside||inside.startsWith('..')||path.isAbsolute(inside))fail();
    if(n===parts.length-1&&stat.size>max)fail();
  }
  const bytes=readFileSync(current);if(bytes.length>max)fail();return bytes;
}
function read(root,fixture){
  try{
    const nativeFiles=fixture&&process.platform==='win32'?nativeBoundary('ReadFixture',{root}).files:null;
    const readOwned=(relative,max)=>{
      const bytes=nativeFiles?Buffer.from(nativeFiles[relative],'base64'):regular(root,relative,max);
      if(bytes.length>max)fail();return bytes;
    };
    if(JSON.parse(readOwned('package.json',32768)).name!=='@judoju/news')fail();
    const proofBytes=readOwned('.local-data/cloud-admin/activation-proof.json',65536),p=JSON.parse(proofBytes);
    const c=JSON.parse(readOwned('.local-data/cloud-admin/admin-server.json',16384));
    const expected=['schemaVersion','productId','environment','sampleKind','projectRef','apiUrl','origin','ownerUserId','publishableKey','secretKey','encryptionKey','proofSha256','fixture'].sort();
    if(Object.keys(c).sort().join('|')!==expected.join('|')||c.schemaVersion!==1||c.productId!=='judoju-news'||c.environment!=='preview'||c.sampleKind!=='SYNTHETIC'||c.projectRef!==previewProject||c.apiUrl!==previewApi||c.origin!=='http://127.0.0.2:62333'||c.fixture!==fixture||!uuid.test(c.ownerUserId??'')||!hex.test(c.encryptionKey??'')||c.proofSha256!==digest(proofBytes))fail();
    if(fixture?c.publishableKey!=='FIXTURE_PUBLISHABLE'||c.secretKey!=='FIXTURE_SECRET':!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publishableKey??'')||!/^sb_secret_[A-Za-z0-9_-]+$/.test(c.secretKey??''))fail();
    const approved=Date.parse(p.approvedAt),expires=Date.parse(p.expiresAt);
    if(p.schemaVersion!==1||p.stage!=='CLOUD11A'||p.state!=='ADMIN_CONNECTION_ACTIVATED'||p.productId!=='judoju-news'||p.projectRef!==previewProject||p.organizationRef!=='qfzgicohgpuogehdyzfx'||p.ownerUserId!==c.ownerUserId||p.fixture!==fixture||!hex.test(p.activationDecisionSha256??'')||!hex.test(p.implementationManifestSha256??'')||!hex.test(p.sqlSha256??'')||p.M2!==false||p.realPublicationEnabled!==false||p.workerEnabled!==false||!Number.isFinite(approved)||!Number.isFinite(expires)||approved>Date.now()||expires<=Date.now()||expires-approved>86400000||JSON.stringify(p.editorFunctions)!==JSON.stringify(editorFunctions)||JSON.stringify(p.serverFunctions)!==JSON.stringify(serverFunctions))fail();
    const result=Object.freeze({...c,expiresAt:p.expiresAt,activationDecisionSha256:p.activationDecisionSha256});
    (fixture?fixtureConfigs:actualConfigs).add(result);return result;
  }catch{fail();}
}
export function actualConfigNow(c){
  const clock=actualClocks.get(c);if(!actualConfigs.has(c)||!clock)fail();
  const elapsed=performance.now()-clock.anchor;if(!Number.isFinite(elapsed)||elapsed<0)fail();
  const value=clock.authoritativeNow+Math.ceil(elapsed);if(value>=Date.parse(c.expiresAt))fail();return value;
}
export function loadPreviewAdminConfig(){
  if(cachedActual){actualConfigNow(cachedActual);return cachedActual;}
  try{
    const started=performance.now(),r=nativeActualBoundary('ReadActual',{}),received=performance.now();
    if(!Number.isSafeInteger(r.authoritativeNow)||!Number.isSafeInteger(r.remainingMs)||r.remainingMs<=0||r.remainingMs>1800000||received<started)fail();
    const names=['activation-expected.json','activation-proof.json','admin-server.json','decision.json','approval.json','rendered.sql','launch-consumed.json'];
    if(!r.files||Object.keys(r.files).sort().join('|')!==names.sort().join('|'))fail();
    const files=Object.fromEntries(names.map(name=>[name,Buffer.from(r.files[name],'base64')]));
    const launch=JSON.parse(files['launch-consumed.json']);
    if(launch.launchEffect!==r.launchEffect||launch.ownerUserId!==actualOwner.id
      ||launch.configSha256!==actualHash(files['admin-server.json'])||launch.proofSha256!==actualHash(files['activation-proof.json'])
      ||Date.parse(launch.expiresAt)!==r.authoritativeNow+r.remainingMs)fail();
    const expected=JSON.parse(files['activation-expected.json']),c=JSON.parse(files['admin-server.json']);
    const d=JSON.parse(files['decision.json']),approval=JSON.parse(files['approval.json']);
    const decisionKeys=['schemaVersion','productId','projectRef','organizationRef','ownerUserId','ownerEmailSha256','effectKey','expiresAt','implementationManifestSha256','publishableKeyId','secretKeyId','prestateSha256','observedAt','launchEffect','templateSha256','sqlPreimageSha256'];
    if(Object.keys(d).sort().join('|')!==decisionKeys.sort().join('|')||d.schemaVersion!==1||d.productId!=='judoju-news'||d.projectRef!==previewProject
      ||d.organizationRef!=='qfzgicohgpuogehdyzfx'||d.ownerUserId!==actualOwner.id||d.ownerEmailSha256!==actualOwner.emailSha256
      ||d.effectKey!==d.launchEffect||d.launchEffect!==r.launchEffect||!uuid.test(d.effectKey??''))fail();
    const decisionSha256=actualHash(actualCanonical(d)),sql=files['rendered.sql'].toString('utf8'),sqlSha256=actualHash(files['rendered.sql']);
    if(launch.decisionSha256!==decisionSha256)fail();
    const sentinel="'"+decisionSha256+"'";
    if(sql.split(sentinel).length!==2||actualHash(sql.replace(sentinel,"'"+'0'.repeat(64)+"'"))!==d.sqlPreimageSha256)fail();
    checkActualApproval(approval,{decision:d,decisionSha256,sqlSha256});
    if(expected.ownerUserId!==actualOwner.id||expected.fixture!==false||expected.activationDecisionSha256!==decisionSha256
      ||expected.implementationManifestSha256!==d.implementationManifestSha256||expected.sqlSha256!==sqlSha256)fail();
    const authoritativeNow=r.authoritativeNow+Math.ceil(received-started);
    const p=validatePreviewActivationProof(JSON.parse(files['activation-proof.json']),expected,authoritativeNow);
    if(p.expiresAt!==d.expiresAt)fail();
    const cKeys=['schemaVersion','productId','environment','sampleKind','projectRef','apiUrl','origin','ownerUserId','publishableKey','secretKey','encryptionKey','proofSha256','fixture'];
    if(Object.keys(c).sort().join('|')!==cKeys.sort().join('|')||c.schemaVersion!==1||c.productId!=='judoju-news'||c.environment!=='preview'||c.sampleKind!=='SYNTHETIC'
      ||c.projectRef!==previewProject||c.apiUrl!==previewApi||c.origin!=='http://127.0.0.2:62333'||c.ownerUserId!==actualOwner.id||c.fixture!==false
      ||c.proofSha256!==actualHash(files['activation-proof.json'])||!hex.test(c.encryptionKey??'')
      ||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publishableKey??'')||!/^sb_secret_[A-Za-z0-9_-]+$/.test(c.secretKey??''))fail();
    const end=r.authoritativeNow+r.remainingMs;if(authoritativeNow>=end||end>Date.parse(p.expiresAt))fail();
    const result=Object.freeze({...c,expiresAt:new Date(end).toISOString(),activationDecisionSha256:decisionSha256});
    actualConfigs.add(result);actualClocks.set(result,{authoritativeNow,anchor:received});cachedActual=result;return result;
  }catch{fail();}
}
// Trusted fixture loader only, not an authentication sandbox. Default network rejects its results.
export function loadPreviewAdminFixture(root){
  if(path.resolve(root)===path.resolve(productRoot()))fail();
  return read(root,true);
}
export function previewConfigKind(c){return actualConfigs.has(c)?'ACTUAL':fixtureConfigs.has(c)?'FIXTURE':null;}
