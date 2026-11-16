// Server only. Actual configuration is read only when an activated runtime calls it.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {AdminError} from './runtime-local.mjs';
export const previewProject='nxfpfvsdwbziowkxsxnh';
export const previewApi='https://'+previewProject+'.supabase.co';
export const editorFunctions=Object.freeze(['m1_check_editor','m1_editor_articles','m1_get_draft','m1_operation_status','m1_create_draft','m1_save_draft','catalog_save_draft','m1_preview_draft','m1_publish_draft','m1_set_state','catalog_editor_sectors','catalog_editor_index','catalog_editor_tree','catalog_editor_sector','catalog_editor_companies','catalog_editor_company','catalog_editor_group','catalog_editor_membership','catalog_editor_impact','catalog_apply','catalog_operation_status']);
export const serverFunctions=Object.freeze(['m1_open_admin_session','m1_read_admin_session','m1_close_admin_session']);
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=x=>createHash('sha256').update(x).digest('hex'),hex=/^[0-9a-f]{64}$/;
const actualConfigs=new WeakSet(),fixtureConfigs=new WeakSet();
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
    if(JSON.parse(regular(root,'package.json',32768)).name!=='@judoju/news')fail();
    const proofBytes=regular(root,'.local-data/cloud-admin/activation-proof.json',65536),p=JSON.parse(proofBytes);
    const c=JSON.parse(regular(root,'.local-data/cloud-admin/admin-server.json',16384));
    const expected=['schemaVersion','productId','environment','sampleKind','projectRef','apiUrl','origin','ownerUserId','publishableKey','secretKey','encryptionKey','proofSha256','fixture'].sort();
    if(Object.keys(c).sort().join('|')!==expected.join('|')||c.schemaVersion!==1||c.productId!=='judoju-news'||c.environment!=='preview'||c.sampleKind!=='SYNTHETIC'||c.projectRef!==previewProject||c.apiUrl!==previewApi||c.origin!=='http://127.0.0.1:62333'||c.fixture!==fixture||!uuid.test(c.ownerUserId??'')||!hex.test(c.encryptionKey??'')||c.proofSha256!==digest(proofBytes))fail();
    if(fixture?c.publishableKey!=='FIXTURE_PUBLISHABLE'||c.secretKey!=='FIXTURE_SECRET':!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publishableKey??'')||!/^sb_secret_[A-Za-z0-9_-]+$/.test(c.secretKey??''))fail();
    const approved=Date.parse(p.approvedAt),expires=Date.parse(p.expiresAt);
    if(p.schemaVersion!==1||p.stage!=='CLOUD11A'||p.state!=='ADMIN_CONNECTION_ACTIVATED'||p.productId!=='judoju-news'||p.projectRef!==previewProject||p.organizationRef!=='qfzgicohgpuogehdyzfx'||p.ownerUserId!==c.ownerUserId||p.fixture!==fixture||!hex.test(p.activationDecisionSha256??'')||!hex.test(p.implementationManifestSha256??'')||!hex.test(p.sqlSha256??'')||p.M2!==false||p.realPublicationEnabled!==false||p.workerEnabled!==false||!Number.isFinite(approved)||!Number.isFinite(expires)||approved>Date.now()||expires<=Date.now()||expires-approved>86400000||JSON.stringify(p.editorFunctions)!==JSON.stringify(editorFunctions)||JSON.stringify(p.serverFunctions)!==JSON.stringify(serverFunctions))fail();
    const result=Object.freeze({...c,expiresAt:p.expiresAt,activationDecisionSha256:p.activationDecisionSha256});
    (fixture?fixtureConfigs:actualConfigs).add(result);return result;
  }catch{fail();}
}
export function loadPreviewAdminConfig(){return read(productRoot(),false);}
// Trusted fixture loader only, not an authentication sandbox. Default network rejects its results.
export function loadPreviewAdminFixture(root){
  if(path.resolve(root)===path.resolve(productRoot()))fail();
  return read(root,true);
}
export function previewConfigKind(c){return actualConfigs.has(c)?'ACTUAL':fixtureConfigs.has(c)?'FIXTURE':null;}
