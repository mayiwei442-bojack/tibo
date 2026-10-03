import { checkForNewTweets } from '@/lib/monitor/checkForNewTweets';
import { createMonitorRepository } from '@/lib/monitor/repository';
import { getLatestTweets } from '@/lib/twitter/scraper';
import { analyseTweet } from '@/lib/deepseek/analyseTweet';
import { safeErrorCode } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  // Same-origin POST protects browser users from cross-site triggering. This is
  // a public button, not authentication; the atomic database cooldown bounds work.
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  }
  try {
    const result = await checkForNewTweets({
      repository: createMonitorRepository({ manual: true }),
      getLatestTweets,
      analyseTweet,
    });
    if (result.status === 'rate_limited') {
      headers['Retry-After'] = String(result.retryAfterSeconds);
    }
    const status = result.status === 'rate_limited' ? 429
      : result.status === 'busy' ? 409
        : result.status === 'deferred' || result.status === 'partial' ? 202 : 200;
    return Response.json(result, { status, headers });
  } catch (error) {
    console.error(`[Manual Monitor Error] ${safeErrorCode(error)}`);
    return Response.json({ error: 'Check failed. Please try again later.' }, { status: 503, headers });
  }
}
