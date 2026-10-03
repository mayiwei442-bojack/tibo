import 'server-only';
import { randomUUID } from 'node:crypto';
import { createServerDatabase } from '@/lib/supabase/server';
import { MonitorError } from '@/lib/errors';
import type { MonitorAcquisition, MonitorRepository } from './checkForNewTweets';

export function createMonitorRepository({ manual = false }: { manual?: boolean } = {}): MonitorRepository {
  const db = createServerDatabase();
  const token = randomUUID();
  async function rpc(name: string, params: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, { p_token: token, ...params });
    if (error) throw new MonitorError('DATABASE_OPERATION_FAILED');
    return data;
  }
  return {
    async acquire() {
      const result = await rpc(manual ? 'monitor_acquire_manual' : 'monitor_acquire', {});
      if (!result || typeof result.acquired !== 'boolean')
        throw new MonitorError('DATABASE_INVALID_STATE');
      return { latest_tweet_time: null, ...result } as MonitorAcquisition;
    },
    async exists(tweet) {
      const { data, error } = await db
        .from('tweets')
        .select('published_at,tweet_text')
        .eq('tweet_url', tweet.url)
        .maybeSingle();
      if (error) throw new MonitorError('DATABASE_OPERATION_FAILED');
      if (
        data &&
        (Date.parse(data.published_at) !== Date.parse(tweet.publishedAt) ||
          data.tweet_text !== tweet.text)
      )
        throw new MonitorError('SCRAPER_CONFLICTING_DATA');
      return Boolean(data);
    },
    async save(tweet, analysis) {
      await rpc('monitor_save_tweet', {
        p_tweet: {
          tweet_url: tweet.url,
          tweet_text: tweet.text,
          published_at: tweet.publishedAt,
          ...analysis,
        },
      });
    },
    async advance(time, urls) {
      await rpc('monitor_advance', { p_time: time, p_urls: urls });
    },
    async markCoverageGap(oldest) {
      await rpc('monitor_mark_coverage_gap', { p_oldest: oldest });
    },
    async finish(error) {
      await rpc('monitor_finish', { p_error: error });
    },
  };
}
