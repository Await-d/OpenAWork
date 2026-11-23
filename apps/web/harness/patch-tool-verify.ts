/** 仓库根目录运行：NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/patch-tool-verify.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = await import('playwright');
const outputDir = resolve('apps/web/harness/patch-tool-artifacts');
await mkdir(outputDir, { recursive: true });
const results: { name: string; passed: boolean; detail?: string }[] = [];
const screenshots: string[] = [];
function check(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail });
}

const browser = await chromium.launch({ headless: true });
console.log(`Chromium ${browser.version()}`);
try {
  for (const mode of ['dark', 'light']) {
    for (const width of [375, 768, 1440]) {
      const prefix = `${mode}/${width}`;
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        colorScheme: mode === 'dark' ? 'dark' : 'light',
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:5173/harness/patch-tool.html?mode=${mode}`, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      await page.waitForLoadState('networkidle');
      await page.locator('[data-case="rich"] .patch-preview').waitFor();
      const overflow = () =>
        page.evaluate(() => ({
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
      const initialOverflow = await overflow();
      check(
        `${prefix} collapsed page overflow`,
        initialOverflow.scroll <= width,
        JSON.stringify(initialOverflow),
      );
      for (const id of ['completed', 'rich', 'running', 'failed']) {
        const section = page.locator(`[data-case="${id}"]`);
        // 实际路由卡片的 disclosure 使用 aria-expanded；文件内部使用原生 details/summary。
        const disclosure = section.locator('button[aria-expanded]').first();
        check(`${prefix} ${id} has accessible disclosure`, (await disclosure.count()) === 1);
        const initial = await disclosure.getAttribute('aria-expanded');
        await disclosure.click();
        check(
          `${prefix} ${id} outer toggle`,
          (await disclosure.getAttribute('aria-expanded')) !== initial,
        );
        if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
        const files = section.locator('details');
        check(
          `${prefix} ${id} exactly four files`,
          (await files.count()) === 4,
          `count=${await files.count()}`,
        );
        for (let index = 0; index < (await files.count()); index++) {
          const file = files.nth(index);
          await file.locator('summary').click();
          check(
            `${prefix} ${id} file ${index} expands`,
            (await file.getAttribute('open')) !== null,
          );
        }
        if (id === 'running' || id === 'failed') {
          check(
            `${prefix} ${id} header does not claim applied`,
            !(await disclosure.innerText()).includes('已应用'),
            await disclosure.innerText(),
          );
        }
        const text = await section.innerText();
        check(
          `${prefix} ${id} state semantics`,
          id === 'running'
            ? text.includes('等待补丁结果')
            : id === 'failed'
              ? text.includes('补丁失败')
              : text.includes('补丁已应用'),
        );
        check(`${prefix} ${id} deletion semantics`, text.includes('删除整个文件'));
      }
      const rich = page.locator('[data-case="rich"]');
      check(
        `${prefix} snapshot truncation notice`,
        (await rich.innerText()).includes('结果快照已截断'),
      );
      check(
        `${prefix} exact changed lines`,
        (await rich.innerText()).includes('export const value = 2;'),
      );
      const expandedOverflow = await overflow();
      check(
        `${prefix} expanded page overflow`,
        expandedOverflow.scroll <= width,
        JSON.stringify(expandedOverflow),
      );
      const focus = rich.locator('summary').first();
      await focus.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const ring = await focus.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outline: style.outline,
          shadow: style.boxShadow,
          visible: element.matches(':focus-visible'),
        };
      });
      check(
        `${prefix} keyboard focus visible`,
        ring.visible &&
          ((!ring.outline.startsWith('none') && !ring.outline.includes(' 0px')) ||
            ring.shadow !== 'none'),
        JSON.stringify(ring),
      );
      await page.keyboard.press('Enter');
      check(
        `${prefix} keyboard summary toggles`,
        (await rich.locator('details').first().getAttribute('open')) === null,
      );
      await page.keyboard.press('Enter');
      const screenshot = `${outputDir}/patch-tool-${mode}-${width}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshots.push(screenshot);
      check(`${prefix} no browser exceptions`, errors.length === 0, errors.join('\n'));
      console.log(
        `${prefix}: ${results.filter((item) => item.name.startsWith(prefix) && item.passed).length} passed / ${results.filter((item) => item.name.startsWith(prefix) && !item.passed).length} failed; pageWidth=${expandedOverflow.scroll}; screenshot=${screenshot}`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
const passed = results.filter((item) => item.passed).length;
const failed = results.length - passed;
await writeFile(
  `${outputDir}/patch-tool-results.json`,
  JSON.stringify({ passed, failed, results, screenshots }, null, 2),
);
console.log(`${passed} passed / ${failed} failed`);
for (const item of results.filter((result) => !result.passed))
  console.log(`FAIL ${item.name}: ${item.detail ?? ''}`);
process.exitCode = failed ? 1 : 0;
