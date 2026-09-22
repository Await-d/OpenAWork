/**
 * 思考块「贴底折叠窗口」验收（真实 Chromium）。
 *
 * jsdom 没有布局引擎：折起来之后**看到哪几行**、流式追加后新内容是否自动进入可见区，
 * 只有真实引擎能判定。本脚本渲染真实链路并断言几何位置。
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
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-reasoning-tail-window.ts',
  );
  process.exit(1);
}

import type { Locator, Page } from 'playwright';

const URL = 'http://127.0.0.1:5173/harness/reasoning-tail-window.html';
const VIEWPORTS = [375, 768, 1280];
const LINE_APPEND_COUNT = 3;

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

interface ParagraphGeometry {
  text: string;
  top: number;
  bottom: number;
  lineHeight: number;
}

interface WindowGeometry {
  collapsed: string | null;
  collapsedWindow: string | null;
  body: {
    top: number;
    bottom: number;
    height: number;
    maxHeight: string;
    overflow: string;
    display: string;
    flexDirection: string;
    clientHeight: number;
    scrollHeight: number;
  };
  contentHeight: number;
  first: ParagraphGeometry | null;
  last: ParagraphGeometry | null;
  caretHostIsLast: boolean;
}

/** 读取折叠窗口的真实几何：容器可视盒 + 首/末段落的实际位置。 */
async function readWindowGeometry(block: Locator): Promise<WindowGeometry> {
  return block.evaluate((el) => {
    const section = el as HTMLElement;
    const body = section.querySelector<HTMLElement>('.assistant-reasoning-body');
    if (!body) {
      throw new Error('缺少 .assistant-reasoning-body');
    }
    const style = getComputedStyle(body);
    const bodyRect = body.getBoundingClientRect();
    const paragraphs = [...body.querySelectorAll('p')];
    const readParagraph = (paragraph: Element | undefined): ParagraphGeometry | null => {
      if (!paragraph) {
        return null;
      }
      const rect = paragraph.getBoundingClientRect();
      return {
        text: paragraph.textContent ?? '',
        top: rect.top,
        bottom: rect.bottom,
        lineHeight: Number.parseFloat(getComputedStyle(paragraph).lineHeight) || 0,
      };
    };
    const markdown = body.querySelector('.assistant-rich-content-body > .chat-markdown');
    return {
      collapsed: section.getAttribute('data-collapsed'),
      collapsedWindow: section.getAttribute('data-collapsed-window'),
      body: {
        top: bodyRect.top,
        bottom: bodyRect.bottom,
        height: bodyRect.height,
        maxHeight: style.maxHeight,
        overflow: style.overflow,
        display: style.display,
        flexDirection: style.flexDirection,
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
      },
      first: readParagraph(paragraphs[0]),
      last: readParagraph(paragraphs.at(-1)),
      contentHeight: body.firstElementChild?.getBoundingClientRect().height ?? 0,
      caretHostIsLast:
        markdown !== null &&
        markdown.lastElementChild === paragraphs.at(-1) &&
        paragraphs.length > 0,
    };
  });
}

/** 折叠窗口的通用不变量：末段完整可见且贴底、首段被裁到容器上方。 */
function isTailWindow(geometry: WindowGeometry): boolean {
  const { body, first, last } = geometry;
  if (!first || !last) {
    return false;
  }
  const lastFullyVisible = last.top >= body.top - 0.5 && last.bottom <= body.bottom + 0.5;
  const lastSitsAtBottom = body.bottom - last.bottom < Math.max(last.lineHeight, 8);
  const firstClippedAbove = first.bottom <= body.top + 0.5;
  return lastFullyVisible && lastSitsAtBottom && firstClippedAbove;
}

async function waitForLastParagraph(page: Page, text: string): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const bodies = [...document.querySelectorAll('.assistant-reasoning-body')];
      return bodies.some((body) => {
        const paragraphs = body.querySelectorAll('p');
        const last = paragraphs[paragraphs.length - 1];
        return last?.textContent?.includes(expected) === true;
      });
    },
    text,
    { timeout: 30_000 },
  );
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.assistant-reasoning-body p', { timeout: 30_000 });
  // 等 Markdown 惰性渲染块全部就位（Suspense 兜底期间段落数会偏少）。
  // 只约束三个"纯推理块"用例：长消息用例里的 ```thinking 围栏不是段落。
  await page.waitForFunction(
    () => {
      const reasoningCases = ['live-streaming', 'static-finalized', 'static-long-reasoning'];
      return reasoningCases.every((name) =>
        [...document.querySelectorAll(`[data-case="${name}"] .assistant-reasoning-body`)].every(
          (body) => body.querySelectorAll('p').length >= 24,
        ),
      );
    },
    undefined,
    { timeout: 30_000 },
  );

  for (const width of VIEWPORTS) {
    const scope = page.locator(`.viewport[data-viewport="${width}"]`);
    const liveBlock = scope.locator('[data-case="live-streaming"] .assistant-reasoning-block');
    const staticBlock = scope.locator('[data-case="static-finalized"] .assistant-reasoning-block');

    for (const [label, block] of [
      ['流式', liveBlock],
      ['静态', staticBlock],
    ] as const) {
      const geometry = await readWindowGeometry(block);
      const prefix = `[${width}] ${label}`;

      check(
        `${prefix} 折叠态标记为贴底窗口`,
        geometry.collapsed === 'true' && geometry.collapsedWindow === 'tail',
        `collapsed=${geometry.collapsed} window=${geometry.collapsedWindow}`,
      );
      check(
        `${prefix} 折叠容器为 column-reverse 贴底布局`,
        geometry.body.display === 'flex' && geometry.body.flexDirection === 'column-reverse',
        `display=${geometry.body.display} flexDirection=${geometry.body.flexDirection}`,
      );
      check(
        `${prefix} 折叠窗口确实发生裁剪（内容高于窗口）`,
        // `overflow: clip` 不产生滚动区，`scrollHeight` 会被钳到 clientHeight，
        // 因此用**内容子块**的真实高度判断是否溢出。
        geometry.contentHeight > geometry.body.clientHeight + 1,
        `contentHeight=${geometry.contentHeight} clientHeight=${geometry.body.clientHeight}`,
      );
      check(
        `${prefix} 可见区落在末尾（末段完整可见并贴底、首段被裁在窗口上方）`,
        isTailWindow(geometry),
        `body=[${geometry.body.top.toFixed(1)},${geometry.body.bottom.toFixed(1)}] first=${geometry.first?.top.toFixed(1)}..${geometry.first?.bottom.toFixed(1)} last=${geometry.last?.top.toFixed(1)}..${geometry.last?.bottom.toFixed(1)}`,
      );
    }

    // 流式与静态的窗口高度一致（finalize 不产生跳动）
    const liveGeometry = await readWindowGeometry(liveBlock);
    const staticGeometry = await readWindowGeometry(staticBlock);
    check(
      `[${width}] 流式与静态折叠窗口高度一致`,
      Math.abs(liveGeometry.body.height - staticGeometry.body.height) < 0.5,
      `live=${liveGeometry.body.height} static=${staticGeometry.body.height}`,
    );
    check(
      `[${width}] 流式光标落在可见末段上`,
      liveGeometry.caretHostIsLast,
      `caretHostIsLast=${liveGeometry.caretHostIsLast}`,
    );

    // 流式继续输出：新末行自动进入可见区，窗口整体上移
    const previousLastText = liveGeometry.last?.text ?? '';
    const nextTotal = await page.evaluate(
      (count) => window.__reasoningHarnessAppendLines?.(count) ?? 0,
      LINE_APPEND_COUNT,
    );
    await waitForLastParagraph(page, `思考行 ${nextTotal}`);
    const grown = await readWindowGeometry(liveBlock);
    check(
      `[${width}] 新增末行完整可见并贴底`,
      isTailWindow(grown),
      `body=[${grown.body.top.toFixed(1)},${grown.body.bottom.toFixed(1)}] last=${grown.last?.top.toFixed(1)}..${grown.last?.bottom.toFixed(1)}`,
    );

    // 原末行此刻应位于可见窗口之上（证明窗口跟着最新内容上移，而不是停在旧位置）
    const previousLastClipped = await liveBlock.evaluate((el, text) => {
      const body = el.querySelector('.assistant-reasoning-body');
      if (!body) {
        return false;
      }
      const match = [...body.querySelectorAll('p')].find((p) => p.textContent === text);
      if (!match) {
        return false;
      }
      return match.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 0.5;
    }, previousLastText);
    check(
      `[${width}] 窗口已跟随最新内容上移（原末行被裁到窗口上方）`,
      (grown.last?.text ?? '').includes(`思考行 ${nextTotal}`) && previousLastClipped,
      `previousLast=${previousLastText.slice(0, 12)}…`,
    );

    // 展开 → 收起：可见区回到末尾
    await liveBlock.getByRole('button', { name: '展开', exact: true }).click();
    const expanded = await readWindowGeometry(liveBlock);
    check(
      `[${width}] 点击展开后解除裁剪且开头可见`,
      expanded.collapsed === null &&
        expanded.body.maxHeight === 'none' &&
        expanded.contentHeight <= expanded.body.clientHeight + 1 &&
        (expanded.first?.top ?? -1) >= expanded.body.top - 0.5,
      `maxHeight=${expanded.body.maxHeight} first=${expanded.first?.top.toFixed(1)} bodyTop=${expanded.body.top.toFixed(1)}`,
    );

    await liveBlock.getByRole('button', { name: '收起', exact: true }).click();
    const recollapsed = await readWindowGeometry(liveBlock);
    check(
      `[${width}] 点击收起后可见区回到最新思考内容`,
      recollapsed.collapsedWindow === 'tail' && isTailWindow(recollapsed),
      `window=${recollapsed.collapsedWindow} last=${recollapsed.last?.top.toFixed(1)}..${recollapsed.last?.bottom.toFixed(1)} bodyBottom=${recollapsed.body.bottom.toFixed(1)}`,
    );

    // 长思考（>1500 字符）：思考块自带折叠，内部不得再叠加消息级「展开全部」提示
    const longBlock = scope.locator(
      '[data-case="static-long-reasoning"] .assistant-reasoning-block',
    );
    await longBlock.getByRole('button', { name: '展开', exact: true }).click();
    // Markdown 在 ChatPageSections 里是 React.lazy：等真实块渲染出来再断言
    await longBlock.locator('.chat-markdown-code-block').first().waitFor({ state: 'attached' });
    const nestedFold = await longBlock.evaluate((el) => {
      const body = el.querySelector('.assistant-reasoning-body');
      const buttons = [...(body?.querySelectorAll('button') ?? [])].map((button) =>
        (button.textContent ?? '').trim(),
      );
      const foldBody = body?.querySelector<HTMLElement>('.chat-markdown-fold-body');
      return {
        foldContainerCount: body?.querySelectorAll('.chat-markdown-fold-container').length ?? -1,
        foldBodyMaxHeight: foldBody ? getComputedStyle(foldBody).maxHeight : null,
        buttons,
        codeBlockCount: body?.querySelectorAll('.chat-markdown-code-block').length ?? 0,
        codeFoldButtonCount:
          body?.querySelectorAll('[data-testid="chat-markdown-code-expand"]').length ?? 0,
        collapsedCodeBlockCount:
          body?.querySelectorAll('.chat-markdown-code-block[data-collapsed="true"]').length ?? 0,
      };
    });
    check(
      `[${width}] 展开长思考后没有第二层「展开全部」折叠提示`,
      nestedFold.foldContainerCount === 0 &&
        nestedFold.foldBodyMaxHeight === null &&
        !nestedFold.buttons.some((text) => text.startsWith('展开全部')),
      `foldContainerCount=${nestedFold.foldContainerCount} foldBodyMaxHeight=${nestedFold.foldBodyMaxHeight} buttons=${nestedFold.buttons.join(' | ')}`,
    );
    check(
      `[${width}] 长思考内部的长代码块也不自折叠`,
      nestedFold.codeBlockCount >= 1 &&
        nestedFold.codeFoldButtonCount === 0 &&
        nestedFold.collapsedCodeBlockCount === 0,
      `codeBlockCount=${nestedFold.codeBlockCount} codeFoldButtonCount=${nestedFold.codeFoldButtonCount} collapsedCodeBlockCount=${nestedFold.collapsedCodeBlockCount}`,
    );

    // 展开长思考后内容应完整可见（不再被 60vh 裁剪）
    const longExpanded = await readWindowGeometry(longBlock);
    check(
      `[${width}] 展开长思考后内容完整可见（无二次裁剪）`,
      longExpanded.contentHeight <= longExpanded.body.clientHeight + 1 &&
        (longExpanded.first?.top ?? -1) >= longExpanded.body.top - 0.5,
      `contentHeight=${longExpanded.contentHeight} clientHeight=${longExpanded.body.clientHeight}`,
    );

    await longBlock.getByRole('button', { name: '收起', exact: true }).click();

    // 长正文 + ```thinking 围栏：折叠归属外层（消息级），内层不再出现「展开思考」
    const fenceCase = scope.locator('[data-case="long-message-thinking-fence"]');
    await fenceCase.locator('.assistant-reasoning-block').first().waitFor({ state: 'attached' });
    const fenceFolds = await fenceCase.evaluate((el) => {
      const foldBody = el.querySelector<HTMLElement>('.chat-markdown-fold-body');
      const foldBodyMaxHeight = foldBody
        ? Number.parseFloat(getComputedStyle(foldBody).maxHeight)
        : 0;
      return {
        messageFoldCount: el.querySelectorAll('.chat-markdown-fold-container').length,
        thinkingBlockCount: el.querySelectorAll('.assistant-reasoning-block').length,
        thinkingFoldPromptCount: [...el.querySelectorAll('button')].filter((button) =>
          (button.textContent ?? '').includes('展开思考'),
        ).length,
        messageFoldPromptCount: [...el.querySelectorAll('button')].filter((button) =>
          (button.textContent ?? '').startsWith('展开全部 ·'),
        ).length,
        foldBodyMaxHeight: Number.isFinite(foldBodyMaxHeight) ? foldBodyMaxHeight : 0,
      };
    });
    check(
      `[${width}] 长消息里的思考围栏块不自折叠（只有消息级一层提示）`,
      fenceFolds.messageFoldCount === 1 &&
        fenceFolds.messageFoldPromptCount === 1 &&
        fenceFolds.thinkingBlockCount >= 1 &&
        fenceFolds.thinkingFoldPromptCount === 0,
      JSON.stringify(fenceFolds),
    );
    check(
      `[${width}] 长消息的折叠仍把正文裁到 60vh`,
      fenceFolds.foldBodyMaxHeight > 0,
      `foldBodyMaxHeight=${fenceFolds.foldBodyMaxHeight}`,
    );
  }
} finally {
  await browser.close();
}

console.log(`\n思考块贴底折叠窗口验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
