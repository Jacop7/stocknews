import assert from 'node:assert/strict';
import {lstatSync,realpathSync,readFileSync} from 'node:fs';
import path from 'node:path';

export const cloudInputPaths=Object.freeze(['docs/cloud/deployment-contract.json','docs/project-resource-manifest.json',
  'supabase/migrations/20261114000001_m0_foundation.sql','supabase/cloud/cloud03/guard.sql','supabase/cloud/cloud03/seal.sql',
  'supabase/cloud/cloud03/dev-domain-foundation.sql','supabase/cloud/cloud03/provenance.json']);

// Inspect every component before reading. Caller-supplied paths cannot select inputs.
export function checkedSourcePath(root,relative,fs={lstatSync,realpathSync}){
  assert.equal(typeof relative,'string');assert.ok(relative&&!path.isAbsolute(relative)&&!relative.includes('\\')&&
    relative.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Internal relative source path');
  const absoluteRoot=path.resolve(root),rootInfo=fs.lstatSync(absoluteRoot);
  assert.ok(rootInfo.isDirectory()&&!rootInfo.isSymbolicLink(),'Owned source root');
  const realRoot=fs.realpathSync(absoluteRoot);let current=absoluteRoot;
  const parts=relative.split('/');
  for(let n=0;n<parts.length;n++){
    current=path.join(current,parts[n]);const info=fs.lstatSync(current);
    assert.ok(!info.isSymbolicLink(),'No source link/junction '+relative);
    assert.ok(n===parts.length-1?info.isFile():info.isDirectory(),'Regular source file/directories '+relative);
    const real=fs.realpathSync(current),inside=path.relative(realRoot,real);
    assert.ok(inside&&!inside.startsWith('..')&&!path.isAbsolute(inside),'Internal source realpath '+relative);
  }
  return current;
}
export function readCloudInputs(root){
  // Check the complete set before reading even the first body.
  const checked=cloudInputPaths.map(p=>checkedSourcePath(root,p));
  return Object.fromEntries(cloudInputPaths.map((p,i)=>[p,readFileSync(checked[i])]));
}
