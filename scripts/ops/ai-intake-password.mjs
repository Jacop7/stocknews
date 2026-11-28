// Publish stage 2A S4: sets the intake role password without the password ever leaving this process except to the
// server. A random 40-character password is generated here; the server receives the intake secret file over ssh stdin
// ($base/intake/db.json, owner-only); the SQL Editor receives only the PostgreSQL SCRAM-SHA-256 verifier (salted,
// 4096 iterations), which cannot be used to log in and, for a 40-character random password, cannot be reversed.
//   Usage: node scripts/ops/ai-intake-password.mjs SQL_OUT_FILE
// The password is never printed, logged, passed as an argument, put in an environment variable or written to disk here.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomInt, pbkdf2Sync, createHmac, createHash } from 'node:crypto';

const out = process.argv[2];
if (!out) throw new Error('SQL_OUT_FILE required');
const root = new URL('../../', import.meta.url);
const connection = JSON.parse(readFileSync(new URL('supabase/cloud/real-intake-dev/connection.json', root), 'utf8'));
if (!/^[a-z0-9.-]+\.supabase\.com$/.test(connection.host) || ![5432, 6543].includes(connection.port) || connection.database !== 'postgres'
  || !/^judoju_ai_intake\.[a-z0-9]{20}$/.test(connection.user)) throw new Error('connection.json is not the expected pooler setting');

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
let password = Array.from({ length: 40 }, () => chars[randomInt(chars.length)]).join('');

// PostgreSQL SCRAM-SHA-256 verifier: SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey> (RFC 5802/7677).
const salt = randomBytes(16), iterations = 4096;
const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
const clientKey = createHmac('sha256', salted).update('Client Key').digest();
const storedKey = createHash('sha256').update(clientKey).digest();
const serverKey = createHmac('sha256', salted).update('Server Key').digest();
const verifier = `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;

const keys = new URL('.local-data/collector-cloud/ssh-lightsail/', root);
const keyPath = decodeURIComponent(new URL('judoju-collector-ed25519', keys).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const knownHosts = decodeURIComponent(new URL('known_hosts_lightsail', keys).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const base = '/home/ubuntu/.local/share/judoju-ai';
const secret = JSON.stringify({ host: connection.host, port: connection.port, database: 'postgres', user: connection.user, password });
password = null;
const r = spawnSync('ssh', ['-i', keyPath, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlgorithms=ssh-ed25519', 'ubuntu@52.79.247.25',
  `set -e; umask 077; install -d -m 711 ${base}/intake; cat > ${base}/intake/db.json.tmp; chmod 600 ${base}/intake/db.json.tmp; mv ${base}/intake/db.json.tmp ${base}/intake/db.json; stat -c '%a %U %s' ${base}/intake/db.json`],
  { input: secret, encoding: 'utf8', windowsHide: true });
if (r.status !== 0) throw new Error('Sending the intake secret failed: ' + (r.stderr || '').slice(0, 200));
writeFileSync(out, `-- Intake role login with a SCRAM verifier (the password itself is only on the server).\nalter role judoju_ai_intake login password '${verifier}';\n`);
console.log(JSON.stringify({ serverSecret: r.stdout.trim(), sqlWritten: out, verifierPrefix: verifier.slice(0, 20) }));
