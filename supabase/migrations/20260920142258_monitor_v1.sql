begin;

create table public.tweets (
  id uuid primary key default gen_random_uuid(),
  tweet_url text not null unique check (tweet_url ~ '^https://x\.com/[A-Za-z0-9_]+/status/[0-9]+$'),
  tweet_text text not null check (length(btrim(tweet_text)) between 1 and 30000),
  published_at timestamptz not null,
  scraped_at timestamptz not null default now(),
  related_to_codex boolean not null,
  category text not null check (category in ('reset','usage_limit','quota_change','service_change','other','irrelevant')),
  summary text not null check (length(btrim(summary)) between 1 and 1000),
  reset_time timestamptz,
  important boolean not null,
  created_at timestamptz not null default now(),
  check (related_to_codex = (category <> 'irrelevant')),
  check (related_to_codex or (not important and reset_time is null))
);
create index tweets_published_at_idx on public.tweets (published_at desc, id desc);
create index tweets_relevant_idx on public.tweets (published_at desc, id desc) where related_to_codex;

create table public.monitor_state (
  id integer primary key default 1 check (id = 1),
  latest_tweet_time timestamptz,
  last_check_at timestamptz,
  last_success_at timestamptz,
  last_error text check (last_error is null or last_error ~ '^[A-Z_]{1,80}$'),
  updated_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz
);
insert into public.monitor_state(id) values (1);

alter table public.tweets enable row level security;
alter table public.monitor_state enable row level security;
revoke all on public.tweets, public.monitor_state from public, anon, authenticated;
grant select, insert, update on public.tweets, public.monitor_state to service_role;

create function public.monitor_acquire(p_token uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_latest timestamptz;
begin
  if p_token is null then raise exception 'INVALID_TOKEN'; end if;
  update public.monitor_state
  set lease_token = p_token, lease_until = clock_timestamp() + interval '330 seconds',
      last_check_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = 1 and (lease_until is null or lease_until < clock_timestamp())
  returning latest_tweet_time into v_latest;
  return jsonb_build_object('acquired', found, 'latest_tweet_time', v_latest);
end;
$$;

create function public.monitor_assert_lease(p_token uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.monitor_state
    where id = 1 and lease_token = p_token and lease_until > clock_timestamp() for update;
  if not found then raise exception 'MONITOR_LEASE_LOST'; end if;
end;
$$;

create function public.monitor_save_tweet(p_token uuid, p_tweet jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform public.monitor_assert_lease(p_token);
  insert into public.tweets(tweet_url, tweet_text, published_at, related_to_codex, category, summary, reset_time, important)
  values (p_tweet->>'tweet_url', p_tweet->>'tweet_text', (p_tweet->>'published_at')::timestamptz,
    (p_tweet->>'related_to_codex')::boolean, p_tweet->>'category', p_tweet->>'summary',
    (p_tweet->>'reset_time')::timestamptz, (p_tweet->>'important')::boolean)
  on conflict (tweet_url) do nothing;
end;
$$;

create function public.monitor_advance(p_token uuid, p_time timestamptz, p_urls text[]) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform public.monitor_assert_lease(p_token);
  if p_time is null or coalesce(cardinality(p_urls), 0) = 0 or exists (
    select 1 from unnest(p_urls) as u(url)
    where not exists (select 1 from public.tweets t where t.tweet_url = u.url and t.published_at = p_time)
  ) then raise exception 'INCOMPLETE_TIMESTAMP_GROUP'; end if;
  update public.monitor_state set latest_tweet_time = greatest(latest_tweet_time, p_time), updated_at = clock_timestamp()
    where id = 1;
end;
$$;

create function public.monitor_finish(p_token uuid, p_error text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform public.monitor_assert_lease(p_token);
  update public.monitor_state
    set lease_token = null, lease_until = null, last_error = p_error,
        last_success_at = case when p_error is null then clock_timestamp() else last_success_at end,
        updated_at = clock_timestamp()
    where id = 1;
end;
$$;

revoke all on function public.monitor_acquire(uuid), public.monitor_assert_lease(uuid),
  public.monitor_save_tweet(uuid,jsonb), public.monitor_advance(uuid,timestamptz,text[]), public.monitor_finish(uuid,text)
  from public, anon, authenticated;
grant execute on function public.monitor_acquire(uuid), public.monitor_assert_lease(uuid),
  public.monitor_save_tweet(uuid,jsonb), public.monitor_advance(uuid,timestamptz,text[]), public.monitor_finish(uuid,text)
  to service_role;
commit;
