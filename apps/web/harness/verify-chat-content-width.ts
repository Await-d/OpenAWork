/**
 * 对话内容列「随可用宽度自适应」验收（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：`max-width: clamp(px, %, px)` 在真实引擎里的**解析值**，
 * 以及内容列在真实 flex / 滚动链里的**渲染宽度与居中边距**。
 * 期望值按夹具里的规则独立重算（见 `chat-content-width-fixtures.ts` 顶部注释）。
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
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-chat-content-width.ts',
  );
  process.exit(1);
}

import {
  CONTENT_WIDTH_PANES,
  EXPECTED_RATIO_PERCENT,
  expectedCeilingPx,
  expectedColumnWidthPx,
  expectedMaxWidthPx,
} from './chat-content-width-fixtures.js';

const URL = 'http://127.0.0.1:5173/harness/chat-content-width.html';
/** 页面视口需能容纳最宽的容器（1800px）+ 页面边距；容器宽度才是本策略的基准。 */
const PAGE_VIEWPORT = { width: 1900, height: 1000 } as const;

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

interface PaneMeasurement {
  readonly containerWidth: number;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly columnWidth: number;
  readonly columnLeft: number;
  readonly columnRight: number;
  readonly computedMaxWidth: string;
}

/**
 * Chromium 的 `getComputedStyle().maxWidth` 会**原样保留** `clamp()` 数学函数
 * （规范允许，不解析成 px）——因此这里解析声明组件，由渲染宽度证明解析结果。
 */
function parseClampDeclaration(
  value: string,
): { floorPx: number; ratioPercent: number; ceilingPx: number } | null {
  const match = /^clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)%\s*,\s*([\d.]+)px\s*\)$/.exec(value);
  if (!match) return null;
  const [, floor, ratio, ceiling] = match;
  if (floor === undefined || ratio === undefined || ceiling === undefined) return null;
  return {
    floorPx: Number.parseFloat(floor),
    ratioPercent: Number.parseFloat(ratio),
    ceilingPx: Number.parseFloat(ceiling),
  };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { ...PAGE_VIEWPORT } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-pane]', { timeout: 30_000 });

  for (const pane of CONTENT_WIDTH_PANES) {
    const scope = page.locator(`[data-pane="${pane.id}"]`);
    const measured: PaneMeasurement | null = await scope.evaluate((section) => {
      const scroll = section.querySelector<HTMLElement>('.scroll-region');
      const column = section.querySelector<HTMLElement>('[data-testid^="column-"]');
      if (!scroll || !column) return null;
      const scrollStyle = getComputedStyle(scroll);
      const paddingLeft = Number.parseFloat(scrollStyle.paddingLeft);
      const paddingRight = Number.parseFloat(scrollStyle.paddingRight);
      const scrollRect = scroll.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      return {
        containerWidth: scroll.clientWidth - paddingLeft - paddingRight,
        contentLeft: scrollRect.left + paddingLeft,
        contentRight: scrollRect.right - paddingRight,
        columnWidth: columnRect.width,
        columnLeft: columnRect.left,
        columnRight: columnRect.right,
        computedMaxWidth: getComputedStyle(column).maxWidth,
      };
    });

    if (!measured || !(measured.containerWidth > 0)) {
      check(`[${pane.id}] 容器与内容列已渲染且容器有可用宽度`, false, JSON.stringify(measured));
      continue;
    }

    const expectedMaxWidth = expectedMaxWidthPx(measured.containerWidth, pane.baselinePx);
    const expectedColumnWidth = expectedColumnWidthPx(measured.containerWidth, pane.baselinePx);

    // 1) clamp 声明被真实引擎保留，且组件 = 基准 / 88% / 1.5 倍（基准下限用例尤其重要：
    //    容器窄于下限时渲染宽度恒等于容器，无法区分「clamp 生效」与「声明被丢弃」）。
    const clampDeclaration = parseClampDeclaration(measured.computedMaxWidth);
    check(
      `[${pane.id}] max-width 声明 = clamp(${pane.baselinePx}px, ${EXPECTED_RATIO_PERCENT}%, ${expectedCeilingPx(pane.baselinePx)}px)`,
      clampDeclaration !== null &&
        near(clampDeclaration.floorPx, pane.baselinePx, 0.01) &&
        near(clampDeclaration.ratioPercent, EXPECTED_RATIO_PERCENT, 0.01) &&
        near(clampDeclaration.ceilingPx, expectedCeilingPx(pane.baselinePx), 0.01),
      `实际 ${measured.computedMaxWidth}`,
    );

    // 2) 真实引擎把 clamp 解析进布局：渲染宽 = min(容器, max-width)
    //    （窄容器铺满、宽容器按比例加宽后封顶）。
    check(
      `[${pane.id}] 内容列渲染宽 ≈ ${expectedColumnWidth.toFixed(1)}px（解析后 max-width ≈ ${expectedMaxWidth.toFixed(1)}px）`,
      near(measured.columnWidth, expectedColumnWidth, 1),
      `实际 ${measured.columnWidth}px，容器 ${measured.containerWidth}px`,
    );

    // 3) 未占满容器时 `margin: 0 auto` 真实居中（左右边距差 ≤ 1.5px）。
    const leftGap = measured.columnLeft - measured.contentLeft;
    const rightGap = measured.contentRight - measured.columnRight;
    if (expectedColumnWidth < measured.containerWidth - 0.5) {
      check(
        `[${pane.id}] 内容列在容器内居中（左 ${leftGap.toFixed(1)} / 右 ${rightGap.toFixed(1)}）`,
        near(leftGap, rightGap, 1.5),
        `left=${leftGap} right=${rightGap}`,
      );
    } else {
      check(
        `[${pane.id}] 容器窄于 max-width 时内容列铺满（无溢出）`,
        near(measured.columnWidth, measured.containerWidth, 1),
        `column=${measured.columnWidth} container=${measured.containerWidth}`,
      );
    }

    // 4) 内容列绝不横向溢出容器（下限大于容器时也不得撑破）。
    check(
      `[${pane.id}] 内容列未横向溢出容器`,
      measured.columnWidth <= measured.containerWidth + 0.5,
      `column=${measured.columnWidth} container=${measured.containerWidth}`,
    );

    await scope.screenshot({ path: `/tmp/opencode/chat-content-width-${pane.id}.png` });
  }

  const docScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(
    `页面不出现横向溢出（文档宽 ≤ ${PAGE_VIEWPORT.width}）`,
    docScrollWidth <= PAGE_VIEWPORT.width + 1,
    `scrollWidth=${docScrollWidth}`,
  );
} finally {
  await browser.close();
}

console.log(`\n对话内容列宽度自适应验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
