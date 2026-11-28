// Writes the read-only inventory query (CLOUD13 S1) used both in the Supabase SQL Editor (cloud prestate) and on the
// local rehearsal database: the renderer's INVENTORY plus migrations, default privileges, schemas, roles, extensions,
// identity rows and types.  Usage: node scripts/tools/cloud13-inventory-query.mjs OUT.sql
import { writeFileSync } from 'node:fs';
import { INVENTORY } from '../cloud13-render.mjs';

export const EXTRA = `jsonb_build_object(
  'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  'default_acl',(select coalesce(jsonb_agg(defaclrole::regrole::text||'|'||coalesce(defaclnamespace::regnamespace::text,'*')||'|'||defaclobjtype::text||'|'||defaclacl::text order by 1),'[]') from pg_default_acl),
  'schemas',(select jsonb_agg(nspname||'|'||coalesce(nspacl::text,'') order by nspname) from pg_namespace where nspname in ('public','private','judoju_control','ai_intake','cron')),
  'roles',(select coalesce(jsonb_agg(rolname order by rolname),'[]') from pg_roles where rolname like 'judoju%'),
  'extensions',(select jsonb_agg(extname||'|'||extnamespace::regnamespace::text order by extname) from pg_extension),
  'runtime_identity',(select coalesce(jsonb_agg(to_jsonb(r)-'created_at'),'[]') from private.runtime_identity r),
  'control_identity',(select coalesce(jsonb_agg(r.x),'[]') from (select (xpath('/row/*/text()', x))::text[] x from unnest(xpath('/table/row', query_to_xml(
     case when to_regclass('judoju_control.environment_identity') is null then 'select 1 where false' else 'select * from judoju_control.environment_identity' end, false, false, ''))) x) r),
  'types',(select jsonb_object_agg(n.nspname||'.'||t.typname,coalesce((select string_agg(enumlabel,',' order by enumsortorder) from pg_enum e where e.enumtypid=t.oid),t.typtype::text))
     from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','private','judoju_control') and t.typtype in ('e','d'))
)`;
export const QUERY = `-- CLOUD13 read-only inventory (no writes)\nselect (${INVENTORY} || ${EXTRA})::text as inv;\n`;
if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/tools/cloud13-inventory-query.mjs') && process.argv[2]) writeFileSync(process.argv[2], QUERY);
