/**
 * 终端 tab 条三视口验收（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：长窗口标题在真实排版下的截断与「不撑破宿主」、
 * 每个 tab / 标签的宽度上限、标签不换行、以及长标签挤压下右侧动作区仍留在 pane 内。
 *
 * 渲染的是真实组件与真实 CSS 链（见 `terminal-tab-label-entry.tsx`）；
 * 期望值从 `terminal-tab-label-fixtures.ts` 推导（入口与脚本共用同一份夹具），
 * 截断期望**按规则重算**而不是调用被测函数，避免实现改坏时两侧一起变。
 *
 * 运行方式见同目录 `README.md`。
 *
 * ⚠️ 为什么 playwright 用动态导入 + NODE_PATH：
 * `apps/web` **不直接依赖** playwright（浏览器内核依赖只应存在于 `packages/browser-automation`），
 * 而 bun 对 workspace 包内的文件做严格依赖解析，裸名会直接报 `Cannot find package 'playwright'`；
 * 相对路径穿越 `node_modules` 同样被 bun 拒绝（绝对路径才放行，但那不可提交）。
 * 因此运行命令需指向该 workspace 的 node_modules —— 见下方 catch 分支与 README。
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-terminal-tab-label.ts',
  );
  process.exit(1);
}

import { EXPECTED_LABELS, EXPECTED_ORDER } from './terminal-tab-label-fixtures.js';

const URL = 'http://127.0.0.1:5173/harness/terminal-tab-label.html';
const VIEWPORTS = [375, 768, 1280];
const PAGE_MAX_WIDTH = Math.max(...VIEWPORTS);

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="harness-strip-row"]', { timeout: 30_000 });

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });

    const viewport = page.locator(`[data-viewport="${width}"]`);
    const tabs = viewport.locator('[data-terminal-id]');

    // 1) 六个 tab 都渲染，DOM 顺序 = 夹具顺序（旧 → 新）。
    const ids = await tabs.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-terminal-id') ?? ''),
    );
    check(
      `[${width}] 六个 tab 渲染且 DOM 顺序 = 旧 → 新`,
      ids.length === EXPECTED_ORDER.length &&
        ids.every((id, index) => id === EXPECTED_ORDER[index]),
      JSON.stringify(ids),
    );

    // 2) 可见顺序（左 → 右）与 DOM 顺序一致：每个 tab 的 rect.x 严格递增。
    const xs = await tabs.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().x),
    );
    check(
      `[${width}] 可见顺序左 → 右 = 旧 → 新（新 tab 追加在右）`,
      xs.length === EXPECTED_ORDER.length &&
        xs.every((x, index) => index === 0 || x > (xs[index - 1] ?? Number.POSITIVE_INFINITY)),
      JSON.stringify(xs),
    );

    // 3) 标签文案逐条对齐：截断口径（22 + …）与优先级（自定义名 > 描述 > 标题 > …）。
    for (const [terminalId, expected] of EXPECTED_LABELS) {
      const label = viewport.locator(`[data-terminal-id="${terminalId}"] .terminal-tab__label`);
      const text = ((await label.textContent()) ?? '').trim();
      check(`[${width}] ${terminalId} 标签 = “${expected}”`, text === expected, `实际 “${text}”`);
    }

    // 4) 宽度上限与不换行（真实排版下 max-width / ellipsis / nowrap 同时成立）。
    // 上限来自 terminal-panel.css：窄视口（<768px）的 media query 更紧（148 / 108）。
    const tabCap = width < 768 ? 148 : 200;
    const labelCap = width < 768 ? 108 : 160;
    const geometry = await tabs.evaluateAll((elements) =>
      elements.map((element) => {
        const label = element.querySelector<HTMLElement>('.terminal-tab__label');
        const style = label ? getComputedStyle(label) : null;
        return {
          tabWidth: element.getBoundingClientRect().width,
          labelClientWidth: label?.clientWidth ?? -1,
          labelHeight: label?.getBoundingClientRect().height ?? -1,
          whiteSpace: style?.whiteSpace ?? '',
          textOverflow: style?.textOverflow ?? '',
          overflow: style?.overflow ?? '',
        };
      }),
    );
    check(
      `[${width}] 每个 tab 宽 ≤ ${tabCap}px（长标题不撑宽 tab）`,
      geometry.length === EXPECTED_ORDER.length &&
        geometry.every((item) => item.tabWidth <= tabCap + 0.5),
      JSON.stringify(geometry.map((item) => item.tabWidth)),
    );
    check(
      `[${width}] 每个标签宽 ≤ ${labelCap}px`,
      geometry.every((item) => item.labelClientWidth > 0 && item.labelClientWidth <= labelCap),
      JSON.stringify(geometry.map((item) => item.labelClientWidth)),
    );
    check(
      `[${width}] 标签单行且省略号口径恒定（nowrap + ellipsis + hidden）`,
      geometry.every(
        (item) =>
          item.whiteSpace === 'nowrap' &&
          item.textOverflow === 'ellipsis' &&
          item.overflow === 'hidden' &&
          item.labelHeight > 0 &&
          item.labelHeight <= 14,
      ),
      JSON.stringify(geometry),
    );

    // 5) 宿主不被撑开：tab 条自己横向滚动，右侧动作区仍留在 pane 内且未被压缩。
    const layout = await viewport.evaluate((element) => {
      const row = element.querySelector<HTMLElement>('[data-testid="harness-strip-row"]');
      const list = element.querySelector<HTMLElement>('[data-testid="terminal-tab-strip"]');
      const actions = element.querySelector<HTMLElement>('[data-testid="harness-actions"]');
      const pane = element.querySelector<HTMLElement>('.terminal-pane');
      return {
        rowClientWidth: row?.clientWidth ?? -1,
        rowScrollWidth: row?.scrollWidth ?? -1,
        listClientWidth: list?.clientWidth ?? -1,
        listScrollWidth: list?.scrollWidth ?? -1,
        paneRight: pane?.getBoundingClientRect().right ?? -1,
        actionsRight: actions?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
        actionsWidth: actions?.getBoundingClientRect().width ?? -1,
      };
    });
    check(
      `[${width}] tab 条未把宿主撑开（row 无横向溢出）`,
      layout.rowClientWidth > 0 && layout.rowScrollWidth <= layout.rowClientWidth + 1,
      JSON.stringify(layout),
    );
    check(
      `[${width}] 右侧动作区仍在 pane 内且未被压缩`,
      layout.actionsWidth >= 96 && layout.actionsRight <= layout.paneRight + 1,
      JSON.stringify(layout),
    );
    if (width < 1280) {
      check(
        `[${width}] 放不下时由 tab 条横向滚动接管`,
        layout.listScrollWidth > layout.listClientWidth,
        JSON.stringify(layout),
      );
    } else {
      check(
        `[${width}] 宽视口下 tab 条无需滚动即可容纳`,
        layout.listScrollWidth <= layout.listClientWidth + 1,
        JSON.stringify(layout),
      );
    }

    const docScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    check(
      `[${width}] 页面不出现横向溢出（文档宽 ≤ ${PAGE_MAX_WIDTH}）`,
      docScrollWidth <= PAGE_MAX_WIDTH + 1,
      `scrollWidth=${docScrollWidth}`,
    );

    await viewport.screenshot({ path: `/tmp/opencode/terminal-tab-label-${width}.png` });
  }
} finally {
  await browser.close();
}

console.log(`\n终端 tab 条三视口验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
