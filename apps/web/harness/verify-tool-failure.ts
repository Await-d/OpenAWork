/**
 * 工具失败态结构化失败卡：真实 Chromium 验收。
 *
 * 覆盖 jsdom 覆盖不到的部分——真实布局下的换行 / 横向溢出、真实引擎解析后的
 * 主题变量、`<details>` 的真实展开行为。
 *
 * 运行（dev server 需已在 127.0.0.1:5174 运行）：
 *   NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-tool-failure.ts
 */
import { TOOL_FAILURE_FIXTURES } from './tool-failure-fixtures.js';

let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-tool-failure.ts',
  );
  process.exit(1);
}

const BASE = process.env.TOOL_FAILURE_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/tool-failure-artifacts';
const VIEWPORTS = [375, 768, 1440] as const;
const MODES = ['dark', 'light'] as const;

const failures: string[] = [];
const lines: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

const browser = await chromium.launch();

for (const mode of MODES) {
  for (const width of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto(`${BASE}/harness/tool-failure.html?mode=${mode}`, { waitUntil: 'networkidle' });

    for (const fixture of TOOL_FAILURE_FIXTURES) {
      const tag = `${mode}/${width}/${fixture.id}`;
      const section = page.locator(`[data-case="${fixture.id}"]`);
      const display = section.locator('[data-surface="display"]');

      // 失败卡默认可能已展开（失败态会自动展开）：先显式收敛到折叠态，再验折叠 / 展开两档。
      const toggle = display.locator('.tool-call-block-header, .tool-call-inline[role="button"]');
      const canToggle = (await toggle.count()) > 0;
      if (canToggle && (await toggle.first().getAttribute('aria-expanded')) === 'true') {
        await toggle.first().click();
        await page.waitForTimeout(200);
      }

      // ── 折叠态：只有一行红色 pill，且是结构化结论 ──
      const pill = display.locator('.tool-call-error-summary').first();
      const pillText = (await pill.count()) > 0 ? ((await pill.textContent()) ?? '').trim() : '';
      check(pillText.length > 0, `${tag}: 折叠态没有错误 pill`);
      check(
        pillText.includes(fixture.expectedHeadline),
        `${tag}: pill 文本缺结论「${fixture.expectedHeadline}」，实际「${pillText}」`,
      );
      check(pillText.length <= 120, `${tag}: pill 超过 120 字符（${pillText.length}）`);
      if (fixture.expectedLabel) {
        check(
          pillText.includes(fixture.expectedLabel),
          `${tag}: pill 文本缺分类「${fixture.expectedLabel}」，实际「${pillText}」`,
        );
      }

      const collapsedOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      check(collapsedOverflow <= 1, `${tag}: 折叠态出现横向溢出 ${collapsedOverflow}px`);

      await section.screenshot({ path: `${OUT_DIR}/${mode}-${width}-${fixture.id}-collapsed.png` });

      // ── 展开态：结构化失败卡 ──
      if (canToggle) {
        await toggle.first().click();
        await page.waitForTimeout(250);
      }

      const card = display.locator('.tool-failure-card').first();
      const hasCard = (await card.count()) > 0;
      check(hasCard, `${tag}: 展开后没有渲染失败卡`);

      if (hasCard) {
        const kind = await card.getAttribute('data-failure-kind');
        const expectedKind = fixture.expectedFields.length > 0 ? 'structured' : 'plain';
        check(kind === expectedKind, `${tag}: data-failure-kind=${kind}，期望 ${expectedKind}`);

        const headline = (
          (await card.locator('.tool-failure-headline').first().textContent()) ?? ''
        ).trim();
        check(
          headline === fixture.expectedHeadline,
          `${tag}: 卡片结论「${headline}」≠「${fixture.expectedHeadline}」`,
        );

        const labelText =
          (await card.locator('.tool-failure-label').count()) > 0
            ? ((await card.locator('.tool-failure-label').first().textContent()) ?? '').trim()
            : '';
        check(
          labelText === fixture.expectedLabel,
          `${tag}: 卡片分类「${labelText}」≠「${fixture.expectedLabel}」`,
        );

        const labels = await card.locator('.tool-failure-field dt').allTextContents();
        for (const expected of fixture.expectedFields) {
          check(
            labels.includes(expected),
            `${tag}: 缺字段「${expected}」（实际 ${labels.join('/')}）`,
          );
        }
        check(
          labels.length === fixture.expectedFields.length,
          `${tag}: 字段数量 ${labels.length} ≠ 期望 ${fixture.expectedFields.length}（${labels.join('/')}）`,
        );

        // 复制入口：只有结构化视图才有（plain 原文本来就一段）。
        const copyButtons = await card.getByRole('button', { name: '复制完整内容' }).count();
        check(
          copyButtons === (expectedKind === 'structured' ? 1 : 0),
          `${tag}: 复制按钮数量 ${copyButtons} 与视图类型不匹配`,
        );

        // ── 原始输出：逐字一致，且不产生横向溢出 ──
        const raw = card.locator('.tool-failure-raw');
        check((await raw.count()) === 1, `${tag}: 缺「原始输出」入口`);
        await raw.locator('summary').first().click();
        await page.waitForTimeout(150);
        const rawText = (
          (await card.locator('.tool-failure-raw-body').first().textContent()) ?? ''
        ).trim();
        check(
          rawText === fixture.output.trim(),
          `${tag}: 原始输出与原文不一致（${rawText.length} vs ${fixture.output.length} 字符）`,
        );
        const rawMetrics = await card
          .locator('.tool-failure-raw-body')
          .first()
          .evaluate((el) => ({
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            clientHeight: el.clientHeight,
          }));
        check(
          rawMetrics.scrollWidth <= rawMetrics.clientWidth + 1,
          `${tag}: 原始输出块内部横向溢出 ${rawMetrics.scrollWidth - rawMetrics.clientWidth}px`,
        );

        const expandedOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        check(expandedOverflow <= 1, `${tag}: 展开态出现横向溢出 ${expandedOverflow}px`);

        // 字段值必须换行而不是溢出：长路径在 375px 下会断成多行。
        const pathMetrics = await card
          .locator('.tool-failure-field code')
          .first()
          .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
          .catch(() => null);
        if (pathMetrics) {
          check(
            pathMetrics.scrollWidth <= pathMetrics.clientWidth + 1,
            `${tag}: 路径未换行，溢出 ${pathMetrics.scrollWidth - pathMetrics.clientWidth}px`,
          );
        }

        lines.push(
          `${tag}: pill「${pillText}」 · 卡片「${labelText}${labelText ? ' · ' : ''}${headline}」 · 字段 [${labels.join('/')}] · raw ${rawText.length} 字符 · 横向溢出 0px`,
        );
      } else {
        lines.push(`${tag}: pill「${pillText}」 · 失败卡缺失`);
      }

      await section.screenshot({ path: `${OUT_DIR}/${mode}-${width}-${fixture.id}-expanded.png` });
    }

    check(pageErrors.length === 0, `${mode}/${width}: 页面异常 ${pageErrors.join(' | ')}`);
    await page.close();
  }
}

await browser.close();

console.log(lines.join('\n'));
console.log(`\n共 ${lines.length} 个用例 × ${MODES.length} 主题 × ${VIEWPORTS.length} 视口`);
if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} 项不达标：`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('\n✅ 全部检查通过（截图见 apps/web/harness/tool-failure-artifacts/）');
