/**
 * 消息终态提示排版验收：确认「错误 / 已停止」不会作为独立一行出现在两条消息之间。
 *
 * 当前口径是**消息页脚**：提示紧跟在同一条消息的内容之后、仍在消息行之内；
 * 既不另起一行挤进消息之间，也不塞进内容块内部当内联片段。
 *
 * 运行：NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-meta-inline.ts
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-meta-inline.ts',
  );
  process.exit(1);
}

const BASE = process.env.META_INLINE_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/meta-inline-artifacts';

const browser = await chromium.launch();
const results: string[] = [];
let failures = 0;

for (const mode of ['dark', 'light'] as const) {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto(`${BASE}/harness/meta-inline.html?mode=${mode}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-case="error-only"]', { state: 'attached', timeout: 60000 });
    await page.waitForTimeout(300);

    const checks: string[] = [];
    const assert = (name: string, ok: boolean, detail = ''): void => {
      if (!ok) failures += 1;
      checks.push(`${ok ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
    };

    // 1. 终态提示仍然存在（信息不丢）
    const errorText = await page
      .locator('[data-case="error-only"] .chat-message-meta-item')
      .first()
      .textContent();
    assert('错误提示仍可见', errorText?.trim() === '错误', `实际「${errorText?.trim()}」`);

    // 2. 它留在**同一条消息的页脚**（内容之后、消息行之内）：既不跑进内容块内部当
    //    内联片段，也不会脱离消息行跑到两条消息之间自成一行。
    const placement = await page.evaluate(() => {
      const meta = document.querySelector(
        '[data-case="error-only"] .chat-message-meta-row',
      ) as HTMLElement | null;
      const row = meta?.closest('.chat-message-row') as HTMLElement | null;
      const content = row?.querySelector('.chat-message-content') as HTMLElement | null;
      if (!meta || !row || !content) return null;
      const metaRect = meta.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        insideContent: content.contains(meta),
        insideRow: row.contains(meta),
        /** 页脚：提示顶部不低于内容底部（允许 0.5px 亚像素误差）。 */
        belowContent: metaRect.top >= contentRect.bottom - 0.5,
        /** 仍在消息行纵向范围内：底部不越过行底。 */
        withinRowBottom: metaRect.bottom <= rowRect.bottom + 0.5,
        gap: metaRect.top - contentRect.bottom,
      };
    });
    if (!placement) {
      failures += 1;
      checks.push('✗ 未找到错误消息的终态提示');
    } else {
      assert('提示仍属于这条消息行', placement.insideRow);
      assert(
        '提示在消息页脚（内容之后）',
        placement.belowContent,
        `间隔 ${placement.gap.toFixed(2)}px`,
      );
      assert('提示未被塞进内容块内部', !placement.insideContent);
      assert('提示未越过消息行底部', placement.withinRowBottom);
    }

    // 3. 不再有任何 inline 变体标记（该方案已废弃）
    const inlineVariants = await page.locator('[data-meta-variant="inline"]').count();
    assert('不存在 inline 变体标记', inlineVariants === 0, `匹配 ${inlineVariants} 处`);

    // 4. 已停止同样走消息页脚
    const cancelledInRow = await page.evaluate(() => {
      const meta = document.querySelector(
        '[data-case="cancelled-only"] .chat-message-meta-row',
      ) as HTMLElement | null;
      return meta !== null && meta.closest('.chat-message-row') !== null;
    });
    assert('已停止也走消息页脚', cancelledInRow);

    // 5. 正常消息不应出现终态提示
    const completedMeta = await page
      .locator('[data-case="completed"] .chat-message-meta-row')
      .count();
    assert('正常消息无终态提示', completedMeta === 0, `匹配 ${completedMeta} 处`);

    // 6. 无横向溢出
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert('无横向溢出', overflow <= 0, `${overflow}px`);

    assert('无页面异常', errors.length === 0, errors.join(' | '));

    await page.locator('body').screenshot({ path: `${OUT_DIR}/${mode}-${width}.png` });
    results.push(`### ${mode} / ${width}px\n${checks.join('\n')}`);
    await page.close();
  }
}

await browser.close();
console.log(results.join('\n\n'));
console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
