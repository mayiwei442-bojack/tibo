begin;

-- This is the oldest ordinary (non-pinned) post seen while the saved cursor
-- remained out of reach. It describes an unverified interval, not a new cursor.
alter table public.monitor_state
  add column if not exists coverage_gap_oldest_seen timestamptz;

-- A monotonic signal lets open dashboards see saved posts even when the
-- coverage gap prevents the timestamp cursor from advancing.
alter table public.dashboard_updates
  add column if not exists version bigint not null default 0;

create or replace function public.monitor_mark_coverage_gap(p_token uuid, p_oldest timestamptz) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_cursor timestamptz;
begin
  perform public.monitor_assert_lease(p_token);
  select latest_tweet_time into v_cursor from public.monitor_state where id = 1;
  if v_cursor is null or p_oldest is null or p_oldest <= v_cursor then
    raise exception 'INVALID_COVERAGE_GAP';
  end if;
  update public.monitor_state
    set coverage_gap_oldest_seen = least(coalesce(coverage_gap_oldest_seen, p_oldest), p_oldest),
        updated_at = clock_timestamp()
    where id = 1 and (coverage_gap_oldest_seen is null or p_oldest < coverage_gap_oldest_seen);
  if found then
    update public.dashboard_updates
      set version = version + 1, updated_at = clock_timestamp() where id = 1;
  end if;
end;
$$;
revoke all on function public.monitor_mark_coverage_gap(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.monitor_mark_coverage_gap(uuid,timestamptz) to service_role;

-- Preserve the original English text, Chinese summary/translation, and reset
-- status from the previous migration. Publish only genuinely new saved rows.
create or replace function public.monitor_save_tweet(p_token uuid, p_tweet jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform public.monitor_assert_lease(p_token);
  insert into public.tweets(tweet_url, tweet_text, published_at, related_to_codex, category, summary, reset_time, important, reset_status, tweet_translation)
  values (p_tweet->>'tweet_url', p_tweet->>'tweet_text', (p_tweet->>'published_at')::timestamptz,
    (p_tweet->>'related_to_codex')::boolean, p_tweet->>'category', p_tweet->>'summary',
    (p_tweet->>'reset_time')::timestamptz, (p_tweet->>'important')::boolean,
    coalesce(p_tweet->>'reset_status', 'unknown'), p_tweet->>'tweet_translation')
  on conflict (tweet_url) do nothing;
  if found then
    update public.dashboard_updates
      set version = version + 1, updated_at = clock_timestamp() where id = 1;
  end if;
end;
$$;

create or replace function public.monitor_finish(p_token uuid, p_error text) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_latest timestamptz;
declare v_had_gap boolean;
begin
  perform public.monitor_assert_lease(p_token);
  select coverage_gap_oldest_seen is not null into v_had_gap
    from public.monitor_state where id = 1;
  update public.monitor_state
    set lease_token = null, lease_until = null, last_error = p_error,
        last_success_at = case when p_error is null then clock_timestamp() else last_success_at end,
        coverage_gap_oldest_seen = case when p_error is null then null else coverage_gap_oldest_seen end,
        updated_at = clock_timestamp()
    where id = 1
    returning latest_tweet_time into v_latest;

  if p_error is null then
    update public.dashboard_updates
      set latest_tweet_time = v_latest, version = version + 1, updated_at = clock_timestamp()
      where id = 1 and (latest_tweet_time is distinct from v_latest or v_had_gap);
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
