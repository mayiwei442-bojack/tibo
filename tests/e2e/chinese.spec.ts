import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3102' });

test('Chinese interface keeps English posts and toggles translation without requests', async ({ page }, testInfo) => {
  const stamp = '2026-09-27T00:00:00Z';
  const tweet = {
    id: 'zh-fixture', tweet_url: 'https://x.com/test/status/123',
    tweet_text: 'We will reset Codex usage limits soon. No exact time yet.',
    summary: 'Tibo 宣布即将进行 Codex Reset，但尚未说明具体时间。',
    tweet_translation: '我们很快会重置 Codex usage limits。目前还没有确切时间。',
    category: 'reset', related_to_codex: true, important: true, reset_status: 'upcoming',
    reset_time: null, published_at: stamp, scraped_at: stamp, created_at: stamp,
  };
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/api/')) requests++; });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/dashboard', route => route.fulfill({ json: {
    state: { last_check_at: stamp, last_success_at: stamp, latest_tweet_time: stamp, health: 'healthy' },
    tweets: [tweet, { ...tweet, id: 'untranslated', tweet_url: 'https://x.com/test/status/124', tweet_translation: null }],
    latestSignal: tweet, latestResetSignal: tweet, totalProcessed: 2, relatedCount: 2,
    sourceUrl: 'https://x.com/test',
  } }));
  await page.goto('/');
  await expect(page.locator('.clock')).not.toContainText('—');
  await page.getByRole('button', { name: '刷新页面' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.signal-title')).toHaveText(tweet.summary);
  const card = page.locator('.tweet-card').first();
  await expect(card.locator('.tweet-text')).toHaveText(tweet.tweet_text);
  await expect(card.locator('.tweet-summary')).toContainText('AI 摘要');
  await expect(card.locator('.tweet-translation')).toBeHidden();
  const before = requests;
  await card.getByRole('button', { name: '翻译成中文' }).click();
  await expect(card.getByRole('button', { name: '收起译文' })).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.tweet-translation')).toContainText(tweet.tweet_translation);
  await expect(card.locator('.tweet-text')).toHaveText(tweet.tweet_text);
  await page.screenshot({ path: `artifacts/chinese-${testInfo.project.name}.png`, fullPage: true });
  await card.getByRole('button', { name: '收起译文' }).click();
  await expect(card.locator('.tweet-translation')).toBeHidden();
  await card.getByRole('button', { name: '翻译成中文' }).click();
  expect(requests).toBe(before);
  const legacy = page.locator('.tweet-card').nth(1);
  await legacy.getByRole('button', { name: '翻译成中文' }).click();
  await expect(legacy.locator('.tweet-translation')).toContainText('暂未保存译文');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
