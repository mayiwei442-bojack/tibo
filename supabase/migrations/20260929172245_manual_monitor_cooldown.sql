begin;

-- All visitors and Vercel instances share the existing monitor row/lease.
-- A recent cron check also satisfies the manual five-minute cooldown.
create or replace function public.monitor_acquire_manual(p_token uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_state public.monitor_state%rowtype;
  v_now timestamptz;
begin
  if p_token is null then raise exception 'INVALID_TOKEN'; end if;
  select * into strict v_state from public.monitor_state where id = 1 for update;
  v_now := clock_timestamp();
  if v_state.lease_until is not null and v_state.lease_until >= v_now then
    return jsonb_build_object('acquired', false, 'reason', 'busy');
  end if;
  if v_state.last_check_at > v_now - interval '5 minutes' then
    return jsonb_build_object(
      'acquired', false, 'reason', 'rate_limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from
        v_state.last_check_at + interval '5 minutes' - v_now))::integer)
    );
  end if;
  return public.monitor_acquire(p_token);
end;
$$;

revoke all on function public.monitor_acquire_manual(uuid) from public, anon, authenticated;
grant execute on function public.monitor_acquire_manual(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
