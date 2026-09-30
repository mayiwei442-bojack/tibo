-- Run separately after deployment and a successful authenticated smoke test.
-- Enable Cron (pg_cron), pg_net and Vault in the Supabase Dashboard first.
-- Create these two secrets in Vault, never in this file or Git:
--   tibo_monitor_url: full https://<production-domain>/api/cron/check-tibo
--   tibo_cron_secret: the same value as Vercel's CRON_SECRET
-- Every 90 minutes requires two cron expressions: UTC 00:00, 01:30, 03:00, ...
-- Re-running replaces the same two named jobs and removes legacy schedules.

begin;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'tibo_monitor_url' and decrypted_secret ~ '^https://[^/]+/api/cron/check-tibo$')
     or not exists (select 1 from vault.decrypted_secrets where name = 'tibo_cron_secret' and length(decrypted_secret) >= 32)
  then raise exception 'Configure the two monitor Vault secrets before scheduling'; end if;
end;
$$;

do $$
begin
  perform cron.schedule(
    'tibo-monitor-90m-hour',
    '0 */3 * * *',
    $job$
      select net.http_get(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'tibo_monitor_url'),
        headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tibo_cron_secret')),
        timeout_milliseconds := 280000
      );
    $job$
  );
  perform cron.schedule(
    'tibo-monitor-90m-half-hour',
    '30 1-23/3 * * *',
    $job$
      select net.http_get(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'tibo_monitor_url'),
        headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tibo_cron_secret')),
        timeout_milliseconds := 280000
      );
    $job$
  );
  if exists (select 1 from cron.job where jobname = 'tibo-monitor-every-2-hours') then
    perform cron.unschedule('tibo-monitor-every-2-hours');
  end if;
  if exists (select 1 from cron.job where jobname = 'tibo-monitor-every-5-minutes') then
    perform cron.unschedule('tibo-monitor-every-5-minutes');
  end if;
end;
$$;

select jobid, jobname, schedule, active
from cron.job
where jobname in ('tibo-monitor-90m-hour', 'tibo-monitor-90m-half-hour',
  'tibo-monitor-every-2-hours', 'tibo-monitor-every-5-minutes');

commit;

-- Check BOTH cron.job_run_details (dispatch) and net._http_response (HTTP result).
-- A successful dispatch alone does NOT prove the monitor succeeded.
-- Pause later with: select cron.alter_job(job_id := <this job's id>, active := false);
