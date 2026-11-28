// CLOUD13 S1: turns the read-only cloud observation (SQL Editor result) into the two committed inputs of the rehearsal.
//   cloud-observed.json: the complete cloud inventory (functions with definition hash and ACL, columns, relations,
//     constraints, triggers, policies, types) = the local rehearsal inventory at migration 55 with the observed cloud
//     differences applied, plus migrations, identity rows, schemas and default privileges as observed;
//   cloud-defs.json: what makes the rehearsal database equal to the cloud: the cloud control schema and its rows, the
//     cloud jobs environment check, default privileges, the cloud definitions of functions that differ or exist only
//     in the cloud, and the local-only fixture functions to drop.
// Usage: node scripts/tools/cloud13-observed.mjs OBSERVED.json REHEARSAL55.json REST.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [,, observedFile, rehearsalFile, restFile] = process.argv;
const obs = JSON.parse(readFileSync(observedFile, 'utf8')), r55 = JSON.parse(readFileSync(rehearsalFile, 'utf8')), rest = JSON.parse(readFileSync(restFile, 'utf8'));
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex');
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const dir = new URL('../../supabase/cloud/real-intake-dev/', import.meta.url);

const inv = { functions: { ...r55.functions }, columns: { ...r55.columns }, relations: { ...r55.relations }, triggers: r55.triggers, policies: r55.policies, types: r55.types };
for (const [k, v] of Object.entries(obs.cloud)) { const i = k.indexOf('::'); inv[k.slice(0, i)][k.slice(i + 2)] = v; }
for (const k of rest.localOnlyFunctions) { if (!(k in inv.functions)) throw new Error('not in rehearsal: ' + k); delete inv.functions[k]; }
inv.constraints = Object.fromEntries(Object.entries(obs.cloud_constraints).map(([k, v]) => [k, md5(v)]));
const observed = { ...inv, migrations: rest.migrations, default_acl: rest.default_acl, schemas: rest.schemas, extensions: rest.extensions,
  runtime_identity: rest.runtime_identity, control_identity: rest.control_identity, roles: rest.roles };

// Functions whose cloud definition differs from the rehearsal at 55, or that exist only in the cloud.
const functions = {};
for (const [k, v] of Object.entries(obs.cloud)) {
  if (!k.startsWith('functions::')) continue;
  const key = k.slice(11);
  if (r55.functions[key]?.[0] === v[0]) continue;
  if (!obs.defs[key]) throw new Error('definition missing: ' + key);
  functions[key] = obs.defs[key];
}
const table = (name, t) => `create table judoju_control.${name}(${t.columns.map(([c, type, nn, def]) => `${c} ${type}${nn ? ' not null' : ''}${def ? ' default ' + def : ''}`).join(', ')}${t.constraints.map(([n, d]) => `, constraint ${n} ${d}`).join('')});
alter table judoju_control.${name} ${t.rls ? 'enable' : 'disable'} row level security;`;
const row = (name, x) => `insert into judoju_control.${name}(${Object.keys(x).join(',')}) values (${Object.values(x).map(v => v === null ? 'null' : q(v)).join(',')});`;
const preamble = [
  'create schema judoju_control authorization postgres;',
  ...Object.entries(obs.control_tables).sort().map(([n, t]) => table(n, t)),
  ...obs.control_rows.map(x => row('environment_identity', x)),
  ...(obs.artifacts ?? []).map(x => row('schema_artifacts', x)),
  'update private.runtime_identity set environment=' + q(rest.runtime_identity[0].environment) + ';',
  'alter table private.jobs drop constraint jobs_environment_check;',
  'alter table private.jobs add constraint jobs_environment_check ' + obs.cloud_constraints['private.jobs.jobs_environment_check'] + ';',
  // Default privileges as observed for functions, tables and sequences created by postgres (the cloud has no global
  // entry, so PUBLIC keeps its built-in EXECUTE on new functions).
  'alter default privileges for role postgres grant execute on functions to public;',
  'alter default privileges for role postgres in schema public grant execute on functions to service_role;',
  'alter default privileges for role postgres in schema public grant all on tables to service_role;',
  'alter default privileges for role postgres in schema public grant all on sequences to service_role;',
].join('\n');
writeFileSync(new URL('cloud-observed.json', dir), JSON.stringify(observed, null, 1) + '\n');
writeFileSync(new URL('cloud-defs.json', dir), JSON.stringify({ preamble, drop: rest.localOnlyFunctions.map(k => k.replace(/\((.*)\)$/, (m, a) => '(' + a.split(', ').filter(Boolean).map(x => x.replace(/^p_[a-z_]+ /, '')).join(',') + ')')), functions }, null, 1) + '\n');
console.log(JSON.stringify({ functions: Object.keys(inv.functions).length, redefined: Object.keys(functions).length, constraints: Object.keys(inv.constraints).length, columns: Object.keys(inv.columns).length }));
