import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysisSchema } from '@/lib/deepseek/schema';
import { analyseTweet } from '@/lib/deepseek/analyseTweet';
import { isCronAuthorized } from '@/lib/cron-auth';
import { validateTweets } from '@/lib/twitter/validation';

const analysis = {
  related_to_codex: true,
  category: 'reset',
  summary: 'Reset announced without a time.',
  reset_time: null,
  important: true,
  reset_status: 'upcoming',
  tweet_translation: '即将进行 Codex Reset。',
};
const tweet = {
  text: 'Codex resets soon.',
  publishedAt: '2026-09-20T10:00:00Z',
  url: 'https://x.com/test/status/123',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('strict contracts', () => {
  it('accepts Chinese summary and translation with a null reset time', () =>
    expect(analysisSchema.safeParse(analysis).success).toBe(true));
  it.each([
    { ...analysis, confidence: 0.8 },
    { ...analysis, category: 'made_up' },
    { ...analysis, reset_time: 'soon' },
    { ...analysis, important: 'true' },
    { ...analysis, related_to_codex: false },
    { ...analysis, reset_status: undefined },
    { ...analysis, tweet_translation: '' },
    { ...analysis, tweet_translation: undefined },
    { ...analysis, reset_status: 'possible' },
    { ...analysis, category: 'other' },
  ])('rejects invalid or extra analysis fields', (value) =>
    expect(analysisSchema.safeParse(value).success).toBe(false),
  );
  it('fails closed for missing cron config and wrong tokens', () => {
    expect(isCronAuthorized('Bearer undefined', undefined)).toBe(false);
    expect(isCronAuthorized('Bearer short', 'short')).toBe(false);
    expect(isCronAuthorized(`Bearer ${'b'.repeat(32)}`, 'a'.repeat(32))).toBe(
      false,
    );
    expect(isCronAuthorized(`Bearer ${'a'.repeat(32)}`, 'a'.repeat(32))).toBe(
      true,
    );
  });
  it('normalizes URLs and deduplicates observations', () => {
    expect(
      validateTweets(
        [tweet, { ...tweet, url: `${tweet.url}?s=20` }],
        'https://x.com/test',
        Date.parse(tweet.publishedAt),
      ),
    ).toHaveLength(1);
  });
  it.each(
    [
      [],
      [{ ...tweet, text: '' }],
      [{ ...tweet, url: 'https://evil.test/test/status/123' }],
      [{ ...tweet, url: 'https://x.com/another/status/123' }],
      [{ ...tweet, publishedAt: 'invalid' }],
    ].map((input) => ({ input })),
  )('rejects empty/incomplete/untrusted scraper data', ({ input }) =>
    expect(() => validateTweets(input, 'https://x.com/test')).toThrow(),
  );
  it('rejects future posts', () =>
    expect(() => validateTweets([tweet], 'https://x.com/test', 0)).toThrow());
  it('sends exactly one post in JSON mode and validates the provider response', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-not-real');
    const mock = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(analysis) },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', mock);
    expect(await analyseTweet(tweet)).toEqual(analysis);
    const request = JSON.parse(mock.mock.calls[0][1].body);
    expect(request.messages).toHaveLength(2);
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(JSON.parse(request.messages[1].content).text).toBe(tweet.text);
    expect(request.tools).toBeUndefined();
  });
  it('rejects truncated completion even if it happens to contain valid JSON', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            choices: [
              {
                finish_reason: 'length',
                message: { content: JSON.stringify(analysis) },
              },
            ],
          }),
        ),
    );
    await expect(analyseTweet(tweet)).rejects.toThrow(
      'ANALYSIS_INVALID_RESPONSE',
    );
  });
  it('never exposes provider errors', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('secret provider details', { status: 401 }),
        ),
    );
    await expect(analyseTweet(tweet)).rejects.toThrow('ANALYSIS_UNAVAILABLE');
  });
});
