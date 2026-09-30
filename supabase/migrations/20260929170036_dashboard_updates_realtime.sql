begin;

-- Public clients receive only a version signal, never tweets or monitor secrets.
create table public.dashboard_updates (
  id integer primary key check (id = 1),
  latest_tweet_time timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.dashboard_updates (id, latest_tweet_time)
select id, latest_tweet_time from public.monitor_state where id = 1;

alter table public.dashboard_updates enable row level security;
revoke all on public.dashboard_updates from public, anon, authenticated;
grant select on public.dashboard_updates to anon;
grant select, update on public.dashboard_updates to service_role;

create policy "Public can read dashboard update version"
on public.dashboard_updates for select to anon using (id = 1);

-- Publish only after a complete, successful monitor run. A failed/partial run
-- leaves the update version unchanged, so open pages are not told it finished.
create or replace function public.monitor_finish(p_token uuid, p_error text) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_latest timestamptz;
begin
  perform public.monitor_assert_lease(p_token);
  update public.monitor_state
    set lease_token = null, lease_until = null, last_error = p_error,
        last_success_at = case when p_error is null then clock_timestamp() else last_success_at end,
        updated_at = clock_timestamp()
    where id = 1
    returning latest_tweet_time into v_latest;

  if p_error is null then
    update public.dashboard_updates
      set latest_tweet_time = v_latest, updated_at = clock_timestamp()
      where id = 1 and latest_tweet_time is distinct from v_latest;
  end if;
end;
$$;

-- Supabase projects have this publication; local PGlite tests do not.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.dashboard_updates;
  end if;
end;
$$;

commit;
