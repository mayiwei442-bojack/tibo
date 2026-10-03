import { expect, test } from './fixtures';

test('manual check waits for the pipeline then reads the dashboard; visibility only reads data', async ({ page }) => {
  let release!: () => void;
  const finished = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  await page.route('**/api/monitor/check', async route => {
    expect(route.request().method()).toBe('POST');
    calls.push('check');
    await finished;
    await route.fulfill({ json: { status: 'complete', processed: 0 } });
  });
  await page.route('**/api/dashboard', async route => {
    calls.push('dashboard');
    await route.fulfill({ json: {
      state: { latest_tweet_time: null, last_check_at: '2026-09-30T01:00:00Z',
        last_success_at: '2026-09-30T01:00:00Z', coverage_gap_oldest_seen: null,
        update_version: 1, health: 'healthy' },
      tweets: [], latestSignal: null, latestResetSignal: null, totalProcessed: 0, relatedCount: 0, sourceUrl: null,
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '检查并刷新' }).click();
  await expect(page.getByRole('button', { name: '正在检查 X' })).toBeDisabled();
  expect(calls).toEqual(['check']);
  release();
  await expect(page.getByText('检查完成，没有发现新推文。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查并刷新' })).toBeEnabled();
  expect(calls).toEqual(['check', 'dashboard']);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => calls.length).toBe(3);
  expect(calls).toEqual(['check', 'dashboard', 'dashboard']);
});

test('partial check shows saved posts and an explicit unverified history interval', async ({ page }) => {
  const cursor = '2026-09-29T07:39:00Z';
  const oldest = '2026-09-29T21:05:00Z';
  const tweet = { id: 'partial-post', tweet_url: 'https://x.com/test/status/123',
    tweet_text: 'Codex update', published_at: oldest, scraped_at: oldest, created_at: oldest,
    related_to_codex: true, category: 'service_change', summary: 'Codex 服务更新。',
    reset_time: null, important: true, reset_status: 'unknown' };
  await page.route('**/api/monitor/check', route => route.fulfill({ status: 202,
    json: { status: 'partial', processed: 1 } }));
  await page.route('**/api/dashboard', route => route.fulfill({ json: {
    state: { latest_tweet_time: cursor, last_check_at: oldest, last_success_at: cursor,
      coverage_gap_oldest_seen: oldest, update_version: 2, health: 'degraded' },
    tweets: [tweet], latestSignal: tweet, latestResetSignal: null,
    totalProcessed: 1, relatedCount: 1, sourceUrl: 'https://x.com/test',
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: '检查并刷新' }).click();
  await expect(page.getByText(/历史覆盖未核实/)).toContainText('2026-09-29 07:39:00 UTC');
  await expect(page.getByText(/历史覆盖未核实/)).toContainText('2026-09-29 21:05:00 UTC');
  await expect(page.locator('.tweet-card')).toContainText('Codex update');
  await expect(page.getByText(/已处理 1 条当前可见的新推文/)).toBeVisible();
});

test('cooldown is explained and existing dashboard data is still loaded', async ({ page }) => {
  await page.route('**/api/monitor/check', route => route.fulfill({
    status: 429, headers: { 'Retry-After': '121' },
    json: { status: 'rate_limited', processed: 0, retryAfterSeconds: 121 },
  }));
  await page.route('**/api/dashboard', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto('/');
  await page.getByRole('button', { name: '检查并刷新' }).click();
  await expect(page.getByText(/请约 3 分钟后重试/)).toBeVisible();
  await expect(page.getByText(/当前显示上次加载的内容/)).toBeVisible();
});
