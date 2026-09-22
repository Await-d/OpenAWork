/**
 * T-30 组件级三视口验收（真实 Chromium）。
 * 覆盖 jsdom 覆盖不到的部分：真实布局下的截断、真实引擎解析的语义色与 focus ring。
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
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-notice-3viewports.ts',
  );
  process.exit(1);
}

import { color } from '../../../packages/shared-ui/src/tokens.js';

const URL = 'http://127.0.0.1:5173/harness/notice-3viewports.html';
const VIEWPORTS = [375, 768, 1280];

/**
 * 从 `var(--x, #rrggbb)` 形式的 token 取出兜底色，并转成浏览器 `getComputedStyle`
 * 返回的 `rgb(r, g, b)` 格式。
 *
 * **为什么从 token 模块推导而不是写死**：写死会在 token 调整后**静默失效**
 * （断言仍绿但已与组件实际取值脱钩）。这里直接读真实来源，token 一改断言即跟着改。
 */
function fallbackToRgb(token: string): string {
  const match = /#([0-9a-f]{6})/i.exec(token);
  const hex = match?.[1];
  if (!hex) {
    throw new Error(`token 未包含 hex 兜底色，无法推导期望值: ${token}`);
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * `color.accentSubtle` 形如 `var(--accent-subtle, rgba(92, 212, 192, 0.07))`。
 * focus ring 的 `boxShadow` 计算值只会出现 `rgba(r, g, b` 前缀（alpha 由浏览器重写），
 * 因此取该前缀做子串比较，避免写死色值。
 */
function accentSubtleRgbPrefix(): string {
  const match = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+/.exec(color.accentSubtle);
  const prefix = match?.[0];
  if (!prefix) {
    throw new Error(`token 未包含 rgba 兜底色，无法推导 focus 阴影期望值: ${color.accentSubtle}`);
  }
  return prefix;
}

/** 兜底链期望值：页面上**没有**定义这些 CSS 变量，组件应落到 token 的 hex 兜底。 */ const FALLBACK_COLORS =
  {
    done: fallbackToRgb(color.aux),
    failed: fallbackToRgb(color.danger),
    cancelled: fallbackToRgb(color.warning),
  } as const;

/** 主题链期望值：与 `notice-3viewports.html` 的 `.themed` 哨兵色值一一对应。 */
const THEMED_COLORS = {
  done: 'rgb(18, 52, 86)', // --aux #123456
  failed: 'rgb(35, 69, 103)', // --danger #234567
  cancelled: 'rgb(52, 86, 120)', // --warning #345678
} as const;

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-component="subagent-notice"]', { timeout: 30_000 });

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 1200 });

    const scope = page.locator('.viewport', { hasText: `${width}px` }).first();

    // 1) 五种用例都渲染出来了（failed 空描述强制可见；其余正常渲染）
    for (const testCase of ['done-long', 'failed-long', 'cancelled-long', 'failed-empty-desc']) {
      const row = scope.locator(`[data-case="${testCase}"] [data-component="subagent-notice"]`);
      check(`[${width}] ${testCase} 渲染`, (await row.count()) === 1);
    }

    // 2) 长描述在真实布局下被截断（ellipsis 生效）
    const doneRow = scope.locator('[data-case="done-long"] [data-component="subagent-notice"]');
    const truncation = await doneRow.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        clientWidth: el.clientWidth,
        overflow: style.overflow,
        scrollWidth: el.scrollWidth,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    check(
      `[${width}] 截断样式恒定生效`,
      truncation.textOverflow === 'ellipsis' &&
        truncation.whiteSpace === 'nowrap' &&
        truncation.overflow === 'hidden',
      JSON.stringify(truncation),
    );
    // 溢出只在「内容装不下」时发生：375/768 必须溢出（验证 ellipsis 真的在裁剪），
    // 1280 下长描述可容纳 → 不应溢出（否则说明行被撑开或样式异常）。
    if (width < 1280) {
      check(
        `[${width}] 长描述确实溢出并被裁剪`,
        truncation.scrollWidth > truncation.clientWidth,
        JSON.stringify(truncation),
      );
    } else {
      check(
        `[${width}] 宽视口下不溢出（行宽受容器约束）`,
        truncation.scrollWidth <= truncation.clientWidth && truncation.clientWidth === width,
        JSON.stringify(truncation),
      );
    }
    check(
      `[${width}] 通知行未超出视口宽度`,
      truncation.clientWidth <= width,
      `clientWidth=${truncation.clientWidth} width=${width}`,
    );

    // 3) 兜底链三态语义色（页面上未定义这些变量 → 组件应落到 token 的 hex 兜底）
    for (const state of ['done', 'failed', 'cancelled'] as const) {
      const agentSpan = scope.locator(
        `[data-case="${state}-long"] [data-component="subagent-notice"] > span:nth-child(2)`,
      );
      const computed = await agentSpan.evaluate((el) => getComputedStyle(el).color);
      check(
        `[${width}] 兜底链 ${state} 语义色`,
        computed === FALLBACK_COLORS[state],
        `实际 ${computed} 期望 ${FALLBACK_COLORS[state]}`,
      );
    }

    // 3b) 主题链三态语义色（`.themed` 提供哨兵变量 → 组件应跟随变量而非兜底）
    for (const state of ['done', 'failed', 'cancelled'] as const) {
      const agentSpan = scope.locator(
        `[data-case="themed-${state}"] [data-component="subagent-notice"] > span:nth-child(2)`,
      );
      const computed = await agentSpan.evaluate((el) => getComputedStyle(el).color);
      check(
        `[${width}] 主题链 ${state} 跟随变量`,
        computed === THEMED_COLORS[state],
        `实际 ${computed} 期望 ${THEMED_COLORS[state]}`,
      );
    }

    // 4) failed 空描述仍然可见（有实际高度）
    const failedEmpty = scope.locator(
      '[data-case="failed-empty-desc"] [data-component="subagent-notice"]',
    );
    const failedEmptyHeight = await failedEmpty.evaluate((el) => el.getBoundingClientRect().height);
    check(`[${width}] failed 空描述强制可见`, failedEmptyHeight > 0, `height=${failedEmptyHeight}`);

    // 5) focus ring（accent 2px + 4px subtle 阴影；期望值同样从 token 推导）
    const focusTarget = scope.locator('[data-case="done-long"] button');
    await focusTarget.focus();
    const focusStyle = await focusTarget.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        boxShadow: style.boxShadow,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    check(
      `[${width}] focus ring 生效`,
      focusStyle.outlineStyle === 'solid' &&
        focusStyle.outlineWidth === '2px' &&
        focusStyle.outlineColor === fallbackToRgb(color.accent) &&
        focusStyle.outlineOffset === '2px' &&
        focusStyle.boxShadow.includes(accentSubtleRgbPrefix()),
      JSON.stringify(focusStyle),
    );

    // 6) 点击回传子会话 id
    await page.evaluate(() => {
      window.__noticeHarnessClicks = [];
    });
    await scope.locator('[data-case="done-long"] button').click();
    const clicks = await page.evaluate(() => window.__noticeHarnessClicks ?? []);
    check(
      `[${width}] 点击回传子会话 id`,
      clicks.includes('done:child-harness-1'),
      JSON.stringify(clicks),
    );

    // 8) 两条**真实链路**内的截断（chat 虚拟化定位层 / team column-flex 链）
    for (const chain of ['chat-chain', 'team-chain'] as const) {
      const row = scope.locator(`[data-case="${chain}"] [data-component="subagent-notice"]`);
      const metrics = await row.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          textOverflow: style.textOverflow,
        };
      });
      check(
        `[${width}] ${chain} 内不超出视口`,
        metrics.clientWidth <= width,
        JSON.stringify(metrics),
      );
      if (width < 1280) {
        check(
          `[${width}] ${chain} 内截断生效`,
          metrics.textOverflow === 'ellipsis' && metrics.scrollWidth > metrics.clientWidth,
          JSON.stringify(metrics),
        );
      }
    }

    // 7) 不可点击的用例渲染为 div 而非 button
    const cancelledIsButton = await scope.locator('[data-case="cancelled-long"] button').count();
    check(`[${width}] 无 childID 时不可点击`, cancelledIsButton === 0);
  }
} finally {
  await browser.close();
}

console.log(`\nT-30 组件级三视口验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
