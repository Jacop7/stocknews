begin;
-- Canonical evidence hashes must not depend on the caller session timezone.
create or replace function private.reservation_evidence_hash(p_issue uuid) returns text language sql stable set search_path='' set timezone='UTC' as $$
 select private.reservation_hash(jsonb_build_object(
 'claims',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from private.claims c where c.issue_id=p_issue),
 'edges',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from private.evidence_edges e join private.claims c on c.id=e.claim_id where c.issue_id=p_issue)))
$$;
create function private.maintenance_job_state(p_registered boolean,p_active boolean,p_has_run boolean,p_status text,p_start timestamptz,p_created timestamptz,p_kind text,p_now timestamptz)
returns text language sql immutable set search_path='' as $$
 select case when not p_registered then 'UNAVAILABLE' when not coalesce(p_active,false) then 'STOPPED'
 when not p_has_run then case when p_created<=p_now-case when p_kind='RETENTION' then interval '70 minutes' else interval '3 minutes' end then 'STALE' else 'PENDING_FIRST_RUN' end
 when p_status='failed' then 'FAILED' when p_start is null then 'UNAVAILABLE'
 when p_status in ('running','starting','connecting','sending') then case when p_start<=p_now-interval '1 minute' then 'STALE' else 'RUNNING' end
 when p_start<=p_now-case when p_kind='RETENTION' then interval '70 minutes' else interval '3 minutes' end then 'STALE' else 'ACTIVE' end
$$;
create or replace function public.maintenance_admin_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare jobs jsonb;runs jsonb;at_time timestamptz:=clock_timestamp();
begin
 perform private.m1_assert_editor();
 select coalesce(jsonb_agg(jsonb_build_object('kind',j.kind,'registered',c.jobid is not null,'active',c.active,
 'schedule',c.schedule,'job_id',j.job_id,'state',private.maintenance_job_state(c.jobid is not null,c.active,d.runid is not null,d.status,d.start_time,j.created_at,j.kind,at_time),
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

alter function public.maintenance_configure(boolean) rename to maintenance_configure_v1;
alter function public.maintenance_configure_v1(boolean) set schema private;
revoke execute on function private.maintenance_configure_v1(boolean) from public,anon,authenticated,service_role;
create function public.maintenance_configure(p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.assert_server();perform private.assert_initialized();
 if p_enabled and current_setting('cron.launch_active_jobs',true) is distinct from 'on' then raise exception 'CRON_LAUNCH_DISABLED';end if;
 return private.maintenance_configure_v1(p_enabled);
end$$;
revoke execute on function public.maintenance_configure(boolean) from public,anon,authenticated,service_role;
grant execute on function public.maintenance_configure(boolean) to service_role;
revoke execute on function private.maintenance_job_state(boolean,boolean,boolean,text,timestamptz,timestamptz,text,timestamptz) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
