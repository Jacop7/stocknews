import assert from 'node:assert/strict';
import {lstatSync,realpathSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {checkedSourcePath} from './cloud-source-files.mjs';
import {historyInputPaths} from './cloud-history-files.mjs';
export const coreInputPaths=Object.freeze([...historyInputPaths,'supabase/cloud/core-dev/adoption.json','supabase/cloud/core-dev/migrations/20261115000101_cloud05a_core_disabled.sql']);
export function checkedCoreSource(root,relative,fs={lstatSync,realpathSync}){
 assert.ok(typeof relative==='string'&&coreInputPaths.includes(relative)&&!/^([A-Za-z]:|\\|\/)/.test(relative)&&!relative.split('/').some(p=>p==='..'||p==='.'||!p||p.startsWith('.env')||['.local-data','cloud-auth','cli-home','access-token','keyring','secrets'].includes(p)),'Fixed noncredential core source');
 return checkedSourcePath(root,relative,fs);
}
export function readCoreInputs(root,fs={lstatSync,realpathSync,readFileSync,readdirSync}){
 const checked=coreInputPaths.map(p=>checkedCoreSource(root,p,fs));
 const old=path.join(root,'supabase/cloud/dev'),current=path.join(root,'supabase/cloud/core-dev');
 assert.deepEqual(fs.readdirSync(old).sort(),['adoption.json','config.toml','migrations'],'Historical archive directory');
 assert.deepEqual(fs.readdirSync(path.join(old,'migrations')).sort(),historyInputPaths.slice(1,3).map(p=>path.basename(p)).sort(),'Exactly two historical migrations');
 assert.deepEqual(fs.readdirSync(current).sort(),['adoption.json','migrations'],'Core archive directory');
 assert.deepEqual(fs.readdirSync(path.join(current,'migrations')).sort(),['20261115000101_cloud05a_core_disabled.sql'],'Exactly one prepared core source');
 return Object.fromEntries(coreInputPaths.map((p,i)=>[p,fs.readFileSync(checked[i])]));
}
