// Renders supabase/cloud/real-intake-dev/apply.sql (CLOUD13, publish stage 2A S1): local migrations 56-62 for the cloud
// preview project, in one transaction, rendered for the cloud:
//   - the public identity function stays the cloud's (preview/SYNTHETIC/M1): 59's local identity replacement is left out;
//   - real mode may be switched on in local or preview environments; the public-kind switch stays local only, and real
//     publication stays local only (REAL_PUBLICATION_LOCAL_ONLY), so the cloud public read is synthetic;
//   - the sector selection function keeps the cloud definition and gains the PERMITTED_REAL branch;
//   - the adoption function is created without any API grant (S7 grants it to editors in a separate transaction).
// Guard: environment, identity, migration list and the complete observed definition and ACL inventory of the product
// schemas (prestate.json, read-only queries in the SQL Editor). Post-check: the complete inventory equals the rehearsal
// result (the same bundle applied to a local copy of the cloud state, scripts/cloud13-rehearse.mjs). Any mismatch rolls
// the whole transaction back.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const dir = 'supabase/cloud/real-intake-dev/';
export const loadState = () => JSON.parse(readFileSync(new URL(dir + 'prestate.json', root), 'utf8'));
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const json = value => q(JSON.stringify(value)) + '::jsonb';
export const SOURCES = ['20261127000056_real_mode_review', '20261127000057_ai_draft_inbox', '20261127000058_draft_company_labels', '20261127000059_real_public_read',
  '20261127000060_real_withdraw_evidence_version', '20261127000061_real_removal_cause', '20261127000062_ai_version_adoption'].map(n => `supabase/migrations/${n}.sql`);

// Each substitution must match exactly once in its file.
export function substitutions(cloud) {
  const localOnly = "exists(select 1 from private.runtime_identity where environment='local')";
  const localOrPreview = "exists(select 1 from private.runtime_identity where environment in ('local','preview'))";
  return {
    'supabase/migrations/20261127000056_real_mode_review.sql': [
      [`  if new.enabled and not ${localOnly} then raise exception 'REAL_MODE_LOCAL_ONLY_1A';end if;`,
        `  if new.enabled and not ${localOrPreview} then raise exception 'REAL_MODE_LOCAL_OR_PREVIEW';end if;`],
      [`     and ${localOnly}\n$$;`, `     and ${localOrPreview}\n$$;`],
      [cloud.localSectorSelectable, cloud.cloudSectorSelectable],
    ],
    'supabase/migrations/20261127000059_real_public_read.sql': [
      [`  if new.enabled and not ${localOnly} then raise exception 'REAL_MODE_LOCAL_ONLY_1A';end if;`,
        `  if new.enabled and not ${localOrPreview} then raise exception 'REAL_MODE_LOCAL_OR_PREVIEW';end if;`],
      [`-- The public identity says which kind is public, so a reader for one kind refuses to serve the other.
create or replace function public.m1_public_identity() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('productId',product_id,'environment',environment,
    'sampleKind',case when private.public_read_kind()='PERMITTED_REAL' then 'REVIEW_REAL' else 'SYNTHETIC' end,'bootstrapId',bootstrap_id,
    'contract',case when private.public_read_kind()='PERMITTED_REAL' then 'M1R' else 'M1' end)
  from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null
$$;
`, `-- CLOUD13: the cloud public identity stays preview/SYNTHETIC/M1 (the public-kind switch is local only).\n`],
      ...(cloud.extra59 ?? []),
    ],
    'supabase/migrations/20261127000062_ai_version_adoption.sql': [
      [`revoke all on function public.m1_adopt_ai_version(uuid,integer,bigint,text) from public, anon, service_role;
grant execute on function public.m1_adopt_ai_version(uuid,integer,bigint,text) to authenticated;`,
        `-- CLOUD13: no API grant; S7 grants it to editors together with the updated emergency revoke.
revoke all on function public.m1_adopt_ai_version(uuid,integer,bigint,text) from public, anon, authenticated, service_role;`],
    ],
  };
}

export function renderBodies(cloud) {
  const subs = substitutions(cloud);
  return SOURCES.map(path => {
    let text = readFileSync(new URL(path, root), 'utf8');
    if (text.includes('\r')) throw new Error('CRLF in ' + path);
    for (const [from, to] of subs[path] ?? []) {
      const n = text.split(from).length - 1;
      if (n !== 1) throw new Error(`Substitution matched ${n} times in ${path}: ${from.slice(0, 80)}`);
      text = text.replace(from, () => to);
    }
    const lines = text.replace(/\n+$/, '').split('\n');
    if (lines[0] !== 'begin;' || lines.at(-1) !== 'commit;') throw new Error('Unexpected framing in ' + path);
    const sql = lines.slice(1, -1).join('\n');
    if (/\b(begin|commit|rollback)\s*;/i.test(sql.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, ''))) throw new Error('Nested transaction control in ' + path);
    return { path, sql };
  });
}

// The inventory compared before and after: definition hash and ACL of every product function, column, constraint and
// trigger hashes of every product table.
export const INVENTORY = `jsonb_build_object(
  'functions',(select jsonb_object_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
     jsonb_build_array(encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),coalesce(p.proacl::text,'DEFAULT')))
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','judoju_control') and p.prokind in ('f','p')),
  'columns',(select jsonb_object_agg(k,h) from (select table_schema||'.'||table_name k,md5(string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''),',' order by ordinal_position)) h
     from information_schema.columns where table_schema in ('public','private','judoju_control') group by 1) c),
  'relations',(select jsonb_object_agg(c.relnamespace::regnamespace::text||'.'||c.relname,c.relkind::text||'|'||c.relrowsecurity::text||'|'||coalesce(c.relacl::text,'DEFAULT'))
     from pg_class c where c.relnamespace::regnamespace::text in ('public','private','judoju_control') and c.relkind in ('r','p','v','m','S')),
  'constraints',(select jsonb_object_agg(conrelid::regclass::text||'.'||conname,md5(pg_get_constraintdef(oid))) from pg_constraint where connamespace::regnamespace::text in ('public','private','judoju_control')),
  'triggers',(select coalesce(jsonb_object_agg(c.relnamespace::regnamespace::text||'.'||c.relname||'.'||tg.tgname,md5(pg_get_triggerdef(tg.oid))),'{}')
     from pg_trigger tg join pg_class c on c.oid=tg.tgrelid where not tg.tgisinternal and c.relnamespace::regnamespace::text in ('public','private','judoju_control')),
  'policies',(select coalesce(jsonb_object_agg(schemaname||'.'||tablename||'.'||policyname,md5(row(permissive,roles,cmd,qual,with_check)::text)),'{}') from pg_policies where schemaname in ('public','private','judoju_control'))
)`;

export function render(state = loadState()) {
  const bodies = renderBodies(state.cloud);
  const recorded = bodies.map(b => b.sql);
  const recordedMd5 = createHash('md5').update(recorded.join('\u0001'), 'utf8').digest('hex');
  return `-- CLOUD13 real-data intake schema for ${state.projectRef} (generated by scripts/cloud13-render.mjs; do not edit by hand).
begin;
set local statement_timeout='120s';
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtext('judoju-cloud-schema-change'));
lock table supabase_migrations.schema_migrations in exclusive mode;
do $guard$
declare got jsonb;k text;
begin
  if current_user<>'postgres' then raise exception 'CLOUD13_POSTGRES_REQUIRED';end if;
  if (select count(*) from judoju_control.environment_identity)<>1
    or (select to_jsonb(x)->>'environment' from judoju_control.environment_identity x) is distinct from 'dev'
    or (select to_jsonb(x)->>'project_ref' from judoju_control.environment_identity x) is distinct from ${q(state.projectRef)} then raise exception 'CLOUD13_ENVIRONMENT';end if;
  if public.m1_public_identity() is distinct from '{"productId":"judoju-news","environment":"preview","sampleKind":"SYNTHETIC","bootstrapId":null,"contract":"M1"}'::jsonb then raise exception 'CLOUD13_IDENTITY';end if;
  if (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations) is distinct from ${json(state.migrations)} then raise exception 'CLOUD13_MIGRATIONS';end if;
  got:=${INVENTORY};
  for k in select jsonb_object_keys(${json(state.before)}) loop
    if got->k is distinct from ${json(state.before)}->k then raise exception 'CLOUD13_DRIFT %',k;end if;
  end loop;
end$guard$;

${bodies.map(({ path, sql }) => `-- ${path}\n${sql}`).join('\n\n')}

insert into supabase_migrations.schema_migrations(version,name,statements) values (${q(state.record.version)},${q(state.record.name)},array[${recorded.map(q).join(',')}]);

do $post$
declare got jsonb;k text;
begin
  got:=${INVENTORY};
  for k in select jsonb_object_keys(${json(state.after)}) loop
    if got->k is distinct from ${json(state.after)}->k then raise exception 'CLOUD13_POST_% %',upper(k),(select jsonb_agg(x) from (select key x from jsonb_each(got->k) where value is distinct from ${json(state.after)}->k->key
      union select key from jsonb_each(${json(state.after)}->k) where not (got->k ? key)) z);end if;
  end loop;
  if public.m1_public_identity() is distinct from '{"productId":"judoju-news","environment":"preview","sampleKind":"SYNTHETIC","bootstrapId":null,"contract":"M1"}'::jsonb then raise exception 'CLOUD13_POST_IDENTITY';end if;
  if (select to_jsonb(r)-'changed_at' from private.real_mode r) is distinct from ${json(state.realModeAfter)} then raise exception 'CLOUD13_POST_REAL_MODE';end if;
  if private.real_mode_on() or private.public_read_kind()<>'SYNTHETIC' then raise exception 'CLOUD13_POST_KIND';end if;
  if (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations) is distinct from ${json([...state.migrations, state.record.version])} then raise exception 'CLOUD13_POST_MIGRATIONS';end if;
  if (select count(*) from supabase_migrations.schema_migrations where version=${q(state.record.version)} and name=${q(state.record.name)}
      and cardinality(statements)=${recorded.length} and md5(array_to_string(statements,chr(1)))=${q(recordedMd5)})<>1 then raise exception 'CLOUD13_POST_RECORD';end if;
end$post$;
notify pgrst,'reload schema';
commit;
`;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/cloud13-render.mjs')) {
  const sql = render();
  writeFileSync(new URL(dir + 'apply.sql', root), sql);
  console.log(JSON.stringify({ written: dir + 'apply.sql', sha256: createHash('sha256').update(sql).digest('hex'), bytes: Buffer.byteLength(sql) }));
}
