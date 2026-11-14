begin;
create table private.maintenance_safety_proof (
 singleton boolean primary key default true check(singleton),bootstrap_id uuid not null,
 command_hashes jsonb not null,timeout_verified boolean not null default false,
 verified_at timestamptz not null default clock_timestamp()
);
alter table private.maintenance_safety_proof enable row level security;
revoke all on private.maintenance_safety_proof from public,anon,authenticated,service_role;
alter table private.installation_retention_ledger add column outcomes_deleted integer not null default 0;
alter table private.installation_retention_ledger add column receipts_cleared integer not null default 0;
create function private.retention_tick() returns jsonb language plpgsql security definer set search_path='' as $$
declare at_time timestamptz:=clock_timestamp();raw_n integer;outcome_n integer;ticket_n integer;daily_n integer;history_n integer;receipt_n integer;cron_n integer;r jsonb;
begin
 perform private.assert_server();perform private.assert_initialized();
 if not pg_try_advisory_xact_lock(70606,3) then return jsonb_build_object('status','BUSY');end if;
 delete from private.installation_qa_views where id in(select id from private.installation_qa_views where accepted_at<=at_time-interval '30 days' order by accepted_at,id limit 1000);get diagnostics raw_n=row_count;
 delete from private.installation_view_outcomes where ctid in(select ctid from private.installation_view_outcomes where created_at<=at_time-interval '30 days' order by created_at limit 1000);get diagnostics outcome_n=row_count;
 delete from private.installation_view_tickets where id in(select t.id from private.installation_view_tickets t where t.expires_at<=at_time
  and not exists(select 1 from private.installation_qa_views e where e.ticket_id=t.id) and not exists(select 1 from private.installation_view_outcomes e where e.ticket_id=t.id) order by t.expires_at,t.id limit 1000);get diagnostics ticket_n=row_count;
 delete from private.installation_qa_daily where ctid in(select ctid from private.installation_qa_daily where day<((at_time-interval '1 year') at time zone 'Asia/Seoul')::date order by day,issue_id limit 1000);get diagnostics daily_n=row_count;
 delete from private.installation_setting_changes where id in(select id from private.installation_setting_changes where occurred_at<=at_time-interval '30 days' order by occurred_at,id limit 1000);get diagnostics history_n=row_count;
 update private.installation_operations set receipt_ciphertext=null where generation in(select generation from private.installation_operations where deadline<=at_time and receipt_ciphertext is not null order by deadline,generation limit 1000);get diagnostics receipt_n=row_count;
 if raw_n+outcome_n+ticket_n+daily_n+history_n+receipt_n>0 then
  insert into private.installation_retention_ledger(raw_deleted,daily_deleted,tickets_deleted,history_deleted,outcomes_deleted,receipts_cleared) values(raw_n,daily_n,ticket_n,history_n,outcome_n,receipt_n);
 end if;
 delete from private.installation_retention_ledger where id in(select id from private.installation_retention_ledger where occurred_at<at_time-interval '1 year' order by occurred_at,id limit 1000);
 delete from private.maintenance_runs where id in(select id from private.maintenance_runs where finished_at<at_time-interval '30 days' order by finished_at,id limit 1000);
 delete from cron.job_run_details where runid in(select d.runid from cron.job_run_details d join private.maintenance_cron_jobs j on j.job_id=d.jobid where d.end_time<at_time-interval '30 days' order by d.end_time,d.runid limit 1000);get diagnostics cron_n=row_count;
 r:=jsonb_build_object('status','OK','mode','LOCAL_QA','cutoff_as_of',at_time,'per_type_limit',1000,'raw_deleted',raw_n,'outcomes_deleted',outcome_n,'tickets_deleted',ticket_n,'daily_deleted',daily_n,'settings_history_deleted',history_n,'receipts_cleared',receipt_n,'cron_history_deleted',cron_n,'privacy_full_purge',false);
 insert into private.maintenance_runs(kind,started_at,finished_at,result) values('RETENTION',at_time,clock_timestamp(),r);return r;
end$$;
create or replace function public.installation_qa_purge() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.assert_server();perform private.assert_initialized();return private.retention_tick();end$$;

create function private.maintenance_command(p_kind text) returns text language sql immutable set search_path='' as $$
 select case p_kind
 when 'RESERVATIONS' then 'SET LOCAL statement_timeout=''5s''; SET LOCAL lock_timeout=''2s''; SELECT private.reservation_tick();'
 when 'CORRECTIONS' then 'SET LOCAL statement_timeout=''5s''; SET LOCAL lock_timeout=''2s''; SELECT private.correction_timeout_tick();'
 when 'RETENTION' then 'SET LOCAL statement_timeout=''5s''; SET LOCAL lock_timeout=''2s''; SELECT private.retention_tick();' end
$$;
-- Deployment calls this separately after compile/runtime timeout proof. No job
-- is enabled by this migration. The sole supported environment remains local.
create function public.maintenance_configure(p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare runtime private.runtime_identity;j private.maintenance_cron_jobs;v_kind text;v_name text;v_command text;v_frequency text;v_job bigint;
begin
 perform private.assert_server();perform private.assert_initialized();
 if p_enabled is null then raise exception 'BOOLEAN_REQUIRED';end if;
 perform pg_advisory_xact_lock(70606,4);
 select * into strict runtime from private.runtime_identity where singleton;
 if runtime.product_id<>'judoju-news' or runtime.environment<>'local' or runtime.bootstrap_id is null then raise exception 'PRODUCT_FINGERPRINT_MISMATCH';end if;
 if current_setting('cron.log_run',true) is distinct from 'on' or current_setting('cron.use_background_workers',true) is distinct from 'off' then raise exception 'CRON_RUNTIME_UNVERIFIED';end if;
 if p_enabled and not exists(select 1 from private.maintenance_safety_proof p where p.singleton and p.bootstrap_id=runtime.bootstrap_id and p.timeout_verified
  and p.command_hashes=jsonb_build_object('RESERVATIONS',private.reservation_hash(to_jsonb(private.maintenance_command('RESERVATIONS'))),'CORRECTIONS',private.reservation_hash(to_jsonb(private.maintenance_command('CORRECTIONS'))),'RETENTION',private.reservation_hash(to_jsonb(private.maintenance_command('RETENTION'))))) then raise exception 'CRON_TIMEOUT_PROOF_REQUIRED';end if;
 foreach v_kind in array array['RESERVATIONS','CORRECTIONS','RETENTION'] loop
  v_name:='judoju-news-6e-'||runtime.bootstrap_id::text||'-'||lower(v_kind);v_command:=private.maintenance_command(v_kind);
  v_frequency:=case when v_kind='RETENTION' then '17 * * * *' else '* * * * *' end;
  select * into j from private.maintenance_cron_jobs where maintenance_cron_jobs.kind=v_kind for update;
  if found then
   if j.bootstrap_id<>runtime.bootstrap_id or j.job_name<>v_name or j.command_hash<>private.reservation_hash(to_jsonb(v_command))
   or not exists(select 1 from cron.job c where c.jobid=j.job_id and c.jobname=v_name and c.command=v_command and c.schedule=v_frequency and c.username='postgres' and c.database=current_database()) then raise exception 'CRON_OWNERSHIP_CONFLICT';end if;
   perform cron.alter_job(j.job_id,active:=p_enabled);update private.maintenance_cron_jobs set enabled=p_enabled where maintenance_cron_jobs.kind=v_kind;
  else
   if exists(select 1 from cron.job where jobname=v_name) then raise exception 'CRON_NAME_COLLISION';end if;
   v_job:=cron.schedule(v_name,v_frequency,v_command);perform cron.alter_job(v_job,active:=p_enabled);
   insert into private.maintenance_cron_jobs values(v_kind,v_job,v_name,private.reservation_hash(to_jsonb(v_command)),runtime.bootstrap_id,p_enabled,clock_timestamp());
  end if;
 end loop;
 insert into private.audits(actor_id,action,entity_id) values('judoju-maintenance',case when p_enabled then 'MAINTENANCE_ENABLE' else 'MAINTENANCE_PAUSE' end,runtime.bootstrap_id::text);
 return jsonb_build_object('status',case when p_enabled then 'ENABLED' else 'PAUSED' end,'jobs',3,'environment','local');
end$$;
create function public.maintenance_admin_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb;runs jsonb;at_time timestamptz:=clock_timestamp();
begin
 perform private.m1_assert_editor();
 select coalesce(jsonb_agg(jsonb_build_object('kind',j.kind,'registered',c.jobid is not null,'active',c.active,
 'schedule',c.schedule,'job_id',j.job_id,'state',case when c.jobid is null then 'UNAVAILABLE' when not c.active then 'STOPPED' when d.status='running' and d.start_time<at_time-interval '1 minute' then 'STALE' when d.status='failed' then 'FAILED' when d.runid is null then 'PENDING_FIRST_RUN' when d.start_time<at_time-case when j.kind='RETENTION' then interval '70 minutes' else interval '3 minutes' end then 'STALE' else 'ACTIVE' end,
 'last_started_at',d.start_time,'last_finished_at',d.end_time,'last_status',d.status,'last_error_code',case when d.status='failed' then 'CRON_EXECUTION_FAILED' else null end) order by j.kind),'[]') into jobs
 from private.maintenance_cron_jobs j left join cron.job c on c.jobid=j.job_id and c.jobname=j.job_name and private.reservation_hash(to_jsonb(c.command))=j.command_hash
 left join lateral(select runid,start_time,end_time,status from cron.job_run_details where jobid=j.job_id order by runid desc limit 1)d on true;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.started_at desc),'[]') into runs from(select kind,started_at,finished_at,result from private.maintenance_runs order by started_at desc limit 12)x;
 return jsonb_build_object('mode','LOCAL_SYNTHETIC','as_of',at_time,'jobs',jobs,'runs',runs,'real_push_sent',0,'backlog',jsonb_build_object(
 'pending',(select count(*) from private.manual_publication_schedules where status='PENDING'),'held',(select count(*) from private.manual_publication_schedules where status='HELD'),
 'next_due',(select min(due_at) from private.manual_publication_schedules where status='PENDING'),
 'oldest_pending',(select min(due_at) from private.manual_publication_schedules where status='PENDING' and due_at<=at_time),
 'corrections_due',(select count(*) from private.issues where publication_state='CORRECTION_PENDING' and correction_pending_since<=at_time-interval '24 hours'),
 'raw_expired',(select count(*) from private.installation_qa_views where accepted_at<=at_time-interval '30 days'),
 'oldest_expired_raw',(select min(accepted_at) from private.installation_qa_views where accepted_at<=at_time-interval '30 days')));
end$$;
revoke execute on function private.retention_tick(),private.maintenance_command(text) from public,anon,authenticated,service_role;
revoke execute on function public.maintenance_configure(boolean),public.maintenance_admin_status() from public,anon,authenticated,service_role;
grant execute on function public.maintenance_configure(boolean) to service_role;
grant execute on function public.maintenance_admin_status() to authenticated;
notify pgrst,'reload schema';
commit;
