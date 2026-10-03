import type { StoredTweet } from './tweet';

export type MonitorHealth =
  'unconfigured' | 'waiting' | 'healthy' | 'degraded' | 'stale';
export interface DashboardData {
  state: {
    latest_tweet_time: string | null;
    last_check_at: string | null;
    last_success_at: string | null;
    coverage_gap_oldest_seen: string | null;
    update_version: number;
    health: MonitorHealth;
  };
  latestSignal: StoredTweet | null;
  latestResetSignal?: StoredTweet | null;
  tweets: StoredTweet[];
  totalProcessed: number;
  relatedCount: number;
  sourceUrl: string | null;
}
