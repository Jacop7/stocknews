begin;
-- Server-only local fixture for proving the actual REST lock-timeout rollback.
create function public.m0_lock_probe() returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_server();perform private.assert_initialized();
  insert into private.audits(actor_id,action,entity_id) values('M0_TEST','LOCK_TIMEOUT_PROBE','TEST');
  perform 1 from private.runtime_identity where singleton for update;
  return true;
end$$;
revoke execute on function public.m0_lock_probe() from public,anon,authenticated;
grant execute on function public.m0_lock_probe() to service_role;
commit;
