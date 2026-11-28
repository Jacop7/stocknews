-- CLOUD13 S2: real-data mode on in the cloud preview (docs/publish-stage2-plan.md S2), after apply.sql, in its own
-- transaction. Real AI drafts can then be received and reviewed by editors; the public read stays synthetic, because
-- the public-kind switch is local only and real publication is local only.
begin;
set local statement_timeout='30s';
do $guard$
begin
  if current_user<>'postgres' then raise exception 'REAL_MODE_POSTGRES_REQUIRED';end if;
  if (select to_jsonb(x)->>'environment' from judoju_control.environment_identity x limit 1) is distinct from 'dev'
    or (select to_jsonb(x)->>'project_ref' from judoju_control.environment_identity x limit 1) is distinct from 'nxfpfvsdwbziowkxsxnh' then raise exception 'REAL_MODE_ENVIRONMENT';end if;
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261128000108') then raise exception 'REAL_MODE_CLOUD13_REQUIRED';end if;
  if (select enabled or public_read_enabled from private.real_mode where id=1) then raise exception 'REAL_MODE_ALREADY_ON';end if;
end$guard$;
update private.real_mode set enabled=true, public_read_enabled=false,
  allowed_source_hosts=array['dart.fss.or.kr','kind.krx.co.kr'], official_source_hosts=array['dart.fss.or.kr','kind.krx.co.kr'],
  note='CLOUD13 S2: real AI drafts for editor review in the preview (public read synthetic)' where id=1;
do $post$
begin
  if not private.real_mode_on() then raise exception 'REAL_MODE_POST_OFF';end if;
  if private.public_read_kind()<>'SYNTHETIC' then raise exception 'REAL_MODE_POST_KIND';end if;
  if public.m1_public_identity() is distinct from '{"productId":"judoju-news","environment":"preview","sampleKind":"SYNTHETIC","bootstrapId":null,"contract":"M1"}'::jsonb then raise exception 'REAL_MODE_POST_IDENTITY';end if;
  -- The public-kind switch cannot be turned on here.
  begin
    update private.real_mode set public_read_enabled=true where id=1;
    raise exception 'REAL_MODE_POST_PUBLIC_SWITCH_OPEN';
  exception when raise_exception then
    if sqlerrm<>'REAL_PUBLIC_READ_LOCAL_ONLY_1B' then raise exception 'REAL_MODE_POST_PUBLIC_SWITCH %',sqlerrm;end if;
  end;
  if exists(select 1 from private.issues where sample_kind='PERMITTED_REAL' and publication_state<>'DRAFT') then raise exception 'REAL_MODE_POST_PUBLISHED_REAL';end if;
end$post$;
commit;
