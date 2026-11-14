begin;
create extension if not exists pg_cron;
create function public.m0_enqueue(p_effect_key text,p_payload jsonb default '{}'::jsonb,p_environment text default 'local',p_schema_version integer default 1,p_kind text default 'MOCK_EFFECT') returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_environment<>'local' or p_schema_version<>1 or p_kind<>'MOCK_EFFECT' then raise exception 'UNSUPPORTED_JOB_CONTRACT';end if;
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_JOB';end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('fixture_run_id','mode','work_ms','heartbeat')) then raise exception 'UNSUPPORTED_JOB_PAYLOAD';end if;
  insert into private.jobs(environment,job_schema_version,kind,effect_key,payload) values(p_environment,p_schema_version,p_kind,p_effect_key,p_payload) on conflict(effect_key) do nothing;
  select * into strict j from private.jobs where effect_key=p_effect_key;
  if j.payload<>p_payload or j.environment<>p_environment or j.kind<>p_kind or j.job_schema_version<>p_schema_version then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
  return jsonb_build_object('id',j.id,'effect_key',j.effect_key,'state',j.state);
end$$;
create function public.m0_claim(p_owner text,p_lease_seconds integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;token uuid:=gen_random_uuid();
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_owner is null or length(p_owner) not between 1 and 80 or p_lease_seconds not between 1 and 120 then raise exception 'INVALID_LEASE';end if;
  select * into j from private.jobs where available_at<=clock_timestamp() and (state='QUEUED' or state='LEASED' and lease_until<=clock_timestamp()) order by available_at,created_at for update skip locked limit 1;
  if not found then return null;end if;
  if j.state='LEASED' then update private.job_attempts set ended_at=clock_timestamp(),result='LEASE_EXPIRED' where job_id=j.id and lease_token=j.lease_token and ended_at is null;end if;
  if j.state='LEASED' and exists(select 1 from private.job_attempts where job_id=j.id and lease_token=j.lease_token and effect_state in ('DISPATCH_INTENT','UNCERTAIN')) then
    update private.jobs set state='WAIT_CONFIRMATION',lease_token=null,lease_until=null,last_error_code='LEASE_EXPIRED_UNCERTAIN' where id=j.id;return null;
  end if;
  if j.attempts>=j.max_attempts then update private.jobs set state='DLQ',lease_token=null,lease_until=null,last_error_code='MAX_ATTEMPTS' where id=j.id;return null;end if;
  update private.jobs set state='LEASED',lease_token=token,lease_owner=p_owner,lease_until=clock_timestamp()+p_lease_seconds*interval '1 second',attempts=attempts+1 where id=j.id returning * into j;
  insert into private.job_attempts(job_id,lease_token,attempt) values(j.id,token,j.attempts);
  return jsonb_build_object('id',j.id,'environment',j.environment,'job_schema_version',j.job_schema_version,'kind',j.kind,'effect_key',j.effect_key,'payload',j.payload,'lease_token',token,'lease_until',j.lease_until,'attempt',j.attempts);
end$$;
create function public.m0_mark_effect_intent(p_job uuid,p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_server();perform private.assert_initialized();
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'LEASED' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then return false;end if;
  update private.job_attempts set effect_state='DISPATCH_INTENT' where job_id=j.id and lease_token=p_token and effect_state='NOT_STARTED';
  return found;
end$$;
create function public.m0_pending_confirmation() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin perform private.assert_server();perform private.assert_initialized();
  select * into j from private.jobs where state='WAIT_CONFIRMATION' order by created_at limit 1;
  if not found then return null;end if;return jsonb_build_object('id',j.id,'effect_key',j.effect_key,'payload',j.payload);
end$$;
create function public.m0_heartbeat(p_job uuid,p_token uuid,p_lease_seconds integer default 10) returns boolean language plpgsql security definer set search_path='' as $$
declare updated integer;
begin
  perform private.assert_server();perform private.assert_initialized();if p_lease_seconds not between 1 and 120 then raise exception 'INVALID_LEASE';end if;
  update private.jobs set lease_until=clock_timestamp()+p_lease_seconds*interval '1 second' where id=p_job and state='LEASED' and lease_token=p_token and lease_until>clock_timestamp();get diagnostics updated=row_count;return updated=1;
end$$;
create function public.m0_ack(p_job uuid,p_token uuid,p_receipt text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;previous text;
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_receipt is null or length(p_receipt) not between 1 and 300 then raise exception 'RECEIPT_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state='SUCCEEDED' and j.lease_token=p_token and exists(select 1 from private.effect_receipts where effect_key=j.effect_key and external_receipt=p_receipt) then return jsonb_build_object('status','ALREADY_APPLIED');end if;
  if j.state<>'LEASED' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then raise exception 'STALE_LEASE' using errcode='40001';end if;
  select external_receipt into previous from private.effect_receipts where effect_key=j.effect_key;
  if previous is not null and previous<>p_receipt then raise exception 'RECEIPT_CONFLICT';end if;
  insert into private.effect_receipts(effect_key,external_receipt) values(j.effect_key,p_receipt) on conflict(effect_key) do nothing;
  update private.jobs set state='SUCCEEDED',completed_at=clock_timestamp(),lease_until=null where id=j.id;
  update private.job_attempts set ended_at=clock_timestamp(),result='SUCCEEDED',effect_state='ACCEPTED' where job_id=j.id and lease_token=p_token;
  return jsonb_build_object('status','APPLIED');
end$$;
create function public.m0_fail(p_job uuid,p_token uuid,p_uncertain boolean,p_error_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;next_state private.job_state;
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_error_code is null or length(p_error_code) not between 1 and 100 then raise exception 'ERROR_CODE_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'LEASED' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then raise exception 'STALE_LEASE' using errcode='40001';end if;
  next_state:=case when p_uncertain then 'WAIT_CONFIRMATION'::private.job_state when j.attempts>=j.max_attempts then 'DLQ'::private.job_state else 'QUEUED'::private.job_state end;
  update private.jobs set state=next_state,available_at=clock_timestamp()+least(60,power(2,j.attempts)) * interval '1 second',lease_token=null,lease_until=null,last_error_code=p_error_code where id=j.id;
  update private.job_attempts set ended_at=clock_timestamp(),result=next_state::text,effect_state=case when p_uncertain then 'UNCERTAIN' else 'NOT_SENT_CONFIRMED' end where job_id=j.id and lease_token=p_token;
  return jsonb_build_object('state',next_state,'effect_key',j.effect_key);
end$$;
create function public.m0_reconcile(p_job uuid,p_outcome text,p_proof text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_editor();perform private.assert_initialized();
  if p_outcome not in ('ACCEPTED','CONFIRMED_NOT_SENT') or p_proof is null or length(p_proof) not between 1 and 300 then raise exception 'TERMINAL_PROVIDER_PROOF_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'WAIT_CONFIRMATION' then raise exception 'NOT_AWAITING_CONFIRMATION';end if;
  if p_outcome='ACCEPTED' then
    insert into private.effect_receipts(effect_key,external_receipt) values(j.effect_key,p_proof) on conflict(effect_key) do nothing;
    update private.jobs set state='SUCCEEDED',completed_at=clock_timestamp() where id=j.id;
    update private.job_attempts set effect_state='ACCEPTED' where job_id=j.id and effect_state in ('DISPATCH_INTENT','UNCERTAIN');
  else
    if exists(select 1 from private.effect_receipts where effect_key=j.effect_key) then raise exception 'EFFECT_ALREADY_ACCEPTED';end if;
    update private.job_attempts set effect_state='NOT_SENT_CONFIRMED' where job_id=j.id and effect_state in ('DISPATCH_INTENT','UNCERTAIN');
    update private.jobs set state=case when attempts>=max_attempts then 'DLQ'::private.job_state else 'QUEUED'::private.job_state end,available_at=clock_timestamp() where id=j.id;
  end if;
  insert into private.audits(actor_id,action,entity_id,details) values(private.caller_role(),'RECONCILE',j.id::text,jsonb_build_object('outcome',p_outcome,'proof',p_proof,'original_effect_key',j.effect_key));
  return jsonb_build_object('effect_key',j.effect_key,'outcome',p_outcome);
end$$;
create function public.m0_requeue_dlq(p_job uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_editor();perform private.assert_initialized();if p_reason is null or length(p_reason) not between 3 and 200 then raise exception 'REPLAY_REASON_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'DLQ' or j.attempts>=10 or exists(select 1 from private.effect_receipts where effect_key=j.effect_key) or exists(select 1 from private.job_attempts where job_id=j.id and effect_state in ('DISPATCH_INTENT','UNCERTAIN')) then raise exception 'REPLAY_NOT_ALLOWED';end if;
  update private.jobs set state='QUEUED',available_at=clock_timestamp(),max_attempts=attempts+1 where id=j.id;
  insert into private.audits(actor_id,action,entity_id,details) values(private.caller_role(),'DLQ_REPLAY',j.id::text,jsonb_build_object('reason',p_reason,'original_effect_key',j.effect_key));
  return jsonb_build_object('effect_key',j.effect_key,'max_attempts',j.attempts+1);
end$$;
create function public.m0_job_status(p_job uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin perform private.assert_server();select * into strict j from private.jobs where id=p_job;
  return jsonb_build_object('id',j.id,'effect_key',j.effect_key,'state',j.state,'attempts',j.attempts,'max_attempts',j.max_attempts,'lease_until',j.lease_until,'last_error_code',j.last_error_code,'receipt',(select external_receipt from private.effect_receipts where effect_key=j.effect_key));
end$$;
create function public.m0_enqueue_due() returns integer language plpgsql security definer set search_path='' as $$
declare s private.schedules;j jsonb;n integer:=0;
begin
  perform private.assert_server();perform private.assert_initialized();
  for s in select * from private.schedules where enabled and due_at<=clock_timestamp() and enqueued_job_id is null for update skip locked loop
    j:=public.m0_enqueue(s.effect_key,jsonb_build_object('fixture_run_id',s.fixture_run_id,'mode','NORMAL'));
    update private.schedules set enqueued_job_id=(j->>'id')::uuid where id=s.id;n:=n+1;
  end loop;return n;
end$$;
create function public.m0_schedule_fixture(p_run uuid,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cron_id bigint;name text:='judoju-news-m0-'||p_run::text;
begin
  perform private.assert_server();perform private.assert_initialized();if p_run is null then raise exception 'FIXTURE_RUN_REQUIRED';end if;
  insert into private.schedules(schedule_key,due_at,effect_key,fixture_run_id) values(name,clock_timestamp(),p_effect_key,p_run) on conflict(schedule_key) do nothing;
  if not exists(select 1 from private.schedules where schedule_key=name and effect_key=p_effect_key) then raise exception 'SCHEDULE_EFFECT_CONFLICT';end if;
  select cron.schedule(name,'1 second','select public.m0_enqueue_due();') into cron_id;
  return jsonb_build_object('cron_id',cron_id,'schedule_key',name,'effect_key',p_effect_key);
end$$;
create function public.m0_stop_fixture_schedule(p_run uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare id bigint;name text:='judoju-news-m0-'||p_run::text;
begin
  perform private.assert_server();perform private.assert_initialized();if p_run is null then raise exception 'FIXTURE_RUN_REQUIRED';end if;
  update private.schedules set enabled=false where fixture_run_id=p_run;
  select jobid into id from cron.job where jobname=name;
  if id is not null then perform cron.unschedule(id);return true;end if;return false;
end$$;

revoke execute on function public.m0_enqueue(text,jsonb,text,integer,text),public.m0_claim(text,integer),public.m0_heartbeat(uuid,uuid,integer),public.m0_ack(uuid,uuid,text),public.m0_fail(uuid,uuid,boolean,text),public.m0_job_status(uuid),public.m0_enqueue_due(),public.m0_schedule_fixture(uuid,text),public.m0_stop_fixture_schedule(uuid) from public,anon,authenticated;
grant execute on function public.m0_enqueue(text,jsonb,text,integer,text),public.m0_claim(text,integer),public.m0_heartbeat(uuid,uuid,integer),public.m0_ack(uuid,uuid,text),public.m0_fail(uuid,uuid,boolean,text),public.m0_job_status(uuid),public.m0_enqueue_due(),public.m0_schedule_fixture(uuid,text),public.m0_stop_fixture_schedule(uuid) to service_role;
revoke execute on function public.m0_mark_effect_intent(uuid,uuid),public.m0_pending_confirmation() from public,anon,authenticated;
grant execute on function public.m0_mark_effect_intent(uuid,uuid),public.m0_pending_confirmation() to service_role;
revoke execute on function public.m0_reconcile(uuid,text,text),public.m0_requeue_dlq(uuid,text) from public,anon;
grant execute on function public.m0_reconcile(uuid,text,text),public.m0_requeue_dlq(uuid,text) to service_role,authenticated;
commit;
