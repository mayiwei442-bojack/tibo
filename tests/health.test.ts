import { describe, expect, it } from 'vitest';
import { monitorHealth } from '@/lib/monitor/health';

const checkedAt = '2026-09-27T08:00:00Z';
const checkedAtMs = Date.parse(checkedAt);

describe('monitor health for the two-hour schedule', () => {
  it('stays healthy until the next check has had 30 minutes of grace', () => {
    expect(monitorHealth(null, checkedAt, checkedAtMs + 149 * 60_000)).toBe(
      'healthy',
    );
    expect(monitorHealth(null, checkedAt, checkedAtMs + 151 * 60_000)).toBe(
      'stale',
    );
  });

  it('reports a failed check immediately and waits before the first success', () => {
    expect(monitorHealth('SCRAPER_UNAVAILABLE', checkedAt, checkedAtMs)).toBe(
      'degraded',
    );
    expect(monitorHealth(null, null, checkedAtMs)).toBe('waiting');
  });
});
