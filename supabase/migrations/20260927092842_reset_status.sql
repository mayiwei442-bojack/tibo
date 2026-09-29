begin;
alter table public.tweets add column if not exists reset_status text not null default 'unknown'
  check (reset_status in ('completed','upcoming','possible','none','unknown'));

create or replace function public.monitor_save_tweet(p_token uuid, p_tweet jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform public.monitor_assert_lease(p_token);
  insert into public.tweets(tweet_url, tweet_text, published_at, related_to_codex, category, summary, reset_time, important, reset_status)
  values (p_tweet->>'tweet_url', p_tweet->>'tweet_text', (p_tweet->>'published_at')::timestamptz,
    (p_tweet->>'related_to_codex')::boolean, p_tweet->>'category', p_tweet->>'summary',
    (p_tweet->>'reset_time')::timestamptz, (p_tweet->>'important')::boolean,
    coalesce(p_tweet->>'reset_status', 'unknown'))
  on conflict (tweet_url) do nothing;
end;
$$;
-- One verified historical post, guarded by both its URL and exact source text.
-- No broad keyword matching and no AI reprocessing of historical posts.
update public.tweets set reset_status = 'completed'
where tweet_url = 'https://x.com/thsottiaux/status/2103911959544610829'
  and tweet_text = 'Resets all propagated. That will be all. Have a fantastic weekend.'
  and related_to_codex and category = 'reset' and reset_status = 'unknown';
-- Other historical rows remain unknown.
notify pgrst, 'reload schema';
commit;
