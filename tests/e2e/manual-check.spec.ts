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
      state: { latest_tweet_time: null, last_check_at: '2026-09-30T01:00:00Z', last_success_at: '2026-09-30T01:00:00Z', health: 'healthy' },
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
