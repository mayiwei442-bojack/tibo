import type { MonitorHealth } from '@/types/dashboard';

// Ninety-minute schedule plus 30 minutes for a delayed or long-running check.
export const MONITOR_STALE_AFTER_MS = 120 * 60_000;

export function monitorHealth(
  lastError: string | null,
  lastSuccessAt: string | null,
  now = Date.now(),
): MonitorHealth {
  if (lastError) return 'degraded';
  if (!lastSuccessAt) return 'waiting';
  return now - Date.parse(lastSuccessAt) > MONITOR_STALE_AFTER_MS
    ? 'stale'
    : 'healthy';
}
