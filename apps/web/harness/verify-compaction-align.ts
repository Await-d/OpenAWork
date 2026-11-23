/**
 * 压缩胶囊对齐测量：胶囊中心与消息行中心是否重合。
 *
 * 运行：NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-compaction-align.ts
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-compaction-align.ts',
  );
  process.exit(1);
}

const BASE = process.env.COMPACTION_BASE_URL ?? 'http://127.0.0.1:5174';
const OUT_DIR = 'apps/web/harness/compaction-align-artifacts';

const browser = await chromium.launch();
const results: string[] = [];
let failures = 0;

for (const mode of ['dark', 'light'] as const) {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto(`${BASE}/harness/compaction-align.html?mode=${mode}`, {
      waitUntil: 'load',
      timeout: 60000,
    });
    await page.waitForSelector('[data-case="compaction"] .chat-message-row', {
      state: 'attached',
      timeout: 60000,
    });
    await page.waitForTimeout(300);

    const checks: string[] = [];
    const assert = (name: string, ok: boolean, detail = ''): void => {
      if (!ok) failures += 1;
      checks.push(`${ok ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
    };

    const metrics = await page.evaluate(() => {
      const row = document.querySelector(
        '[data-case="compaction"] .chat-message-row',
      ) as HTMLElement | null;
      if (!row) return null;
      // 胶囊 = 含该文案的**最内层** div（最外层容器的 textContent 也包含它，不能用 find）。
      const candidates = Array.from(row.querySelectorAll('div')).filter((el) =>
        /压缩上下文/.test(el.textContent ?? ''),
      );
      const pill = candidates[candidates.length - 1] as HTMLElement | undefined;
      if (!pill) return null;
      const rowRect = row.getBoundingClientRect();
      const pillRect = pill.getBoundingClientRect();
      return {
        rowCenter: rowRect.left + rowRect.width / 2,
        rowWidth: rowRect.width,
        pillCenter: pillRect.left + pillRect.width / 2,
        pillWidth: pillRect.width,
        // 头像列是否仍占位
        avatarVisible: (() => {
          const avatar = row.querySelector('.chat-message-avatar-frame') as HTMLElement | null;
          if (!avatar) return false;
          const style = getComputedStyle(avatar);
          return style.display !== 'none' && avatar.getBoundingClientRect().width > 0;
        })(),
        hasHeader: row.querySelector('.chat-message-header') !== null,
        hasMeta: row.querySelector('.chat-message-meta-row') !== null,
      };
    });

    if (!metrics) {
      failures += 1;
      checks.push('✗ 未找到压缩胶囊');
      results.push(`### ${mode} / ${width}px\n${checks.join('\n')}`);
      await page.close();
      continue;
    }

    const offset = Math.abs(metrics.pillCenter - metrics.rowCenter);
    assert('胶囊水平居中（偏差 ≤ 1px）', offset <= 1, `偏差 ${offset.toFixed(2)}px`);
    assert('不再渲染头像列', !metrics.avatarVisible);
    assert('不再渲染消息头', !metrics.hasHeader);
    assert('不再渲染元信息行', !metrics.hasMeta);
    assert(
      '胶囊是收缩宽度而非通栏',
      metrics.pillWidth < metrics.rowWidth - 8,
      `胶囊 ${metrics.pillWidth.toFixed(0)} / 行 ${metrics.rowWidth.toFixed(0)}`,
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert('无横向溢出', overflow <= 0, `${overflow}px`);
    assert('无页面异常', errors.length === 0, errors.join(' | '));

    /*
     * 纵向顺序：压缩提示夹在两条助手消息之间时，必须各自成组。
     *
     * 只测横向（胶囊居中）发现不了这个问题：压缩提示与相邻助手消息同为
     * `assistant`，分组若只按 role 判定，压缩行会带 `is-grouped` 负 margin 贴住
     * 上一条，而它后面那条回复会被判成续行——头像与消息头整块消失，看起来像
     * 系统提示「吞掉」了下一条回复的标题。harness 走的是真实分组函数。
     */
    const sequence = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll('[data-case="sequence"] .chat-message-row'),
      ) as HTMLElement[];
      return rows.map((row) => {
        const rect = row.getBoundingClientRect();
        const avatar = row.querySelector('.chat-message-avatar-frame') as HTMLElement | null;
        const avatarVisible =
          avatar !== null &&
          getComputedStyle(avatar).display !== 'none' &&
          avatar.getBoundingClientRect().width > 0;
        return {
          id: row.dataset['messageId'] ?? '',
          top: rect.top,
          bottom: rect.bottom,
          grouped: row.dataset['grouped'],
          hasHeader: row.querySelector('.chat-message-header') !== null,
          avatarVisible,
        };
      });
    });

    if (sequence.length !== 3) {
      failures += 1;
      checks.push(`✗ 顺序用例应渲染 3 行，实际 ${sequence.length} 行`);
    } else {
      const [before, compaction, after] = sequence as [
        (typeof sequence)[number],
        (typeof sequence)[number],
        (typeof sequence)[number],
      ];
      assert(
        '顺序正确：上一条 → 压缩提示 → 下一条',
        before.id === 'seq-before' &&
          compaction.id === 'seq-compaction' &&
          after.id === 'seq-after',
        sequence.map((row) => row.id).join(' → '),
      );
      assert(
        '纵向不重叠（上一条底部不覆盖压缩行顶部）',
        compaction.top >= before.bottom - 0.5,
        `before.bottom=${before.bottom.toFixed(1)} compaction.top=${compaction.top.toFixed(1)}`,
      );
      assert(
        '纵向不重叠（压缩行底部不覆盖下一条顶部）',
        after.top >= compaction.bottom - 0.5,
        `compaction.bottom=${compaction.bottom.toFixed(1)} after.top=${after.top.toFixed(1)}`,
      );
      assert(
        '压缩行不属于上一行续行',
        compaction.grouped === 'false',
        `grouped=${compaction.grouped}`,
      );
      assert('压缩行不留消息头', !compaction.hasHeader);
      assert('压缩行不留头像列', !compaction.avatarVisible);
      assert(
        '下一条回复重新带消息头（未被压缩提示吞掉标题）',
        after.hasHeader,
        `grouped=${after.grouped} header=${after.hasHeader} avatar=${after.avatarVisible}`,
      );
      assert('下一条回复重新显示头像', after.avatarVisible);
    }

    await page
      .locator('[data-case="compaction"]')
      .screenshot({ path: `${OUT_DIR}/${mode}-${width}.png` });
    results.push(`### ${mode} / ${width}px\n${checks.join('\n')}`);
    await page.close();
  }
}

await browser.close();
console.log(results.join('\n\n'));
console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
