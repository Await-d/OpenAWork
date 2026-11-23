/**
 * 大文件差异折叠验收：确认「只渲染变更区 + 上下文」，且变更永远在视野内。
 *
 * 运行：NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-diff-collapse.ts
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-diff-collapse.ts',
  );
  process.exit(1);
}

const BASE = process.env.DIFF_COLLAPSE_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/diff-collapse-artifacts';

const browser = await chromium.launch();
const results: string[] = [];
let failures = 0;

for (const mode of ['dark', 'light'] as const) {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto(`${BASE}/harness/diff-collapse.html?mode=${mode}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-case="large"] [data-diff-view-mode]', {
      state: 'attached',
      timeout: 60000,
    });
    await page.waitForTimeout(400);

    const checks: string[] = [];
    const assert = (name: string, ok: boolean, detail = ''): void => {
      if (!ok) failures += 1;
      checks.push(`${ok ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
    };

    // 1. 大文件：渲染的行节点数量应远小于 1200 行
    const largeRowCount = await page.locator('[data-case="large"] [data-diff-row]').count();
    assert(
      '大文件渲染行数被压到低位',
      largeRowCount > 0 && largeRowCount < 60,
      `${largeRowCount} 行`,
    );

    // 2. 变更行必须存在（核心不变量）
    const changeVisible = await page
      .locator(
        '[data-case="large"] [data-diff-row="removed"], [data-case="large"] [data-diff-row="added"]',
      )
      .count();
    assert('变更行在渲染结果中', changeVisible > 0, `${changeVisible} 行`);

    // 3. 存在折叠占位行，且文案报出未变更行数
    const placeholderText = await page
      .locator('[data-case="large"] [data-diff-row="hunk"]')
      .first()
      .textContent();
    assert(
      '折叠占位行报出未变更行数',
      /\d+ 行未变更/u.test(placeholderText ?? ''),
      `实际「${placeholderText?.trim()}」`,
    );

    // 4. 双栏布局同样折叠
    const splitRowCount = await page.locator('[data-case="large-split"] [data-diff-row]').count();
    assert('双栏布局同样折叠', splitRowCount > 0 && splitRowCount < 60, `${splitRowCount} 行`);

    // 5. 「显示全部」入口存在，且样式已生效（不是裸 button）
    const expandBtn = page.locator('[data-case="large"] [data-diff-expand-collapsed="true"]');
    const expandCount = await expandBtn.count();
    assert('提供「显示全部」入口', expandCount === 1, `匹配 ${expandCount} 处`);
    if (expandCount === 1) {
      const label = (await expandBtn.textContent())?.trim() ?? '';
      assert('按钮文案含完整行数', label.includes('1200'), `实际「${label}」`);
      const style = await expandBtn.evaluate((el) => {
        const computed = getComputedStyle(el);
        return { cursor: computed.cursor, fontSize: computed.fontSize };
      });
      assert('按钮有自定义样式（非浏览器默认）', style.cursor === 'pointer', JSON.stringify(style));

      // 5b. 点击后放弃折叠；但仍受 600 行上限约束（渐进披露的第二层）
      await expandBtn.click();
      await page.waitForTimeout(300);
      const expandedRows = await page.locator('[data-case="large"] [data-diff-row]').count();
      assert(
        '展开后行数增加且不超过 600 行上限',
        expandedRows > largeRowCount && expandedRows <= 600,
        `${expandedRows} 行`,
      );
      const stillThere = await page
        .locator('[data-case="large"] [data-diff-expand-collapsed="true"]')
        .count();
      assert('展开后折叠入口消失', stillThere === 0, `${stillThere} 处`);

      // 5c. 第三层：超过上限时仍提供「还有 N 行」入口
      const limitBtn = page.locator('[data-case="large"] [data-diff-expand="true"]');
      const limitCount = await limitBtn.count();
      assert('超上限时提供继续展开入口', limitCount === 1, `匹配 ${limitCount} 处`);
      if (limitCount === 1) {
        await limitBtn.click();
        await page.waitForTimeout(300);
        const fullRows = await page.locator('[data-case="large"] [data-diff-row]').count();
        assert('继续展开后渲染完整行数', fullRows > 600, `${fullRows} 行`);
      }

      await page
        .locator('[data-case="large"]')
        .screenshot({ path: `${OUT_DIR}/${mode}-${width}-expanded.png` });
    }

    // 6. 小文件不应折叠
    const smallHunkCount = await page.locator('[data-case="small"] [data-diff-row="hunk"]').count();
    assert('小文件不折叠', smallHunkCount === 0, `${smallHunkCount} 个占位行`);

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
