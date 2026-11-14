-- Applied migrations 1-4 are immutable. Fence acknowledgements behind confirmed dispatch intent.
begin;
create or replace function public.m0_ack(p_job uuid,p_token uuid,p_receipt text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;previous text;
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_receipt is null or length(p_receipt) not between 1 and 300 then raise exception 'RECEIPT_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state='SUCCEEDED' and j.lease_token=p_token and exists(select 1 from private.effect_receipts where effect_key=j.effect_key and external_receipt=p_receipt) then return jsonb_build_object('status','ALREADY_APPLIED');end if;
  if j.state<>'LEASED' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then raise exception 'STALE_LEASE' using errcode='40001';end if;
  if not exists(select 1 from private.job_attempts where job_id=j.id and lease_token=p_token and effect_state='DISPATCH_INTENT') then raise exception 'EFFECT_INTENT_REQUIRED';end if;
  select external_receipt into previous from private.effect_receipts where effect_key=j.effect_key;
  if previous is not null and previous<>p_receipt then raise exception 'RECEIPT_CONFLICT';end if;
  insert into private.effect_receipts(effect_key,external_receipt) values(j.effect_key,p_receipt) on conflict(effect_key) do nothing;
  update private.jobs set state='SUCCEEDED',completed_at=clock_timestamp(),lease_until=null where id=j.id;
  update private.job_attempts set ended_at=clock_timestamp(),result='SUCCEEDED',effect_state='ACCEPTED' where job_id=j.id and lease_token=p_token;
  return jsonb_build_object('status','APPLIED');
end$$;
commit;
