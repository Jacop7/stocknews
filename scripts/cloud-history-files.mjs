import assert from 'node:assert/strict';
import {lstatSync,realpathSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {checkedSourcePath} from './cloud-source-files.mjs';
export const historyInputPaths=Object.freeze(['supabase/cloud/dev/config.toml','supabase/cloud/dev/migrations/20261114000000_cloud02_dev_control.sql','supabase/cloud/dev/migrations/20261114000001_cloud03_dev_domain_foundation.sql','supabase/cloud/dev/adoption.json','supabase/migrations/20261114000001_m0_foundation.sql','supabase/cloud/cloud03/dev-domain-foundation.sql','supabase/cloud/cloud03/provenance.json']);
export function readHistoryInputs(root,fs={lstatSync,realpathSync,readFileSync,readdirSync}){
 // Validate every path and the exact archive directory shape before reading a body.
 const checked=historyInputPaths.map(p=>checkedSourcePath(root,p,fs));
 const directory=path.dirname(checked[0]);
 assert.deepEqual(fs.readdirSync(directory).sort(),['adoption.json','config.toml','migrations'],'Exact archive directory');
 assert.deepEqual(fs.readdirSync(path.join(directory,'migrations')).sort(),historyInputPaths.slice(1,3).map(p=>path.basename(p)).sort(),'Exactly two cloud migrations');
 return Object.fromEntries(historyInputPaths.map((p,i)=>[p,fs.readFileSync(checked[i])]));
}
