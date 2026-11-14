import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { localClient } from './m0-test-client.mjs';
import { identity,writePrivate,root } from './local-runtime.mjs';
const {sql,quote:q}=localClient(),id=identity(),applied=[];
for(const name of readdirSync(path.join(root,'supabase/migrations')).sort()){
  assert.match(name,/^\d{14}_[a-z0-9_]+\.sql$/);
  const text=readFileSync(path.join(root,'supabase/migrations',name),'utf8'),sha=createHash('sha256').update(text).digest('hex'),version=name.split('_')[0];
  const existing=sql('select version from supabase_migrations.schema_migrations where version='+q(version)+';');
  if(existing){assert.equal(id.migrationDigests[name],sha,'Applied migration digest mismatch');continue;}
  assert.ok(!id.migrationDigests[name],'Recorded migration missing in actual history');
  const body=text.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
  assert.ok(!/^\s*(begin|commit);/m.test(body),'One guarded migration transaction only');
  sql('begin;\n'+body+'\ninsert into supabase_migrations.schema_migrations(version,name) values ('+q(version)+','+q(name.slice(15,-4))+');\ncommit;');
  id.migrationDigests[name]=sha;writePrivate('identity.json',id);applied.push(version);
}
console.log(JSON.stringify({phase:'OWNED_LOCAL_MIGRATIONS',applied,remote:false}));
