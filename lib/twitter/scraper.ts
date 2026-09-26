import 'server-only';
import { requiredEnv, sourceUrl } from '@/lib/config';
import { MonitorError } from '@/lib/errors';
import { validateTweets } from './validation';
import type { Tweet } from '@/types/tweet';

// This is the only application boundary to the Python/Scrapling service.
export async function getLatestTweets(
  latestTweetTime: string | null = null,
): Promise<Tweet[]> {
  const target = sourceUrl();
  if (!target) throw new MonitorError('CONFIGURATION_REQUIRED');
  const endpoint = new URL(requiredEnv('SCRAPER_URL'));
  if (
    endpoint.protocol !== 'https:' &&
    !(
      process.env.NODE_ENV !== 'production' &&
      endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(endpoint.hostname)
    )
  )
    throw new MonitorError('CONFIGURATION_REQUIRED');
  const secret = requiredEnv('SCRAPER_SECRET');
  console.info('[Scraper] Fetching Tibo');
  try {
    const response = await fetch(new URL('/tweets', endpoint), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ latestTweetTime }),
      cache: 'no-store',
      signal: AbortSignal.timeout(85000),
      redirect: 'error',
    });
    if (!response.ok) throw new MonitorError('SCRAPER_UNAVAILABLE');
    const body = await response.text();
    if (body.length > 2_000_000) throw new MonitorError('SCRAPER_INVALID_DATA');
    const data = JSON.parse(body) as { tweets?: unknown; sourceUrl?: unknown };
    if (data.sourceUrl !== target)
      throw new MonitorError('SCRAPER_SOURCE_MISMATCH');
    const tweets = validateTweets(data.tweets, target);
    console.info(`[Scraper] Found ${tweets.length} tweets`);
    return tweets;
  } catch (error) {
    if (error instanceof MonitorError) throw error;
    throw new MonitorError('SCRAPER_UNAVAILABLE');
  }
}
