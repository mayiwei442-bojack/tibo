import type { Analysis } from '@/types/analysis';
import type { Tweet } from '@/types/tweet';
import { MonitorError, safeErrorCode } from '@/lib/errors';

export interface MonitorRepository {
  acquire(): Promise<{ acquired: boolean; latest_tweet_time: string | null }>;
  exists(tweet: Tweet): Promise<boolean>;
  save(tweet: Tweet, analysis: Analysis): Promise<void>;
  advance(time: string, urls: string[]): Promise<void>;
  finish(error: string | null): Promise<void>;
}
export interface MonitorDependencies {
  repository: MonitorRepository;
  getLatestTweets: (since: string | null) => Promise<Tweet[]>;
  analyseTweet: (tweet: Tweet) => Promise<Analysis>;
  now?: () => number;
}

export async function checkForNewTweets({
  repository,
  getLatestTweets,
  analyseTweet,
  now = Date.now,
}: MonitorDependencies) {
  const deadline = now() + 220000;
  console.info('[Monitor] Start');
  const state = await repository.acquire();
  if (!state.acquired) return { status: 'busy', processed: 0 } as const;
  let processed = 0;
  try {
    const tweets = await getLatestTweets(state.latest_tweet_time);
    const watermark = state.latest_tweet_time
      ? Date.parse(state.latest_tweet_time)
      : -Infinity;
    if (Number.isNaN(watermark))
      throw new MonitorError('DATABASE_INVALID_STATE');
    const unique = new Map<string, Tweet>();
    for (const tweet of tweets) {
      if (!Number.isFinite(Date.parse(tweet.publishedAt)))
        throw new MonitorError('SCRAPER_INVALID_DATA');
      const previous = unique.get(tweet.url);
      if (
        previous &&
        (Date.parse(previous.publishedAt) !== Date.parse(tweet.publishedAt) ||
          previous.text !== tweet.text)
      )
        throw new MonitorError('SCRAPER_CONFLICTING_DATA');
      unique.set(tweet.url, tweet);
    }
    const pending = [...unique.values()]
      .filter((tweet) => Date.parse(tweet.publishedAt) > watermark)
      .sort(
        (a, b) =>
          Date.parse(a.publishedAt) - Date.parse(b.publishedAt) ||
          a.url.localeCompare(b.url),
      );
    console.info(`[Monitor] Found ${pending.length} new tweets`);
    for (let index = 0; index < pending.length;) {
      const timestamp = Date.parse(pending[index].publishedAt);
      const group: Tweet[] = [];
      while (
        index < pending.length &&
        Date.parse(pending[index].publishedAt) === timestamp
      )
        group.push(pending[index++]);
      for (const tweet of group) {
        // Leave time for one bounded AI request, DB save, cursor update and release.
        if (now() + 65000 > deadline) {
          await repository.finish('RUN_BUDGET_REACHED');
          return { status: 'deferred', processed } as const;
        }
        if (await repository.exists(tweet)) continue;
        const analysis = await analyseTweet(tweet);
        await repository.save(tweet, analysis);
        processed++;
        console.info('[Database] Tweet saved');
      }
      // Complete all siblings at the same timestamp before advancing the watermark.
      await repository.advance(
        new Date(timestamp).toISOString(),
        group.map((tweet) => tweet.url),
      );
      console.info('[Monitor] State updated');
    }
    await repository.finish(null);
    console.info('[Monitor] Complete');
    return { status: 'complete', processed } as const;
  } catch (error) {
    const code = safeErrorCode(error);
    console.error(`[Monitor Error] ${code}`);
    try {
      await repository.finish(code);
    } catch {
      console.error('[Database Error] STATE_UPDATE_FAILED');
    }
    throw new MonitorError(code);
  }
}
