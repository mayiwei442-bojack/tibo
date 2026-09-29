import { expect, test } from '@playwright/test';
test.use({ baseURL: 'http://localhost:3102' });

test('honest initial state and no unauthorized Cron', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.clock')).not.toContainText('—');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    '关注每一次Codex Reset.',
  );
  await expect(
    page.getByText('等待连接', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('原文未明确说明', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('首次检查后，这里将显示推文。'),
  ).toBeVisible();
  expect((await request.get('/api/cron/check-tibo')).status()).toBe(401);
  await page.getByRole('button', { name: 'Codex 相关' }).click();
  await expect(
    page.getByRole('button', { name: 'Codex 相关' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '刷新页面' }).click();
  await expect(
    page.getByRole('button', { name: '刷新页面' }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `artifacts/dashboard-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('saved signals, filters, safe links and refresh failure', async ({
  page,
}) => {
  const timestamp = '2026-09-20T10:00:00Z';
  const signal = {
    id: 'test-signal',
    tweet_url: 'https://x.com/test/status/123',
    tweet_text: 'Test fixture: Codex limits will reset soon.',
    published_at: timestamp,
    scraped_at: timestamp,
    created_at: timestamp,
    related_to_codex: true,
    category: 'reset',
    summary: 'Test fixture summary: a reset is announced without a time.',
    reset_time: null,
    important: true,
  };
  const irrelevant = {
    ...signal,
    id: 'test-other',
    tweet_url: 'https://x.com/test/status/124',
    tweet_text: 'Test fixture: coffee.',
    related_to_codex: false,
    category: 'irrelevant',
    summary: 'A test coffee post.',
    important: false,
  };
  let fail = false;
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({
      status: fail ? 503 : 200,
      json: fail
        ? { error: 'Unavailable' }
        : {
            state: {
              latest_tweet_time: timestamp,
              last_check_at: timestamp,
              last_success_at: timestamp,
              health: 'healthy',
            },
            tweets: [signal, irrelevant],
            latestSignal: signal,
            sourceUrl: 'https://x.com/test',
            totalProcessed: 2,
            relatedCount: 1,
          },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '刷新页面' }).click();
  await expect(
    page.getByText('检测到 Reset 信息', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.tweet-card')).toHaveCount(2);
  await page.getByRole('button', { name: '重要更新', exact: true }).click();
  await expect(page.locator('.tweet-card')).toHaveCount(1);
  await expect(
    page.getByRole('link', { name: '查看消息原文' }),
  ).toHaveAttribute('href', signal.tweet_url);
  await expect(
    page.getByText('原文未明确说明', { exact: true }),
  ).toBeVisible();
  fail = true;
  await page.getByRole('button', { name: '刷新页面' }).click();
  await expect(page.getByRole('status')).toContainText(
    '当前显示上次加载的内容',
  );
  await expect(
    page.getByText('检测到 Reset 信息', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
