import { test as base, expect } from '@playwright/test';

// UI tests must never trigger real Cloud Run/DeepSeek work.
export const test = base.extend<{ mockManualChecks: void }>({
  mockManualChecks: [async ({ page }, use) => {
    await page.route('**/api/monitor/check', route => route.fulfill({
      json: { status: 'complete', processed: 0 },
    }));
    await use();
  }, { auto: true }],
});
export { expect };
