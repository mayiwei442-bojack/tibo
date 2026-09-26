-- Run separately after deployment and a successful authenticated smoke test.
-- Enable Cron (pg_cron), pg_net and Vault in the Supabase Dashboard first.
-- Create these two secrets in Vault, never in this file or Git:
--   tibo_monitor_url: full https://<production-domain>/api/cron/check-tibo
--   tibo_cron_secret: the same value as Vercel's CRON_SECRET
-- This schedules ONE job. Re-running replaces the same named job.

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'tibo_monitor_url' and decrypted_secret ~ '^https://[^/]+/api/cron/check-tibo$')
     or not exists (select 1 from vault.decrypted_secrets where name = 'tibo_cron_secret' and length(decrypted_secret) >= 32)
  then raise exception 'Configure the two monitor Vault secrets before scheduling'; end if;
end;
$$;

select cron.schedule(
  'tibo-monitor-every-5-minutes',
  '*/5 * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'tibo_monitor_url'),
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tibo_cron_secret')),
      timeout_milliseconds := 280000
    );
  $job$
);

-- Check BOTH cron.job_run_details (dispatch) and net._http_response (HTTP result).
-- A successful dispatch alone does NOT prove the monitor succeeded.
-- Pause later with: select cron.alter_job(job_id := <this job's id>, active := false);
