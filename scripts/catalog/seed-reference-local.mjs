// Separate approved 6B local-only registration. The 6A preview CLI remains non-importable.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {localClient} from '../m0-test-client.mjs';
import {root,writePrivate,docker,projectId} from '../local-runtime.mjs';
import {parseCatalog,cellHash} from './parse-catalog.mjs';
assert.equal(process.argv.length,2,'No input override or target flags allowed');
const status=JSON.parse(readFileSync(path.join(root,'docs/development-status.json'),'utf8'));
assert.equal(status.catalogConnection?.planManifest,'c1026d481625755c43cbabdd6cd92b6cfbb62e2f53a4231ba2873235ae8c6636');
assert.equal(status.catalogConnection.realPublicationEnabled,false);
function owned(relative){const name=path.join(root,relative);assert.equal(realpathSync(name),name);return readFileSync(name,'utf8');}
const source=owned('tests/fixtures/catalog/source-20261114.json'),registry=owned('tests/fixtures/catalog/registry-v1.json');
assert.equal(cellHash(source),'5c86278ab12d16979a1f5fd7a100e15368db2450f1ebcf47e70aced66d84a5d2');
assert.equal(cellHash(registry),'160a969756bfd291c81dda390a3490f46ac60bc12eed262e1818e5ba40a03dc6');
const preview=JSON.stringify(parseCatalog(JSON.parse(source),JSON.parse(registry),{sourceSha256:cellHash(source)}),null,2)+'\n';
assert.equal(cellHash(preview),'10151662655abf5fd5ba1c09c30e8b91b07ab1549afbb4257c978544d92edb0d');
const f=localClient(),response=docker(['exec','-i','supabase_db_'+projectId,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{input:'select private.catalog_seed_reference('+[source,registry,preview].map(f.quote).join(',')+');'});
if(response.code!==0){
 // Report only the error headline, never raw SQL input or full source rows.
 const headline=String(response.stderr).split(/\r?\n/).find(x=>x.startsWith('ERROR:'))??'LOCAL_SQL_FAILURE';
 throw new Error('CATALOG_REGISTRATION_REJECTED: '+headline.slice(0,350));
}
const answer=JSON.parse(response.stdout.trim());
assert.ok(['APPLIED','ALREADY_APPLIED'].includes(answer.status));
writePrivate('catalog-initial-registration.json',{...answer,sourceSha256:cellHash(source),registrySha256:cellHash(registry),previewSha256:cellHash(preview),observedAt:new Date().toISOString(),remote:false});
console.log(JSON.stringify({...answer,remote:false,sourceSheetWrites:0,stockIdentitiesVerified:0}));
