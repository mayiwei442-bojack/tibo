import { isCronAuthorized } from '@/lib/cron-auth';
import { checkForNewTweets } from '@/lib/monitor/checkForNewTweets';
import { createMonitorRepository } from '@/lib/monitor/repository';
import { getLatestTweets } from '@/lib/twitter/scraper';
import { analyseTweet } from '@/lib/deepseek/analyseTweet';
import { safeErrorCode } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (
    !isCronAuthorized(
      request.headers.get('authorization'),
      process.env.CRON_SECRET,
    )
  )
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    const result = await checkForNewTweets({
      repository: createMonitorRepository(),
      getLatestTweets,
      analyseTweet,
    });
    return Response.json(result, {
      status: result.status === 'deferred' || result.status === 'partial' ? 202 : 200,
      headers,
    });
  } catch (error) {
    console.error(`[Monitor Error] ${safeErrorCode(error)}`);
    return Response.json(
      { error: 'Check failed. The next scheduled run will retry.' },
      { status: 503, headers },
    );
  }
}
