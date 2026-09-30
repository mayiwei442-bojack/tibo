import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/monitor/check/route';
import { MonitorError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(), exists: vi.fn(), save: vi.fn(), advance: vi.fn(), finish: vi.fn(),
  scrape: vi.fn(), analyse: vi.fn(),
}));
vi.mock('@/lib/monitor/repository', () => ({
  createMonitorRepository: ({ manual }: { manual: boolean }) => {
    if (!manual) throw new Error('Must use the shared manual cooldown');
    return mocks;
  },
}));
vi.mock('@/lib/twitter/scraper', () => ({ getLatestTweets: mocks.scrape }));
vi.mock('@/lib/deepseek/analyseTweet', () => ({ analyseTweet: mocks.analyse }));

const request = (origin: string | null = 'https://monitor.test') => new Request('https://monitor.test/api/monitor/check', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: '{}',
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.acquire.mockResolvedValue({ acquired: true, latest_tweet_time: null });
  mocks.exists.mockResolvedValue(false);
  mocks.scrape.mockResolvedValue([]);
  mocks.analyse.mockResolvedValue({ related_to_codex: false, category: 'irrelevant', summary: '测试摘要', reset_time: null, important: false });
});
it('rejects cross-site or originless requests before accessing paid services', async () => {
  expect((await POST(request('https://other.test'))).status).toBe(403);
  expect((await POST(request(null))).status).toBe(403);
  expect(mocks.acquire).not.toHaveBeenCalled();
  expect(mocks.scrape).not.toHaveBeenCalled();
});
it('does not scrape or analyse when another visitor is running or the cooldown is active', async () => {
  mocks.acquire.mockResolvedValueOnce({ acquired: false, reason: 'busy' });
  expect((await POST(request())).status).toBe(409);
  mocks.acquire.mockResolvedValueOnce({ acquired: false, reason: 'rate_limited', retry_after_seconds: 241 });
  const response = await POST(request());
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('241');
  expect(mocks.scrape).not.toHaveBeenCalled();
  expect(mocks.analyse).not.toHaveBeenCalled();
});
it('runs scrape, analysis, save and finish for new posts', async () => {
  const tweet = { text: 'Test post', publishedAt: '2026-09-30T01:00:00Z', url: 'https://x.com/test/status/123' };
  mocks.scrape.mockResolvedValue([tweet]);
  const response = await POST(request());
  expect(await response.json()).toEqual({ status: 'complete', processed: 1 });
  expect(mocks.scrape).toHaveBeenCalledWith(null);
  expect(mocks.analyse).toHaveBeenCalledWith(tweet);
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.advance).toHaveBeenCalledOnce();
  expect(mocks.finish).toHaveBeenCalledWith(null);
});
it('completes without AI for no new posts and reports failures without exposing internals', async () => {
  expect(await (await POST(request())).json()).toEqual({ status: 'complete', processed: 0 });
  expect(mocks.analyse).not.toHaveBeenCalled();
  mocks.scrape.mockRejectedValueOnce(new MonitorError('SCRAPER_UNAVAILABLE'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('SCRAPER_UNAVAILABLE');
  expect(mocks.finish).toHaveBeenCalledWith('SCRAPER_UNAVAILABLE');
});
