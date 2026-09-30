import { expect, test } from './fixtures';
test.use({ baseURL: 'http://localhost:3102' });

for (const mode of ['completed', 'upcoming', 'possible', 'unknown'] as const) {
  test(`LED ${mode} with responsive layout`, async ({ page }, testInfo) => {
    const signal = {
      id: 'fixture-reset', tweet_url: 'https://x.com/test/status/123',
      tweet_text: 'Fixture only', published_at: '2026-09-30T23:00:00Z',
      scraped_at: '2026-09-30T23:00:00Z', created_at: '2026-09-30T23:00:00Z',
      related_to_codex: true, category: 'reset', summary: 'Fixture reset signal.',
      reset_status: mode, reset_time: mode === 'upcoming' ? '2026-10-01T00:01:00Z' : null,
      important: mode !== 'possible',
    };
    const data = {
      state: { latest_tweet_time: signal.published_at, last_check_at: signal.published_at,
        last_success_at: signal.published_at, health: 'healthy' },
      latestSignal: signal, latestResetSignal: signal, tweets: [signal],
      totalProcessed: 1, relatedCount: 1, sourceUrl: 'https://x.com/test',
    };
    await page.route('**/api/dashboard', route => route.fulfill({ json: data }));
    await page.goto('/');
  await expect(page.locator('.clock')).not.toContainText('—');
    await expect(page.locator('.clock')).not.toContainText('—');
    await page.clock.install({ time: new Date('2026-10-01T00:00:00Z') });
    await page.getByRole('button', { name: '检查并刷新' }).click();
    const panel = page.getByRole('complementary', { name: 'Reset 状态显示屏' });
    await expect(panel).toHaveAttribute('data-mode', mode);
    await expect(panel).toBeVisible();
    await expect(page.locator('.metric').nth(1)).toContainText('90分钟');
    await expect(page.locator('footer')).toContainText(/新推文入库后自动更新|自动更新连接中|打开或切回页面时读取最新数据/);
    if (mode === 'upcoming') {
      await page.clock.runFor(2000);
      await expect(panel.getByRole('timer')).not.toContainText('--');
      await page.screenshot({ path: `artifacts/led-${mode}-${testInfo.project.name}.png`, fullPage: true });
      await page.clock.runFor(61000);
      await expect(panel).toContainText('等待重置完成确认');
      await expect(panel).toHaveAttribute('data-mode', 'upcoming');
      signal.reset_time = null;
      await page.getByRole('button', { name: '检查并刷新' }).click();
      await expect(panel.getByRole('timer')).toHaveCount(0);
      await expect(panel).toContainText('具体时间尚未说明');
    } else {
      await expect(panel.getByRole('timer')).toHaveCount(0);
      await page.screenshot({ path: `artifacts/led-${mode}-${testInfo.project.name}.png`, fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
