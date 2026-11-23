/** NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/file-change-verify.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 与现有 harness 一样由 NODE_PATH 定位唯一声明 Playwright 的 workspace。
const playwrightModule = 'playwright';
const { chromium } = await import(playwrightModule);
const baseUrl = process.env.FILE_CHANGE_BASE_URL ?? 'http://127.0.0.1:5174';
const outputDir = resolve('apps/web/harness/file-change-artifacts');
await mkdir(outputDir, { recursive: true });
const results: { name: string; passed: boolean; detail?: string }[] = [];
const screenshots: string[] = [];
function check(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail });
}
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['dark', 'light'] as const) {
    for (const width of [375, 768, 1440]) {
      const prefix = `${mode}/${width}`;
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        colorScheme: mode,
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.goto(`${baseUrl}/harness/file-change.html?mode=${mode}`, {
        waitUntil: 'networkidle',
        timeout: 120000,
      });
      await page.locator('[data-case="generic"] .file-change-result').first().waitFor();
      const fixtures: { id: string; output: unknown; complete: boolean[]; diff?: boolean[] }[] =
        await page.evaluate(async () => {
          const url = '/harness/file-change-fixtures.ts';
          return (await import(url)).cases;
        });
      const overflow = async (stage: string) => {
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
        check(
          `${prefix} ${stage} no page overflow`,
          scroll <= width,
          `scroll=${scroll}, viewport=${width}`,
        );
      };
      const capture = async (stage: string) => {
        const path = `${outputDir}/${mode}-${width}-${stage}.png`;
        await page.screenshot({ path, fullPage: true });
        screenshots.push(path);
      };
      check(
        `${prefix} initial no snapshot DOM`,
        (await page.locator('[data-diff-view-mode], .json-preview').count()) === 0,
      );
      check(
        `${prefix} initial source absent`,
        !(await page.locator('main').textContent())?.includes('export const original'),
      );
      await overflow('initial');
      await capture('collapsed');
      for (const fixture of fixtures) {
        for (const surface of ['display', 'preview']) {
          const label = `${prefix} ${fixture.id}/${surface}`;
          const host = page.locator(`[data-case="${fixture.id}"] [data-surface="${surface}"]`);
          // 部分外层卡片按偏好折叠；结果文件自己的原生 disclosure 始终独立。
          const outer = host.locator('button[aria-expanded]').first();
          if ((await outer.count()) && (await outer.getAttribute('aria-expanded')) === 'false')
            await outer.click();
          const files = host.locator('.file-change-result-file');
          check(
            `${label} file count`,
            (await files.count()) === fixture.complete.length,
            `count=${await files.count()}`,
          );
          check(
            `${label} no diff before disclosure`,
            (await host.locator('[data-diff-view-mode]').count()) === 0,
          );
          for (let index = 0; index < (await files.count()); index++) {
            const row = files.nth(index);
            const summary = row.locator('summary');
            await summary.focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            const focus = await summary.evaluate((element: HTMLElement) => {
              const style = getComputedStyle(element);
              return {
                visible: element.matches(':focus-visible'),
                outline: style.outline,
                shadow: style.boxShadow,
              };
            });
            check(
              `${label} ${index} focus ring`,
              focus.visible && !focus.outline.includes(' 0px') && !focus.outline.startsWith('none'),
              JSON.stringify(focus),
            );
            await page.keyboard.press('Enter');
            await page.waitForTimeout(80);
            check(
              `${label} ${index} Enter opens native details`,
              (await row.getAttribute('open')) !== null,
            );
            const complete = fixture.complete[index];
            /*
             * 「完整对比」与「有 diff」是两件事：两侧前后文本都在时，即使被截断也照旧渲染
             * 「仅对比前段」的部分 diff（产品有意为之）。fixture 用 `diff` 显式声明这一维，
             * 缺省视为与 `complete` 一致。
             */
            const rendersDiff = fixture.diff?.[index] ?? complete;
            check(
              `${label} ${index} ${rendersDiff ? 'has' : 'no'} diff`,
              (await row.locator('[data-diff-view-mode]').count()) === (rendersDiff ? 1 : 0),
            );
            if (rendersDiff) {
              const scroll = await row
                .locator('[data-diff-view-mode] > div')
                .evaluate((element: HTMLElement) => {
                  element.scrollLeft = element.scrollWidth;
                  return {
                    width: element.clientWidth,
                    scrollWidth: element.scrollWidth,
                    left: element.scrollLeft,
                  };
                });
              check(
                `${label} ${index} clipped diff scrollable`,
                scroll.scrollWidth <= scroll.width || scroll.left > 0,
                JSON.stringify(scroll),
              );
            }
            if (!complete) {
              /*
               * 「这不是完整结果」的告知已全部下沉到展开区：要么是范围说明
               * （两侧都有、只是被截断），要么是「无法对比」说明（缺一侧）。
               * 标题行不再挂「快照不完整」徽标——同一屏幕两遍、且没有可操作信息。
               */
              const text = await row.innerText();
              check(
                `${label} ${index} incomplete notice`,
                text.includes('以下仅对比已保留的前段内容') ||
                  text.includes('内容可能已截断或缺少一侧'),
                text,
              );
              check(`${label} ${index} no incomplete badge`, !text.includes('快照不完整'));
            }
            await page.keyboard.press('Space');
            check(
              `${label} ${index} Space closes native details`,
              (await row.getAttribute('open')) === null,
            );
            await page.keyboard.press('Enter');
          }
          if (fixture.id === 'false-success') {
            const text = await host.innerText();
            check(
              `${label} false success honest`,
              text.includes('结果报告失败') && !text.includes('已应用'),
              text,
            );
          }
          if (fixture.id === 'multiple-paths') {
            const text = await host.innerText();
            check(
              `${label} add delete move labels`,
              ['新增', '删除', '移动', '→'].every((word) => text.includes(word)),
            );
          }
          const raw = host.locator('.file-change-result-raw');
          await raw.locator('summary').focus();
          await page.keyboard.press('Enter');
          await raw.locator('.json-preview').waitFor();
          const copy = raw.getByRole('button', { name: '复制完整内容', exact: true });
          await copy.focus();
          await page.keyboard.press('Enter');
          await raw.getByRole('button', { name: '已复制完整内容', exact: true }).waitFor();
          const copied = await page.evaluate(() => navigator.clipboard.readText());
          const expected = fixture.output;
          const expectedText =
            typeof expected === 'string' ? expected : JSON.stringify(expected, null, 2);
          check(
            `${label} raw full clipboard recovery`,
            copied === expectedText,
            `copied=${copied.length}, expected=${expectedText.length}`,
          );
          if (fixture.id === 'stream-source')
            check(
              `${label} long source recovered`,
              copied.includes('file-change QA end sentinel') && copied.length > 20000,
            );
          await overflow(`${fixture.id}/${surface} raw open`);
          await raw.locator('summary').click();
        }
      }
      await overflow('expanded');
      await capture('expanded');
      const focus = page.locator(
        '[data-case="generic"] [data-surface="preview"] .file-change-result-file > summary',
      );
      await focus.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await focus.scrollIntoViewIfNeeded();
      const focusPath = `${outputDir}/${mode}-${width}-focus.png`;
      await page.screenshot({ path: focusPath });
      screenshots.push(focusPath);
      check(`${prefix} no browser exceptions`, errors.length === 0, errors.join('\n'));
      console.log(
        `${prefix}: ${results.filter((result) => result.name.startsWith(prefix) && !result.passed).length} failures`,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.passed);
await writeFile(
  `${outputDir}/results.json`,
  JSON.stringify(
    {
      baseUrl,
      browser: browser.version(),
      passed: results.length - failed.length,
      failed: failed.length,
      results,
      screenshots,
    },
    null,
    2,
  ),
);
for (const result of failed) console.log(`FAIL ${result.name}: ${result.detail ?? ''}`);
console.log(`${results.length - failed.length} passed / ${failed.length} failed`);
process.exitCode = failed.length ? 1 : 0;
