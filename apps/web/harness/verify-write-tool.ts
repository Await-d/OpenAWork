/**
 * write 工具结果渲染取证：真实 Chromium，真实 ToolCallDisplay / ToolOutputPreview。
 *
 * 运行：NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-write-tool.ts
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-write-tool.ts',
  );
  process.exit(1);
}

const BASE = process.env.WRITE_TOOL_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/write-tool-artifacts';

const browser = await chromium.launch();
const results: string[] = [];

for (const mode of ['dark', 'light'] as const) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(`${BASE}/harness/write-tool.html?mode=${mode}`, { waitUntil: 'load' });
  await page.waitForSelector('.tool-call-block', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(800);

  for (const caseId of ['write-object', 'write-string', 'write-truncated']) {
    const section = page.locator(`[data-case="${caseId}"]`);
    const display = section.locator('[data-surface="display"]');
    const preview = section.locator('[data-surface="preview"]');

    await section.screenshot({ path: `${OUT_DIR}/${mode}-${caseId}-collapsed.png` });

    // 展开工具卡：按钮上带 tool-call-block 语义
    const toggle = display.locator('.tool-call-block-header').first();
    if (await toggle.count()) {
      await toggle.evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(300);
    }

    await section.screenshot({ path: `${OUT_DIR}/${mode}-${caseId}-expanded.png` });

    const displayText = (await display.innerText()).slice(0, 1500);
    const hasDiff = (await display.locator('[data-diff-view-mode]').count()) > 0;
    const hasJsonPreview = (await display.locator('.json-preview').count()) > 0;
    const hasBody = (await display.locator('.tool-call-block-body').count()) > 0;
    const hasDiffWrap = (await display.locator('.tool-call-block-diff').count()) > 0;
    const previewDiff = (await preview.locator('[data-diff-view-mode]').count()) > 0;
    const details = preview.locator('details');
    const detailCount = await details.count();
    for (let i = 0; i < Math.min(detailCount, 3); i += 1) {
      await details.nth(i).locator('summary').first().click();
      await page.waitForTimeout(120);
    }
    const previewText = (await preview.innerText()).slice(0, 1400);
    const html = (await display.innerHTML()).slice(0, 1200);

    results.push(
      [
        `### ${mode} / ${caseId}`,
        `- display diff 节点: ${hasDiff}`,
        `- display diff 包裹层: ${hasDiffWrap}`,
        `- display body 存在: ${hasBody}`,
        `- display json-preview 节点: ${hasJsonPreview}`,
        `- preview diff 节点: ${previewDiff}`,
        `- display 文本:\n${displayText}`,
        `- preview 文本:\n${previewText}`,
        `- display HTML:\n${html}`,
      ].join('\n'),
    );
  }

  results.push(`### ${mode} 页面异常: ${errors.length ? errors.join(' | ') : '无'}`);
  await page.close();
}

await browser.close();
console.log(results.join('\n\n'));
