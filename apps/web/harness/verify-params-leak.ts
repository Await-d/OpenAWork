/**
 * 截断大文件的工具卡验收：参数区不得与 diff 并存，通用截断徽标不得与卡内说明重复。
 *
 * 运行：NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-params-leak.ts
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-params-leak.ts',
  );
  process.exit(1);
}

const BASE = process.env.PARAMS_LEAK_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/params-leak-artifacts';

const browser = await chromium.launch();
const results: string[] = [];
let failures = 0;

for (const mode of ['dark', 'light'] as const) {
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto(`${BASE}/harness/params-leak.html?mode=${mode}`, {
      waitUntil: 'load',
      timeout: 120000,
    });
    await page.waitForSelector('[data-case] .tool-call-block', {
      state: 'attached',
      timeout: 60000,
    });
    await page.waitForTimeout(500);

    const checks: string[] = [];
    const assert = (name: string, ok: boolean, detail = ''): void => {
      if (!ok) failures += 1;
      checks.push(`${ok ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
    };

    const caseIds = await page.$$eval('[data-case]', (nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset['case'] ?? ''),
    );

    for (const caseId of caseIds) {
      const section = page.locator(`[data-case="${caseId}"]`);

      // 1. 参数区必须隐藏（diff 已表达内容）
      const paramCount = await section.locator('.tool-call-block-params').count();
      assert(`[${caseId}] 参数区不渲染`, paramCount === 0, `${paramCount} 个`);

      // 2. 通用截断徽标必须隐藏（卡内已有更精确说明）
      const badgeCount = await section.locator('.tool-output-truncated-badge').count();
      assert(`[${caseId}] 通用截断徽标不渲染`, badgeCount === 0, `${badgeCount} 个`);

      // 3. diff / 文件变更卡必须在
      const hasDiffCard =
        (await section.locator('.file-change-result').count()) +
        (await section.locator('.tool-call-block-diff').count());
      assert(`[${caseId}] 仍有文件变更视图`, hasDiffCard > 0, `${hasDiffCard} 个`);

      await section.screenshot({ path: `${OUT_DIR}/${mode}-${width}-${caseId}.png` });
    }

    assert('无页面异常', errors.length === 0, errors.join(' | '));
    results.push(`### ${mode} / ${width}px\n${checks.join('\n')}`);
    await page.close();
  }
}

await browser.close();
console.log(results.join('\n\n'));
console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
