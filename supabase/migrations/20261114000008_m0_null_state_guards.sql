-- Extend the review NULL-input audit to uncertainty and source-version state transitions.
begin;
create or replace function public.m0_fail(p_job uuid,p_token uuid,p_uncertain boolean,p_error_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;next_state private.job_state;
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_uncertain is null then raise exception 'UNCERTAINTY_REQUIRED';end if;
  if p_error_code is null or length(p_error_code) not between 1 and 100 then raise exception 'ERROR_CODE_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'LEASED' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then raise exception 'STALE_LEASE' using errcode='40001';end if;
  next_state:=case when p_uncertain then 'WAIT_CONFIRMATION'::private.job_state when j.attempts>=j.max_attempts then 'DLQ'::private.job_state else 'QUEUED'::private.job_state end;
  update private.jobs set state=next_state,available_at=clock_timestamp()+least(60,power(2,j.attempts)) * interval '1 second',lease_token=null,lease_until=null,last_error_code=p_error_code where id=j.id;
  update private.job_attempts set ended_at=clock_timestamp(),result=next_state::text,effect_state=case when p_uncertain then 'UNCERTAIN' else 'NOT_SENT_CONFIRMED' end where job_id=j.id and lease_token=p_token;
  return jsonb_build_object('state',next_state,'effect_key',j.effect_key);
end$$;
create or replace function public.m0_source_technical_result(p_endpoint text,p_permission_version text,p_adapter_version text,p_checks jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.endpoints;source private.sources;permission private.permission_profiles;k text;
begin
  perform private.assert_server();perform private.assert_initialized();
  select * into strict e from private.endpoints where id=p_endpoint for update;
  select * into strict source from private.sources where id=e.source_id;
  if source.sample_kind<>'SYNTHETIC' then raise exception 'REAL_SOURCE_TRANSITIONS_NOT_ENABLED_STAGE_4';end if;
  if e.status<>'TECH_TEST' or e.permission_version is distinct from p_permission_version or p_adapter_version is null or e.adapter_id is null or e.adapter_version is distinct from p_adapter_version or not exists(select 1 from private.adapters where id=e.adapter_id and version=e.adapter_version and verification_state='PASSED') then raise exception 'TECH_TEST_VERSION_CONFLICT';end if;
  select * into strict permission from private.permission_profiles where id=e.permission_profile_id and version=e.permission_version;
  if permission.status<>'VERIFIED' or permission.verified_at is null or permission.verified_at>clock_timestamp() or jsonb_array_length(permission.evidence)=0 or permission.expires_at is null or permission.expires_at<=clock_timestamp() or permission.revoked_at is not null or permission.purposes->>'MACHINE_ACCESS' is distinct from 'ALLOW' or permission.purposes->>'DISCOVERY' is distinct from 'ALLOW' then raise exception 'PERMISSION_NOT_VERIFIED';end if;
  foreach k in array array['listing','detail','id','time','pagination','failure_handling'] loop
    if p_checks->k is distinct from 'true'::jsonb then raise exception 'TECH_CHECK_INCOMPLETE';end if;
  end loop;
  update private.endpoints set status='SHADOW',health_state='SHADOW_TESTING',episode_id=gen_random_uuid(),fast_retry_count=0,reprobe_count=0,low_frequency_since=null where id=e.id;
  return jsonb_build_object('state','SHADOW','action','TECH_TEST_VERIFIED_ENTER_SHADOW','live_enabled',false);
end$$;

commit;
