begin;
alter table private.outbox add column dispatched_job_id uuid references private.jobs(id);
create function public.m1_dispatch_outbox(p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.outbox;r jsonb;result jsonb:='[]';
begin perform private.assert_server();perform private.assert_initialized();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_DISPATCH_SIZE';end if;
  for o in select * from private.outbox where dispatched_job_id is null and payload ? 'editor_request_hash' order by created_at,id for update skip locked limit p_limit loop
    r:=public.m0_enqueue(o.effect_key,jsonb_build_object('fixture_run_id',o.id,'mode','NORMAL'),'local',1,'MOCK_EFFECT');
    update private.outbox set dispatched_job_id=(r->>'id')::uuid where id=o.id;
    result:=result||jsonb_build_array(jsonb_build_object('outbox_id',o.id,'job_id',r->>'id'));
  end loop;return result;
end$$;
create function public.m1_public_identity() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('productId',product_id,'environment',environment,'sampleKind','SYNTHETIC','bootstrapId',bootstrap_id,'contract','M1') from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null
$$;
grant execute on function public.m1_dispatch_outbox(integer) to service_role;
grant execute on function public.m1_public_identity() to anon,authenticated;
notify pgrst,'reload schema';
commit;
