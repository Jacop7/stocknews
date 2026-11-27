CREATE OR REPLACE FUNCTION private.correction_timeout_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare start_at timestamptz:=clock_timestamp();candidate record;i private.issues;n integer:=0;skipped integer:=0;k text;r jsonb;
begin
 perform private.assert_server();perform private.assert_initialized();
 if not pg_try_advisory_xact_lock(70606,2) then return jsonb_build_object('status','BUSY');end if;
 for candidate in select id from private.issues where publication_state='CORRECTION_PENDING' and correction_pending_since<=clock_timestamp()-interval '24 hours' order by correction_pending_since,id limit 20 loop
  exit when clock_timestamp()-start_at>=interval '4 seconds';
  begin
   perform 1 from private.catalog_head where singleton for share;
   select * into strict i from private.issues where id=candidate.id for update;
   if i.publication_state<>'CORRECTION_PENDING' or i.correction_pending_since is null or i.correction_pending_since>clock_timestamp()-interval '24 hours' then continue;end if;
   k:='correction-timeout:'||i.id::text||':'||i.revision::text;
   perform public.m0_set_publication_state(i.id,i.revision,'WITHDRAWN');
   insert into private.outbox(issue_id,event_type,effect_key,payload) values(i.id,'ISSUE_WITHDRAWN',k,jsonb_build_object('issue_id',i.id,'sample_kind','SYNTHETIC','reason','CORRECTION_TIMEOUT'));
   insert into private.audits(actor_id,action,entity_id) values('judoju-maintenance','CORRECTION_TIMEOUT',i.id::text);n:=n+1;
  exception when lock_not_available then skipped:=skipped+1;
  end;
 end loop;
 r:=jsonb_build_object('status','OK','withdrawn',n,'lock_skipped',skipped);
 insert into private.maintenance_runs(kind,started_at,finished_at,result) values('CORRECTIONS',start_at,clock_timestamp(),r);return r;
end$function$

