import { describe, expect, it } from 'vitest';
import { countdownParts, hasNewTweetVersion } from '@/lib/monitor/display';

describe('Realtime dashboard version', () => {
  it('refreshes only for a newer tweet, not an equivalent timestamp spelling', () => {
    expect(hasNewTweetVersion('2026-09-30T09:00:00Z', '2026-09-30T17:00:00+08:00')).toBe(false);
    expect(hasNewTweetVersion('2026-09-30T09:01:00Z', '2026-09-30T09:00:00.000+00:00')).toBe(true);
    expect(hasNewTweetVersion(null, null)).toBe(false);
    expect(hasNewTweetVersion('invalid', null)).toBe(false);
  });
});

describe('announced reset countdown', () => {
  const target = '2026-10-01T00:00:00Z';
  it('does not invent a countdown without an explicit time or client clock', () => {
    expect(countdownParts(null, Date.now())).toBeNull();
    expect(countdownParts('soon', Date.now())).toBeNull();
    expect(countdownParts(target, null)).toBeNull();
  });
  it('uses the absolute instant with days, hours, minutes, seconds', () => {
    expect(countdownParts(target, Date.parse(target) - 90061000)).toEqual({ expired: false, values: ['01','01','01','01'] });
    expect(countdownParts('2026-10-01T08:00:00+08:00', Date.parse(target) - 1000)?.values).toEqual(['00','00','00','01']);
  });
  it('clamps elapsed times to zero; never claims completion', () => {
    expect(countdownParts(target, Date.parse(target) + 1000)).toEqual({ expired: true, values: ['00','00','00','00'] });
  });
});
