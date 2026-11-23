/** NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/tool-status-verify.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cases } from './tool-status-fixtures.js';

const { chromium } = await import('playwright');
const outputDir = resolve('apps/web/harness/tool-status-artifacts');
const baseUrl = process.env.TOOL_STATUS_BASE_URL ?? 'http://127.0.0.1:5173';
await mkdir(outputDir, { recursive: true });
const results: { name: string; passed: boolean; detail?: string }[] = [];
const screenshots: string[] = [];
const labels: Record<string, RegExp> = {
  running: /^执行中…$/,
  completed: /^已完成$/,
  failed: /^执行失败$/,
  cancelled: /^已取消$/,
  paused: /^(已暂停|等待权限|等待回答|等待确认)$/,
  pending: /^待执行$/,
};
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['dark', 'light'] as const) {
    for (const width of [375, 768, 1440]) {
      const prefix = `${mode}/${width}`;
      console.log(`开始 ${prefix}`);
      const check = (name: string, passed: boolean, detail?: string) => {
        results.push({ name: `${prefix} ${name}`, passed, detail });
        if (!passed) console.log(`FAIL ${prefix} ${name}: ${detail ?? ''}`);
      };
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: mode });
      page.setDefaultTimeout(15000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      try {
        await page.goto(`${baseUrl}/harness/tool-status.html?mode=${mode}`, {
          waitUntil: 'networkidle',
          timeout: 120000,
        });
        await page.locator('[data-case]').first().waitFor();
        console.log(`${prefix} 真实组件已加载`);
        const overflow = async (stage: string) => {
          const size = await page.evaluate(() => document.documentElement.scrollWidth);
          check(`${stage} 页面无横向溢出`, size <= width, `scrollWidth=${size}, viewport=${width}`);
        };
        await overflow('折叠');
        const theme = await page
          .locator('body')
          .evaluate((element) => getComputedStyle(element).backgroundColor);
        check('主题正确应用', theme !== 'rgba(0, 0, 0, 0)', theme);
        const collapsedShot = `${outputDir}/${mode}-${width}-collapsed.png`;
        await page.screenshot({ path: collapsedShot, fullPage: true });
        screenshots.push(collapsedShot);
        for (const fixture of cases) {
          const section = page.locator(`[data-case="${fixture.id}"]`);
          const outer = section.locator('[aria-expanded]').first();
          const status = section.locator('.tool-call-status-label').first();
          check(
            `${fixture.id} 数据状态`,
            (await section
              .locator('[data-tool-status]')
              .first()
              .getAttribute('data-tool-status')) === fixture.expectedStatus,
          );
          const label = (await status.innerText()).trim();
          check(
            `${fixture.id} 可读状态`,
            labels[fixture.expectedStatus]?.test(label) === true,
            label,
          );
          const statusSize = await status.evaluate((element) => ({
            client: element.clientWidth,
            scroll: element.scrollWidth,
          }));
          check(
            `${fixture.id} 状态未截断`,
            statusSize.scroll <= statusSize.client + 1,
            JSON.stringify(statusSize),
          );
          const summary = await section
            .locator('.tool-call-block-title, .tool-call-inline-summary')
            .innerText();
          if (/^(literal|blank)-/.test(fixture.id))
            check(`${fixture.id} 通用工具名`, summary === '工具调用', summary);
          if (fixture.id.startsWith('unknown-'))
            check(`${fixture.id} 未知名称保留`, summary.includes(fixture.props.toolName), summary);
          if (fixture.expectedStatus !== 'completed')
            check(`${fixture.id} 不误报完成`, !/^(已|执行了|调用了)/.test(summary), summary);
          await outer.focus();
          await page.keyboard.press('Tab');
          await page.keyboard.press('Shift+Tab');
          const ring = await outer.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              active: element === document.activeElement,
              visible: element.matches(':focus-visible'),
              outline: style.outlineStyle,
              width: style.outlineWidth,
              shadow: style.boxShadow,
            };
          });
          check(
            `${fixture.id} 键盘焦点环`,
            ring.active &&
              ring.visible &&
              ((ring.outline !== 'none' && parseFloat(ring.width) > 0) || ring.shadow !== 'none'),
            JSON.stringify(ring),
          );
          if (fixture.id === 'literal-running') {
            const shot = `${outputDir}/${mode}-${width}-focus.png`;
            await page.screenshot({ path: shot });
            screenshots.push(shot);
          }
          await page.keyboard.press('Enter');
          await section.locator('[aria-expanded="true"]').first().waitFor();
          check(`${fixture.id} Enter 展开`, (await outer.getAttribute('aria-expanded')) === 'true');
          check(`${fixture.id} 原始输出保留`, (await section.innerText()).includes(fixture.raw));
          await page.keyboard.press('Space');
          await section.locator('[aria-expanded="false"]').first().waitFor();
          check(
            `${fixture.id} Space 收起`,
            (await outer.getAttribute('aria-expanded')) === 'false',
          );
          await page.keyboard.press('Enter');
          await section.locator('[aria-expanded="true"]').first().waitFor();
        }
        await overflow('全部展开');
        const expandedShot = `${outputDir}/${mode}-${width}-expanded.png`;
        await page.screenshot({ path: expandedShot, fullPage: true });
        screenshots.push(expandedShot);
        check('无浏览器异常', errors.length === 0, JSON.stringify(errors));
      } catch (error) {
        check('浏览器执行完成', false, error instanceof Error ? error.message : String(error));
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.passed);
await writeFile(
  `${outputDir}/report.json`,
  JSON.stringify(
    { results, screenshots, passed: results.length - failed.length, failed: failed.length },
    null,
    2,
  ),
);
console.log(
  `工具状态 Chromium 验收：${results.length - failed.length}/${results.length} 通过，截图 ${screenshots.length} 张；报告 ${outputDir}/report.json`,
);
if (failed.length) process.exitCode = 1;
