import { readFileSync } from 'node:fs';
import { collectHtmlList } from './html-list.mjs';
import { probe } from './probe.mjs';

const [id, mode, action, ...remaining] = process.argv.slice(2);
const htmlMode = mode === '--html-list';
if (!/^E[a-f0-9]{16}$/.test(id) || (mode !== undefined && !htmlMode) ||
    (action !== undefined && (!htmlMode || action !== '--execute')) || remaining.length) {
  throw new Error('Usage: node scripts/providers/cli.mjs ENDPOINT_ID [--html-list [--execute]]');
}

const root = new URL('../../data/providers/', import.meta.url);
const { endpoints } = JSON.parse(readFileSync(new URL('routes.json', root), 'utf8'));
const { profiles } = JSON.parse(readFileSync(new URL('permission-profiles.json', root), 'utf8'));
const endpoint = endpoints.find(entry => entry.endpoint_id === id);
if (!endpoint) throw new Error('Unknown endpoint');

const profile = profiles.find(entry => entry.id === endpoint.permission_profile_id);
const result = htmlMode
  ? await collectHtmlList({ endpoint, profile, execute: action === '--execute' })
  : await probe({ endpoint, profile });
console.log(JSON.stringify(result, null, 2));
