import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const results = [];
for (const script of ['verify-foundation.mjs', 'verify-toolchain.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {encoding:'utf8', windowsHide:true});
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stderr || String(result.error));
    process.stdout.write(result.stdout || '');
    process.exit(result.status || 1);
  }
  results.push(JSON.parse(result.stdout));
}
console.log(JSON.stringify({status:'PASS', stage:1, results, limitations:'Tooling only. No app builds, database, worker or hosted CI tested.'}, null, 2));
