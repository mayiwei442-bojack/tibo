import 'server-only';
import { createServerDatabase } from '@/lib/supabase/server';
import { sourceUrl } from '@/lib/config';
import type { DashboardData, MonitorHealth } from '@/types/dashboard';
import type { StoredTweet } from '@/types/tweet';

export function emptyDashboard(
  health: MonitorHealth = 'unconfigured',
): DashboardData {
  return {
    state: {
      latest_tweet_time: null,
      last_check_at: null,
      last_success_at: null,
      health,
    },
    latestSignal: null,
    tweets: [],
    totalProcessed: 0,
    relatedCount: 0,
    sourceUrl: sourceUrl(),
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
    return emptyDashboard();
  try {
    const db = createServerDatabase();
    const columns =
      'id,tweet_url,tweet_text,published_at,scraped_at,related_to_codex,category,summary,reset_time,important,created_at';
    const [state, recent, latest, total, related] = await Promise.all([
      db
        .from('monitor_state')
        .select('latest_tweet_time,last_check_at,last_success_at,last_error')
        .eq('id', 1)
        .single(),
      db
        .from('tweets')
        .select(columns)
        .order('published_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(30),
      db
        .from('tweets')
        .select(columns)
        .eq('related_to_codex', true)
        .order('published_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from('tweets').select('id', { count: 'exact', head: true }),
      db
        .from('tweets')
        .select('id', { count: 'exact', head: true })
        .eq('related_to_codex', true),
    ]);
    if ([state, recent, latest, total, related].some((result) => result.error))
      throw new Error('DATABASE_READ_FAILED');
    const s = state.data!;
    const health: MonitorHealth = s.last_error
      ? 'degraded'
      : !s.last_success_at
        ? 'waiting'
        : Date.now() - Date.parse(s.last_success_at) > 15 * 60000
          ? 'stale'
          : 'healthy';
    return {
      state: {
        latest_tweet_time: s.latest_tweet_time,
        last_check_at: s.last_check_at,
        last_success_at: s.last_success_at,
        health,
      },
      tweets: (recent.data ?? []) as StoredTweet[],
      latestSignal: latest.data as StoredTweet | null,
      totalProcessed: total.count ?? 0,
      relatedCount: related.count ?? 0,
      sourceUrl: sourceUrl(),
    };
  } catch {
    console.error('[Database Error] DASHBOARD_READ_FAILED');
    throw new Error('DASHBOARD_UNAVAILABLE');
  }
}
