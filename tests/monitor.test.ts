import { describe, it, expect, vi } from 'vitest';
import {
  checkForNewTweets,
  type MonitorRepository,
} from '@/lib/monitor/checkForNewTweets';
import { MonitorError } from '@/lib/errors';
import type { Analysis } from '@/types/analysis';
import type { Tweet } from '@/types/tweet';

const analysis: Analysis = {
  related_to_codex: false,
  category: 'irrelevant',
  summary: 'A test post.',
  reset_time: null,
  important: false,
};
const post = (id: number, time: string): Tweet => ({
  text: `Test ${id}`,
  publishedAt: time,
  url: `https://x.com/test/status/${id}`,
});
const a = post(1, '2026-09-20T10:00:00Z'),
  b = post(2, '2026-09-20T11:00:00Z'),
  c = post(3, '2026-09-20T12:00:00Z');
function setup(watermark: string | null = null) {
  const saved = new Set<string>();
  const state = { watermark, error: null as string | null, locked: false,
    gap: null as string | null };
  const repository: MonitorRepository = {
    acquire: vi.fn(async () => {
      if (state.locked)
        return { acquired: false, latest_tweet_time: state.watermark };
      state.locked = true;
      return { acquired: true, latest_tweet_time: state.watermark };
    }),
    exists: vi.fn(async (tweet) => saved.has(tweet.url)),
    save: vi.fn(async (tweet) => {
      saved.add(tweet.url);
    }),
    advance: vi.fn(async (time) => {
      state.watermark = time;
    }),
    markCoverageGap: vi.fn(async (oldest) => {
      state.gap = oldest;
    }),
    finish: vi.fn(async (error) => {
      state.error = error;
      if (error === null) state.gap = null;
      state.locked = false;
    }),
  };
  const analyseTweet = vi.fn(async () => analysis);
  const getLatestTweets = vi.fn(async () => ({ tweets: [c, a, b],
    coverageComplete: true, oldestOrdinaryPublishedAt: a.publishedAt }));
  return {
    state,
    saved,
    repository,
    analyseTweet,
    getLatestTweets,
    now: () => 0,
  };
}

describe('timestamp monitor', () => {
  it('handles unordered posts oldest first, one analysis each', async () => {
    const deps = setup();
    expect(await checkForNewTweets(deps)).toEqual({
      status: 'complete',
      processed: 3,
    });
    expect(
      deps.analyseTweet.mock.calls.map(
        (call) => (call as unknown as [Tweet])[0].url,
      ),
    ).toEqual([a.url, b.url, c.url]);
    expect(deps.state.watermark).toBe('2026-09-20T12:00:00.000Z');
  });
  it('does not call AI when no timestamp is newer, including timezone-equivalent timestamps', async () => {
    const deps = setup('2026-09-20T20:00:00+08:00');
    await checkForNewTweets(deps);
    expect(deps.analyseTweet).not.toHaveBeenCalled();
    expect(deps.repository.finish).toHaveBeenCalledWith(null);
  });
  it('stops at an AI failure and retries only unsaved posts', async () => {
    const deps = setup();
    deps.analyseTweet
      .mockResolvedValueOnce(analysis)
      .mockRejectedValueOnce(new MonitorError('ANALYSIS_UNAVAILABLE'));
    await expect(checkForNewTweets(deps)).rejects.toThrow(
      'ANALYSIS_UNAVAILABLE',
    );
    expect(deps.state.watermark).toBe('2026-09-20T10:00:00.000Z');
    expect(deps.saved.has(c.url)).toBe(false);
    await checkForNewTweets(deps);
    expect(deps.analyseTweet).toHaveBeenCalledTimes(4);
    expect(deps.saved.size).toBe(3);
  });
  it('does not skip same-time siblings after a failure', async () => {
    const deps = setup();
    const sibling = post(4, a.publishedAt);
    deps.getLatestTweets.mockResolvedValue({ tweets: [sibling, a, b], coverageComplete: true,
      oldestOrdinaryPublishedAt: a.publishedAt });
    deps.analyseTweet
      .mockResolvedValueOnce(analysis)
      .mockRejectedValueOnce(new MonitorError('ANALYSIS_UNAVAILABLE'));
    await expect(checkForNewTweets(deps)).rejects.toThrow();
    expect(deps.state.watermark).toBeNull();
    expect(deps.saved.has(a.url)).toBe(true);
    await checkForNewTweets(deps);
    expect(deps.saved.size).toBe(3);
    expect(deps.analyseTweet).toHaveBeenCalledTimes(4);
  });
  it('retains the old cursor on save failure', async () => {
    const deps = setup();
    vi.mocked(deps.repository.save).mockRejectedValueOnce(
      new MonitorError('DATABASE_OPERATION_FAILED'),
    );
    await expect(checkForNewTweets(deps)).rejects.toThrow();
    expect(deps.repository.advance).not.toHaveBeenCalled();
    expect(deps.analyseTweet).toHaveBeenCalledTimes(1);
  });
  it('does not repeat AI after cursor-write failure if the tweet was saved', async () => {
    const deps = setup();
    vi.mocked(deps.repository.advance).mockRejectedValueOnce(
      new MonitorError('DATABASE_OPERATION_FAILED'),
    );
    await expect(checkForNewTweets(deps)).rejects.toThrow();
    await checkForNewTweets(deps);
    expect(deps.analyseTweet).toHaveBeenCalledTimes(3);
  });
  it('never advances after a scraping failure', async () => {
    const deps = setup(a.publishedAt);
    deps.getLatestTweets.mockRejectedValue(
      new MonitorError('SCRAPER_UNAVAILABLE'),
    );
    await expect(checkForNewTweets(deps)).rejects.toThrow();
    expect(deps.state.watermark).toBe(a.publishedAt);
    expect(deps.analyseTweet).not.toHaveBeenCalled();
  });
  it('deduplicates URL observations before AI', async () => {
    const deps = setup();
    deps.getLatestTweets.mockResolvedValue({ tweets: [a, a, b], coverageComplete: true,
      oldestOrdinaryPublishedAt: a.publishedAt });
    await checkForNewTweets(deps);
    expect(deps.analyseTweet).toHaveBeenCalledTimes(2);
  });
  it('rejects conflicting duplicate URLs before processing', async () => {
    const deps = setup();
    deps.getLatestTweets.mockResolvedValue({ tweets: [
      a,
      { ...a, publishedAt: b.publishedAt },
    ], coverageComplete: true, oldestOrdinaryPublishedAt: a.publishedAt });
    await expect(checkForNewTweets(deps)).rejects.toThrow(
      'SCRAPER_CONFLICTING_DATA',
    );
    expect(deps.analyseTweet).not.toHaveBeenCalled();
  });
  it('does not scrape during an overlapping run', async () => {
    const deps = setup();
    deps.state.locked = true;
    expect((await checkForNewTweets(deps)).status).toBe('busy');
    expect(deps.getLatestTweets).not.toHaveBeenCalled();
  });
  it('defers work without advancing when the runtime budget is low', async () => {
    const deps = setup();
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(200000);
    expect((await checkForNewTweets({ ...deps, now })).status).toBe('deferred');
    expect(deps.analyseTweet).not.toHaveBeenCalled();
    expect(deps.state.watermark).toBeNull();
  });
  it('saves visible posts during incomplete coverage without advancing the cursor or repeating AI', async () => {
    const deps = setup('2026-09-19T07:39:00Z');
    deps.getLatestTweets.mockResolvedValue({ tweets: [c, a, b],
      coverageComplete: false, oldestOrdinaryPublishedAt: a.publishedAt });
    expect(await checkForNewTweets(deps)).toEqual({ status: 'partial', processed: 3 });
    expect(deps.state.watermark).toBe('2026-09-19T07:39:00Z');
    expect(deps.state.gap).toBe(a.publishedAt);
    expect(deps.state.error).toBe('TIMELINE_COVERAGE_INCOMPLETE');
    expect(deps.repository.advance).not.toHaveBeenCalled();
    expect(deps.analyseTweet).toHaveBeenCalledTimes(3);
    expect(await checkForNewTweets(deps)).toEqual({ status: 'partial', processed: 0 });
    expect(deps.analyseTweet).toHaveBeenCalledTimes(3);
    deps.getLatestTweets.mockResolvedValue({ tweets: [c, a, b],
      coverageComplete: true, oldestOrdinaryPublishedAt: a.publishedAt });
    await checkForNewTweets(deps);
    expect(deps.state.gap).toBeNull();
    expect(deps.state.watermark).toBe(c.publishedAt.replace('Z', '.000Z'));
    expect(deps.analyseTweet).toHaveBeenCalledTimes(3);
  });
});
