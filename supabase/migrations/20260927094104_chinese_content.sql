begin;
-- Apply the reset_status migration first.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tweets' and column_name = 'reset_status') then
    raise exception 'Apply 20260927092842_reset_status.sql first';
  end if;
end $$;
alter table public.tweets add column if not exists tweet_translation text
  check (tweet_translation is null or length(btrim(tweet_translation)) between 1 and 30000);

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
end;
$$;

-- One-time localization of the seven existing records, guarded by original
-- URL, text and summary. Never alter tweet_text, timestamps, analysis flags or cursor.

update public.tweets set summary = 'Tibo 表示发布前的 code freeze 已基本不再适用，未来代码甚至可能依据约束条件，针对每次请求在线生成。', tweet_translation = '发布前已经不太需要 code freeze 了；将来，代码甚至可能根据一些约束条件，针对每次请求在线生成。'
where tweet_url = 'https://x.com/thsottiaux/status/2104108167806550046'
  and tweet_text = 'Code freeze isn’t really a thing anymore before releases and in the future the code might even be generated online per request according to some constraints.'
  and summary = 'Tibo says code freezes before releases are largely obsolete and that in the future code might be generated online per request according to constraints.'
  and tweet_translation is null;

update public.tweets set summary = 'Tibo 表示所有 Reset 都已生效，并祝大家周末愉快。', tweet_translation = '所有 Reset 都已生效。就这些了。祝大家度过一个美好的周末。'
where tweet_url = 'https://x.com/thsottiaux/status/2103911959544610829'
  and tweet_text = 'Resets all propagated. That will be all. Have a fantastic weekend.'
  and summary = 'Tibo states that all resets have been propagated and wishes everyone a fantastic weekend.'
  and tweet_translation is null;

update public.tweets set summary = 'Tibo 宣布短暂中断后，将为 Codex 和 ChatGPT work 的所有付费用户重置 usage limits。', tweet_translation = '哦，没错……我们恢复运行了，将为 Codex 和 ChatGPT work 的所有付费用户重置 usage limits。

抱歉刚才出现了短暂中断！

（没错，服务出问题时，我们有一个特别的备用 Codex 来帮忙。）'
where tweet_url = 'https://x.com/thsottiaux/status/2103637477760311522'
  and tweet_text = 'o yes… we’re back in action and we’ll reset usage limits for all paid users across codex and ChatGPT work

sorry about the brief disruption!

(and yes we have a special spare codex when things are down to help us out)'
  and summary = 'Tibo announces that usage limits will be reset for all paid users across Codex and ChatGPT work after a brief disruption.'
  and tweet_translation is null;

update public.tweets set summary = 'Tibo 表示团队已知晓 Codex 故障，正在努力恢复正常服务。', tweet_translation = '我们已经知道 Codex 出现故障，正在努力恢复正常服务。'
where tweet_url = 'https://x.com/thsottiaux/status/2103620061156290622'
  and tweet_text = 'We are aware that codex is down and are working hard to bring back normal service.'
  and summary = 'The author states they are aware Codex is down and are working to restore normal service.'
  and tweet_translation is null;

update public.tweets set summary = 'Tibo 表示最近较少发帖，因为内部 Slack 很有趣，大家也在全力准备 DevDay，并称周二会很有意思。', tweet_translation = '最近这里有点安静，因为内部 Slack 最近实在太好笑了，也因为我们都在全力投入 DevDay。周二会很有意思。'
where tweet_url = 'https://x.com/thsottiaux/status/2103375711797211460'
  and tweet_text = 'Been a bit quiet here because internal Slack has been hilarious lately and because we are all locked in on DevDay. Tuesday will be fun.'
  and summary = 'Tibo says things have been quiet because internal Slack has been funny and everyone is focused on DevDay, with Tuesday expected to be fun.'
  and tweet_translation is null;

update public.tweets set summary = 'Tibo 表达了对下周二 DevDay 的期待，预告有趣且雄心勃勃的变化，但没有提及 Codex。', tweet_translation = '已经等不及下周二的 DevDay 了。

有一些非常有趣的东西，还有许多许多应该能改变你工作方式的东西。这是我们迄今最有雄心的一次 sprint，Astra 确实让我们在这么短的时间里实现了新的可能。'
where tweet_url = 'https://x.com/thsottiaux/status/2102996313780736363'
  and tweet_text = 'Can''t wait for DevDay next Tuesday.

Some really fun stuff, but also many many things that should change the way you work. It''s been our most ambitious sprint and Astra has really made new things possible in such short amounts of time.'
  and summary = 'Tibo expresses excitement for DevDay next Tuesday, teasing fun and ambitious changes without mentioning Codex.'
  and tweet_translation is null;

update public.tweets set summary = 'Tibo 描述了自己已习惯通过语音与 ChatGPT 讨论工作、查看邮件、编写代码和管理日历，并使用包括第三方 plugins 在内的整个生态。', tweet_translation = 'Voice！我已经很习惯直接呼叫 ChatGPT，聊聊所有工作、查看邮件、写点代码、管理日历；这也适用于整个 plugins 生态，包括第三方开发的 plugins。'
where tweet_url = 'https://x.com/thsottiaux/status/2102814202117411196'
  and tweet_text = 'Voice! I''ve gotten so used to just call ChatGPT and talk about all the work, check on emails, do some coding, manage my calendar and it works across the full ecosystem of plugins, including 3P developed plugins.'
  and summary = 'The author describes getting used to calling ChatGPT by voice to discuss work, check emails, do some coding, and manage their calendar across the full ecosystem of plugins, including third-party developed plugins.'
  and tweet_translation is null;

notify pgrst, 'reload schema';
commit;
