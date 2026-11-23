/**
 * 用户消息「超长正文默认折叠」验收（真实 Chromium）。
 *
 * jsdom 没有布局引擎：`max-height: 60vh` 是否真的把正文钳住、按钮在 375px 下会不会
 * 溢出容器、展开后高度是否真的放开，只有真实引擎能判定。本脚本渲染真实链路并断言几何。
 *
 * 运行方式见同目录 `README.md`。
 *
 * ⚠️ playwright 用动态导入 + NODE_PATH，原因同 `verify-notice-3viewports.ts`：
 * `apps/web` 不直接依赖 playwright，bun 对 workspace 内文件做严格依赖解析。
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-user-message-fold.ts',
  );
  process.exit(1);
}

import type { Locator } from 'playwright';

const URL = 'http://127.0.0.1:5173/harness/user-message-fold.html';
const VIEWPORTS = [375, 768, 1280];
const LONG_LINE_COUNT = 300;

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

interface FoldGeometry {
  /** 浏览器视口高度，用于换算 `60vh` 的期望像素值。 */
  vh: number;
  foldScope: string | null;
  expanded: string | null;
  bodyMaxHeight: string;
  bodyClientHeight: number;
  bodyScrollHeight: number;
  contentHeight: number;
  contentWidth: number;
  whiteSpace: string;
  lineCount: number;
  containerLeft: number;
  containerRight: number;
  button: {
    text: string;
    left: number;
    right: number;
    visible: boolean;
  } | null;
}

/** 读取折叠的真实几何：折叠体可视高度 / 内容高度 / 按钮位置。 */
async function readFoldGeometry(caseLocator: Locator): Promise<FoldGeometry> {
  return caseLocator.evaluate((el) => {
    const content = el.querySelector<HTMLElement>('.chat-message-content');
    if (!content) {
      throw new Error('缺少 .chat-message-content');
    }
    const container = el.querySelector<HTMLElement>('.chat-markdown-fold-container');
    const body = container?.querySelector<HTMLElement>('.chat-markdown-fold-body') ?? null;
    const button = container?.querySelector<HTMLElement>('button') ?? null;
    const contentRect = content.getBoundingClientRect();
    const containerRect = container?.getBoundingClientRect() ?? null;
    const buttonRect = button?.getBoundingClientRect() ?? null;
    const bodyStyle = body ? getComputedStyle(body) : null;

    return {
      vh: window.innerHeight,
      foldScope: container?.getAttribute('data-fold-scope') ?? null,
      expanded: container?.getAttribute('data-expanded') ?? null,
      bodyMaxHeight: bodyStyle?.maxHeight ?? '',
      bodyClientHeight: body?.clientHeight ?? 0,
      bodyScrollHeight: body?.scrollHeight ?? 0,
      contentHeight: contentRect.height,
      contentWidth: contentRect.width,
      whiteSpace: getComputedStyle(content).whiteSpace,
      lineCount: (content.textContent ?? '').split('\n').length,
      containerLeft: containerRect?.left ?? contentRect.left,
      containerRight: containerRect?.right ?? contentRect.right,
      button:
        button && buttonRect
          ? {
              text: (button.textContent ?? '').trim(),
              left: buttonRect.left,
              right: buttonRect.right,
              visible: buttonRect.width > 0 && buttonRect.height > 0,
            }
          : null,
    };
  });
}

const browser = await chromium.launch();

try {
  // 视口高度 720 → 60vh = 432px；300 行正文 ≈ 6900px，折叠必然发生裁剪。
  const page = await browser.newPage({ viewport: { width: 1400, height: 720 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page
    .locator('.viewport[data-viewport="375"] [data-case="user-long"] .chat-markdown-fold-container')
    .waitFor({ state: 'attached', timeout: 30_000 });

  for (const width of VIEWPORTS) {
    const scope = page.locator(`.viewport[data-viewport="${width}"]`);
    const longCase = scope.locator('[data-case="user-long"]');
    const prefix = `[${width}]`;

    const folded = await readFoldGeometry(longCase);
    // `max-height: 60vh` 由真实引擎解析成像素：期望值从 window.innerHeight 推导，
    // 不在脚本里写死 432 —— 换浏览器视口高度时断言自动跟随。
    const sixtyVh = folded.vh * 0.6;

    check(
      `${prefix} 超长用户消息默认折叠且标记为用户侧折叠`,
      folded.foldScope === 'user' && folded.expanded === 'false',
      `scope=${folded.foldScope} expanded=${folded.expanded}`,
    );
    check(
      `${prefix} 折叠体高度被钳到 60vh`,
      Math.abs(folded.bodyClientHeight - sixtyVh) <= 1,
      `clientHeight=${folded.bodyClientHeight} 60vh=${sixtyVh}`,
    );
    check(
      `${prefix} 折叠体确实发生裁剪（内容高于可视区）`,
      folded.bodyScrollHeight > folded.bodyClientHeight + 1,
      `scrollHeight=${folded.bodyScrollHeight} clientHeight=${folded.bodyClientHeight}`,
    );
    check(
      `${prefix} 整条消息不把页面撑开（内容区高度 ≈ 折叠体高度）`,
      // 折叠按钮在折叠态是绝对定位，不占布局高度，因此内容区高度应≈折叠体高度。
      folded.contentHeight <= folded.bodyClientHeight + 1,
      `contentHeight=${folded.contentHeight} bodyClientHeight=${folded.bodyClientHeight}`,
    );
    check(
      `${prefix} 用户消息正文保留 pre-wrap 换行`,
      folded.whiteSpace === 'pre-wrap' && folded.lineCount === LONG_LINE_COUNT,
      `whiteSpace=${folded.whiteSpace} lineCount=${folded.lineCount}`,
    );
    check(
      `${prefix} 展开按钮带字符数且可见`,
      folded.button !== null &&
        folded.button.text.startsWith('展开全部 ·') &&
        folded.button.visible,
      `button=${folded.button ? `${folded.button.text} visible=${folded.button.visible}` : 'null'}`,
    );
    check(
      `${prefix} 展开按钮水平居中且不溢出内容容器`,
      folded.button !== null &&
        folded.button.left >= folded.containerLeft - 0.5 &&
        folded.button.right <= folded.containerRight + 0.5,
      folded.button
        ? `button=[${folded.button.left.toFixed(1)},${folded.button.right.toFixed(1)}] container=[${folded.containerLeft.toFixed(1)},${folded.containerRight.toFixed(1)}]`
        : 'button=null',
    );

    // 展开：高度放开，正文完整可见
    await longCase.getByRole('button', { name: '展开全部消息内容' }).click();
    const expanded = await readFoldGeometry(longCase);
    check(
      `${prefix} 点击展开后高度放开（内容不再被 60vh 裁剪）`,
      expanded.expanded === 'true' && expanded.bodyClientHeight > sixtyVh + 1,
      `expanded=${expanded.expanded} clientHeight=${expanded.bodyClientHeight} 60vh=${sixtyVh}`,
    );
    check(
      `${prefix} 展开后提供「收起」按钮`,
      (await longCase.getByRole('button', { name: '收起消息内容' }).count()) === 1,
    );

    // 收起：回到 60vh
    await longCase.getByRole('button', { name: '收起消息内容' }).click();
    const recollapsed = await readFoldGeometry(longCase);
    check(
      `${prefix} 点击收起后重新折回 60vh`,
      recollapsed.expanded === 'false' && Math.abs(recollapsed.bodyClientHeight - sixtyVh) <= 1,
      `expanded=${recollapsed.expanded} clientHeight=${recollapsed.bodyClientHeight}`,
    );

    // 短消息：不产生任何折叠控件
    const shortCase = scope.locator('[data-case="user-short"]');
    const shortFoldCount = await shortCase.locator('.chat-markdown-fold-container').count();
    const shortButtonCount = await shortCase.locator('.chat-markdown-fold-expand').count();
    check(
      `${prefix} 短用户消息不折叠`,
      shortFoldCount === 0 && shortButtonCount === 0,
      `foldContainers=${shortFoldCount} expandButtons=${shortButtonCount}`,
    );
    check(
      `${prefix} 短用户消息正文正常可见`,
      (await shortCase.getByText('帮我看下这个报错是什么原因。').count()) === 1,
    );
  }
} finally {
  await browser.close();
}

console.log(`\n用户消息超长正文折叠验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
