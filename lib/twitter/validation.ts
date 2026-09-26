import { z } from 'zod';
import type { Tweet } from '@/types/tweet';
import { MonitorError } from '@/lib/errors';

const tweetSchema = z
  .object({
    text: z.string().trim().min(1).max(30000),
    publishedAt: z.iso.datetime({ offset: true }),
    url: z.url(),
    tweetId: z.string().regex(/^\d+$/).optional(),
  })
  .strict();

export function validateTweets(
  input: unknown,
  targetUrl: string,
  now = Date.now(),
): Tweet[] {
  const result = z.array(tweetSchema).min(1).max(200).safeParse(input);
  if (!result.success) throw new MonitorError('SCRAPER_INVALID_DATA');
  const author = new URL(targetUrl).pathname.split('/')[1].toLowerCase();
  const seen = new Map<string, Tweet>();
  for (const tweet of result.data) {
    const url = new URL(tweet.url);
    const match = url.pathname.match(/^\/([a-zA-Z0-9_]+)\/status\/(\d+)\/?$/);
    if (
      url.protocol !== 'https:' ||
      !['x.com', 'twitter.com', 'www.x.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      !match ||
      match[1].toLowerCase() !== author ||
      Date.parse(tweet.publishedAt) > now + 60000
    ) {
      throw new MonitorError('SCRAPER_INVALID_DATA');
    }
    const canonical = `https://x.com/${author}/status/${match[2]}`;
    const normalized = {
      ...tweet,
      url: canonical,
      publishedAt: new Date(tweet.publishedAt).toISOString(),
    };
    const previous = seen.get(canonical);
    if (
      previous &&
      (previous.publishedAt !== normalized.publishedAt ||
        previous.text !== normalized.text)
    )
      throw new MonitorError('SCRAPER_CONFLICTING_DATA');
    seen.set(canonical, normalized);
  }
  return [...seen.values()];
}
