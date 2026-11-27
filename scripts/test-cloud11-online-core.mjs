// CLOUD11-online core hardening test on the local Supabase DB: one transaction, rolled back.
// Covers H1 capability binding, H2 aal2, H3 aal2 at session open and H6 emergency revoke.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const core = readFileSync(new URL('../supabase/cloud/admin-online-dev/core.sql', import.meta.url), 'utf8');
const U = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const S2 = '33333333-3333-4333-8333-333333333333', S1 = '44444444-4444-4444-8444-444444444444', SO = '55555555-5555-4555-8555-555555555555';
const cap = randomBytes(32).toString('base64url'), capHash = createHash('sha256').update(cap).digest('hex');
const otherCap = randomBytes(32).toString('base64url');
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const claims = (sub, session, aal, role = 'authenticated') => JSON.stringify({ role, sub, session_id: session, aal });
const headers = capability => JSON.stringify(capability === undefined ? {} : { 'x-judoju-capability': capability });
const probe = (name, c, h) => `select set_config('request.jwt.claims',${q(c)},true),set_config('request.headers',${q(h)},true);select 'R|${name}|'||private.is_admin();`;

const sql = `begin;
${core}
insert into auth.users(id,email,aud,role,raw_app_meta_data) values (${q(U)},'owner@example.invalid','authenticated','authenticated','{"app_role":"admin"}'),(${q(OTHER)},'other@example.invalid','authenticated','authenticated','{"app_role":"admin"}');
insert into auth.sessions(id,user_id,aal) values (${q(S2)},${q(U)},'aal2'),(${q(S1)},${q(U)},'aal1'),(${q(SO)},${q(OTHER)},'aal2');
insert into private.admin_memberships(user_id,active) values (${q(U)},true),(${q(OTHER)},true);
insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) values
 (${q(capHash)},${q(U)},${q(S2)},repeat('x',40),now()+interval '1 hour'),
 (${q(createHash('sha256').update(otherCap).digest('hex'))},${q(U)},${q(S1)},repeat('y',40),now()+interval '1 hour');
${probe('ok', claims(U, S2, 'aal2'), headers(cap))}
${probe('no_capability', claims(U, S2, 'aal2'), headers())}
${probe('wrong_capability', claims(U, S2, 'aal2'), headers(randomBytes(32).toString('base64url')))}
${probe('capability_of_other_session', claims(U, S2, 'aal2'), headers(otherCap))}
${probe('aal1_claim', claims(U, S2, 'aal1'), headers(cap))}
${probe('aal2_claim_on_aal1_session', claims(U, S1, 'aal2'), headers(otherCap))}
${probe('other_user', claims(OTHER, SO, 'aal2'), headers(cap))}
${probe('anon_role', claims(U, S2, 'aal2', 'anon'), headers(cap))}
${probe('malformed_headers', claims(U, S2, 'aal2'), 'not json')}
update private.admin_sessions set revoked_at=now() where capability_hash=${q(capHash)};
${probe('revoked_session', claims(U, S2, 'aal2'), headers(cap))}
update private.admin_sessions set revoked_at=null,expires_at=now()-interval '1 second' where capability_hash=${q(capHash)};
${probe('expired_session', claims(U, S2, 'aal2'), headers(cap))}
update private.admin_sessions set expires_at=now()+interval '1 hour' where capability_hash=${q(capHash)};
update private.admin_memberships set active=false where user_id=${q(U)};
${probe('inactive_membership', claims(U, S2, 'aal2'), headers(cap))}
update private.admin_memberships set active=true where user_id=${q(U)};
-- H3: open needs an aal2 Auth session; caller must be the server role.
select set_config('request.jwt.claims',${q(JSON.stringify({ role: 'service_role' }))},true);
do $$ begin perform public.m1_open_admin_session(${q(U)}::uuid,${q(S1)}::uuid,${q('a'.repeat(64))},repeat('z',40),now()+interval '1 hour'); raise notice 'R|open_aal1|opened';
 exception when others then raise notice 'R|open_aal1|%',sqlerrm; end $$;
do $$ begin perform public.m1_open_admin_session(${q(U)}::uuid,${q(S2)}::uuid,${q('b'.repeat(64))},repeat('z',40),now()+interval '1 hour'); raise notice 'R|open_aal2|opened';
 exception when others then raise notice 'R|open_aal2|%',sqlerrm; end $$;
select set_config('request.jwt.claims',${q(JSON.stringify({ role: 'authenticated', sub: U, session_id: S2, aal: 'aal2' }))},true);
do $$ begin perform public.admin_online_revoke(); raise notice 'R|revoke_as_user|ran';
 exception when others then raise notice 'R|revoke_as_user|%',sqlerrm; end $$;
-- H6: grant, then revoke as the server role.
grant execute on function public.m1_check_editor(),public.m1_save_draft(uuid,bigint,jsonb) to authenticated;
grant execute on function public.m1_open_admin_session(uuid,uuid,text,text,timestamptz) to service_role;
select set_config('request.jwt.claims',${q(JSON.stringify({ role: 'service_role' }))},true);
select 'R|revoke|'||(public.admin_online_revoke()->>'revoked');
select 'R|after_revoke_grants|'||(has_function_privilege('authenticated','public.m1_check_editor()','EXECUTE') or has_function_privilege('authenticated','public.m1_save_draft(uuid,bigint,jsonb)','EXECUTE')
  or has_function_privilege('service_role','public.m1_open_admin_session(uuid,uuid,text,text,timestamptz)','EXECUTE'));
select 'R|after_revoke_members|'||(select count(*) from private.admin_memberships where active);
select 'R|after_revoke_sessions|'||(select count(*) from private.admin_sessions where revoked_at is null);
select 'R|revoke_fn_acl|'||has_function_privilege('anon','public.admin_online_revoke()','EXECUTE')||','||has_function_privilege('authenticated','public.admin_online_revoke()','EXECUTE')||','||has_function_privilege('service_role','public.admin_online_revoke()','EXECUTE');
rollback;`;
const run = spawnSync(docker, ['exec', '-i', 'supabase_db_judoju-news-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', windowsHide: true });
assert.equal(run.status, 0, run.stderr);
const lines = (run.stdout + run.stderr).split(/\r?\n/).map(line => line.replace(/^NOTICE:\s*/, '')).filter(line => line.startsWith('R|')).map(line => line.split('|').slice(1));
const value = key => lines.filter(([k]) => k === key).map(([, v]) => v);
assert.deepEqual(value('ok'), ['true']);
for (const name of ['no_capability', 'wrong_capability', 'capability_of_other_session', 'aal1_claim', 'aal2_claim_on_aal1_session', 'other_user', 'anon_role', 'malformed_headers', 'revoked_session', 'expired_session', 'inactive_membership'])
  assert.deepEqual(value(name), ['false'], name);
assert.deepEqual(value('open_aal1'), ['ADMIN_SESSION_AAL2_REQUIRED']); assert.deepEqual(value('open_aal2'), ['opened']);
assert.deepEqual(value('revoke_as_user'), ['SERVER_ONLY']);
assert.deepEqual(value('revoke'), ['true']); assert.deepEqual(value('after_revoke_grants'), ['false']);
assert.deepEqual(value('after_revoke_members'), ['0']); assert.deepEqual(value('after_revoke_sessions'), ['0']);
assert.deepEqual(value('revoke_fn_acl'), ['false,false,true']);
console.log(JSON.stringify({ status: 'PASS', phase: 'CLOUD11_ONLINE_CORE', rolledBack: true, checks: lines.length }));
