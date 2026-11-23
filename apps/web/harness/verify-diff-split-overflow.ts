/**
 * 双栏 diff 窄屏重叠回归：真实 Chromium 下测量左右两栏是否互相侵入。
 *
 * 运行：NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-diff-split-overflow.ts
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-diff-split-overflow.ts',
  );
  process.exit(1);
}

const BASE = process.env.DIFF_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/diff-split-artifacts';

const LONG_LINE =
  "const result = await import('./a-very-long-module-name-that-keeps-going-and-going/and-another-segment/index.js');";

const before = ['line 1', LONG_LINE, 'line 3', 'const tail = 1;'].join('\n');
const after = ['line 1', `${LONG_LINE} // changed`, 'line 3', 'const tail = 2;'].join('\n');

const browser = await chromium.launch();
const results: string[] = [];

for (const width of [375, 768, 1024, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(`${BASE}/harness/diff-split-overflow.html`, { waitUntil: 'load' });
  await page.waitForSelector('[data-diff-view-mode]', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(400);

  const container = page.locator('[data-diff-view-mode]').first();
  const mode = await container.getAttribute('data-diff-view-mode');

  // 取每一行左右两个单元格的右/左边界，判断是否互相侵入。
  const overlap = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-diff-row="change"]'));
    let worst = 0;
    for (const row of rows) {
      const cells = row.querySelectorAll(':scope > div');
      if (cells.length < 2) continue;
      const left = cells[0]?.getBoundingClientRect();
      const right = cells[1]?.getBoundingClientRect();
      if (!left || !right) continue;
      // 左栏内容（pre）是否越过左栏自身右边界
      const leftPre = cells[0]?.querySelector('pre')?.getBoundingClientRect();
      if (leftPre) worst = Math.max(worst, leftPre.right - left.right);
    }
    return worst;
  });

  const docOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  await page.locator('body').screenshot({ path: `${OUT_DIR}/diff-${width}.png` });
  results.push(
    `### ${width}px · 布局=${mode}\n- 左栏内容越过栏位: ${overlap.toFixed(1)}px（>0 即重叠）\n- 页面横向溢出: ${docOverflow}px\n- 页面异常: ${errors.length ? errors.join(' | ') : '无'}`,
  );
  await page.close();
}

await browser.close();
console.log(`样例 before/after 已内置长 import 行（${LONG_LINE.length} 字符）\n`);
console.log(results.join('\n\n'));
