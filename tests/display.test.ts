import { describe, expect, it } from 'vitest';
import { countdownParts } from '@/lib/monitor/display';

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
