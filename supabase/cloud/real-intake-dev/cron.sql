-- CLOUD13 S6: the daily AI inbox cleanup job (docs/publish-stage2-plan.md S6). Run in the Supabase SQL Editor (postgres)
-- after the owner enabled the pg_cron extension (Database -> Extensions) and after intake.sql. 04:00 KST = 19:00 UTC.
begin;
set local statement_timeout='30s';
do $guard$
begin
  if current_user<>'postgres' then raise exception 'CRON_POSTGRES_REQUIRED';end if;
  if (select to_jsonb(x)->>'environment' from judoju_control.environment_identity x limit 1) is distinct from 'dev'
    or (select to_jsonb(x)->>'project_ref' from judoju_control.environment_identity x limit 1) is distinct from 'nxfpfvsdwbziowkxsxnh' then raise exception 'CRON_ENVIRONMENT';end if;
  if not exists(select 1 from pg_extension where extname='pg_cron') then raise exception 'CRON_EXTENSION_REQUIRED';end if;
  if to_regprocedure('private.ai_intake_cleanup()') is null then raise exception 'CRON_INTAKE_REQUIRED';end if;
  if exists(select 1 from cron.job where jobname='judoju-ai-inbox-cleanup') then raise exception 'CRON_JOB_EXISTS';end if;
end$guard$;
select cron.schedule('judoju-ai-inbox-cleanup', '0 19 * * *', 'select private.ai_intake_cleanup()');
do $post$
begin
  if (select count(*) from cron.job where jobname='judoju-ai-inbox-cleanup' and schedule='0 19 * * *' and command='select private.ai_intake_cleanup()'
      and username='postgres' and database='postgres' and active)<>1 then raise exception 'CRON_POST_JOB';end if;
  if (select count(*) from cron.job)<>1 then raise exception 'CRON_POST_OTHER_JOBS';end if;
end$post$;
commit;
-- Status (read only): select j.jobname, d.status, d.return_message, d.start_time from cron.job j
--   left join lateral (select * from cron.job_run_details r where r.jobid=j.jobid order by r.runid desc limit 1) d on true
--   where j.jobname='judoju-ai-inbox-cleanup';
