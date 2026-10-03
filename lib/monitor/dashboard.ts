import 'server-only';
import { createServerDatabase } from '@/lib/supabase/server';
import { sourceUrl } from '@/lib/config';
import { monitorHealth } from '@/lib/monitor/health';
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
      coverage_gap_oldest_seen: null,
      update_version: 0,
      health,
    },
    latestSignal: null,
    latestResetSignal: null,
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
    async function readRecent() {
      const query = (fields: string) => db.from('tweets').select(fields)
        .order('published_at', { ascending: false }).order('id', { ascending: false }).limit(30);
      const result = await query(`${columns},tweet_translation`);
      return result.error?.code === '42703' ? query(columns) : result;
    }
    async function readReset() {
      const query = (fields: string) => db.from('tweets').select(fields)
        .eq('related_to_codex', true).eq('category', 'reset')
        .order('published_at', { ascending: false }).order('id', { ascending: false })
        .limit(1).maybeSingle();
      const result = await query(`${columns},reset_status`);
      // Rolling upgrades: legacy rows/schema remain readable, never guessed.
      return result.error?.code === '42703' ? query(columns) : result;
    }
    async function readState() {
      const query = (fields: string) => db.from('monitor_state')
        .select(fields).eq('id', 1).single();
      const result = await query('latest_tweet_time,last_check_at,last_success_at,last_error,coverage_gap_oldest_seen');
      return result.error?.code === '42703'
        ? query('latest_tweet_time,last_check_at,last_success_at,last_error') : result;
    }
    async function readUpdate() {
      const query = (fields: string) => db.from('dashboard_updates')
        .select(fields).eq('id', 1).single();
      const result = await query('version');
      return result.error?.code === '42703' ? query('latest_tweet_time') : result;
    }
    const [state, recent, latest, total, related, reset, update] = await Promise.all([
      readState(),
      readRecent(),
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
      readReset(),
      readUpdate(),
    ]);
    if ([state, recent, latest, total, related, reset, update].some((result) => result.error))
      throw new Error('DATABASE_READ_FAILED');
    const s = state.data! as unknown as { latest_tweet_time: string | null;
      last_check_at: string | null; last_success_at: string | null;
      last_error: string | null; coverage_gap_oldest_seen?: string | null };
    const health = monitorHealth(s.last_error, s.last_success_at);
    return {
      state: {
        latest_tweet_time: s.latest_tweet_time,
        last_check_at: s.last_check_at,
        last_success_at: s.last_success_at,
        coverage_gap_oldest_seen: s.coverage_gap_oldest_seen ?? null,
        update_version: Number((update.data as { version?: number }).version ?? 0),
        health,
      },
      tweets: (recent.data ?? []) as unknown as StoredTweet[],
      latestSignal: latest.data as StoredTweet | null,
      latestResetSignal: reset.data as unknown as StoredTweet | null,
      totalProcessed: total.count ?? 0,
      relatedCount: related.count ?? 0,
      sourceUrl: sourceUrl(),
    };
  } catch {
    console.error('[Database Error] DASHBOARD_READ_FAILED');
    throw new Error('DASHBOARD_UNAVAILABLE');
  }
}
