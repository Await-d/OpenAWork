/**
 * 压缩提示在消息流中的排版取证：测量其左/右边界是否与相邻消息对齐。
 *
 * 运行：NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-compaction-layout.ts
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-compaction-layout.ts',
  );
  process.exit(1);
}

const BASE = process.env.COMPACTION_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/compaction-layout-artifacts';

const browser = await chromium.launch();
const results: string[] = [];

for (const width of [768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${BASE}/harness/compaction-layout.html`, {
    waitUntil: 'load',
    timeout: 120000,
  });
  await page.waitForSelector('[data-case="compaction"]', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(400);

  const metrics = await page.evaluate(() => {
    const pick = (sel: string): { left: number; right: number; width: number } | null => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      };
    };
    return {
      container: pick('.compaction-harness'),
      compactionRow: pick('[data-case="compaction"] .chat-message-row'),
      compactionShell: pick('[data-case="compaction"] .chat-message-content-shell'),
      compactionContent: pick('[data-case="compaction"] .chat-message-content'),
      compactionAvatar: pick('[data-case="compaction"] .chat-message-avatar-frame'),
      compactionCard: pick('[data-case="compaction"] .chat-message-content > *'),
      compactionCardInner: pick('[data-case="compaction"] .chat-message-content > * > div'),
      normalContent: pick('[data-case="after"] .chat-message-content'),
      normalAvatar: pick('[data-case="after"] .chat-message-avatar-frame'),
      layout: document
        .querySelector('[data-case="compaction"] .chat-message-row')
        ?.getAttribute('data-layout'),
    };
  });

  await page
    .locator('[data-case="compaction"]')
    .screenshot({ path: `${OUT_DIR}/compaction-${width}.png` });

  results.push(`### ${width}px\n${JSON.stringify(metrics, null, 2)}`);
  await page.close();
}

await browser.close();
console.log(results.join('\n\n'));
