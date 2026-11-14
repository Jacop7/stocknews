import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { probe } from './probe.mjs';
const argv=process.argv.slice(2),root=new URL('../../',import.meta.url);
if(argv.length!==1||!/^E[a-f0-9]{16}$/.test(argv[0]))throw new Error('Usage: node scripts/providers/cli.mjs ENDPOINT_ID (dry-run only)');
const endpoints=JSON.parse(readFileSync(new URL('data/providers/routes.json',root),'utf8')).endpoints;
const profiles=JSON.parse(readFileSync(new URL('data/providers/permission-profiles.json',root),'utf8')).profiles;
const endpoint=endpoints.find(x=>x.endpoint_id===argv[0]);if(!endpoint)throw new Error('Unknown endpoint');
console.log(JSON.stringify(await probe({endpoint,profile:profiles.find(x=>x.id===endpoint.permission_profile_id)}),null,2));
