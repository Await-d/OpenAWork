/** 为原有只监听 pageerror 的回归补充 console.error 采集。 */
import { writeFile } from 'node:fs/promises';
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const results: {
  harness: string;
  mode: string;
  width: number;
  consoleErrors: string[];
  pageErrors: string[];
}[] = [];
try {
  for (const harness of ['patch-tool', 'list-directory']) {
    for (const mode of ['dark', 'light']) {
      for (const width of [375, 768, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const consoleErrors: string[] = [],
          pageErrors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(`http://127.0.0.1:5173/harness/${harness}.html?mode=${mode}`, {
          waitUntil: 'networkidle',
        });
        await page.locator('[data-case]').first().waitFor();
        for (const section of await page.locator('[data-case]').all()) {
          const disclosure = section.locator('[aria-expanded]').first();
          if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
        }
        results.push({ harness, mode, width, consoleErrors, pageErrors });
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  'apps/web/harness/skill-tool-artifacts/skill-tool-regression-console.json',
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results));
process.exitCode = results.some((r) => r.consoleErrors.length || r.pageErrors.length) ? 1 : 0;
