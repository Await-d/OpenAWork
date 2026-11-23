/** NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-composer-counter.ts */
const { chromium } = await import('playwright');
const base = process.env.COMPOSER_COUNTER_HARNESS_URL ?? 'http://127.0.0.1:5198';
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 500 } });
    await page.goto(`${base}/harness/composer-counter.html`);
    await page.locator('.composer-character-count').first().waitFor();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      rows: [...document.querySelectorAll('.composer-toolbar-right')].map((element) => {
        const counter = element.querySelector('.composer-character-count')!;
        const actions = element.querySelector('.composer-primary-actions')!;
        const count = counter.getBoundingClientRect();
        const action = actions.getBoundingClientRect();
        return {
          sameRow: count.top >= action.top && count.bottom <= action.bottom,
          noOverlap: count.right <= action.left,
          right: element.getBoundingClientRect().right,
        };
      }),
    }));
    if (
      layout.overflow ||
      layout.rows.length !== 2 ||
      layout.rows.some((row) => !row.sameRow || !row.noOverlap || row.right > width)
    ) {
      throw new Error(`${width}px 字符计数布局失败：${JSON.stringify(layout)}`);
    }
    console.info(`${width}px：正常和超限计数与发送按钮同行，无重叠、无横向溢出`);
    await page.close();
  }
} finally {
  await browser.close();
}
