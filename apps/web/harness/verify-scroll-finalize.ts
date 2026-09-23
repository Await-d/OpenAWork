/**
 * 对话 finalize 自动贴底验收（真实 Chromium）。
 *
 * 覆盖 jsdom 无法判定的部分：finalize（流式气泡 → 定稿消息）与流式收尾前后的
 * 布局变化之后，视口是否仍停在最新消息底部，还是被甩到前面。
 *
 * 场景：
 *   A. 完整流式 → 定稿
 *   B. 揭示滞后时定稿（定稿内容远长于屏幕上的流式内容）→ 定稿后延迟快照对账
 *   C. 流式结束后输入区高度变化（滚动区可视高度变化）→ 视口仍应贴底
 *   D. 纯推理段增长（无 buffer 变化）与定稿后才落地的迟到增长 → 只能靠内容列
 *      ResizeObserver 跟随（内容列盒子必须随内容增长）
 *
 * 运行方式见同目录 `README.md`。
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-scroll-finalize.ts',
  );
  process.exit(1);
}

import type { Page } from 'playwright';

const BASE_URL = 'http://127.0.0.1:5173/harness/scroll-finalize.html';
const MODES = ['short', 'long'] as const;
const FULL_ANSWER_PARAGRAPHS = 26;

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function readState(page: Page) {
  return page.evaluate(() => {
    const api = window.__scrollFinalizeHarness;
    if (!api) throw new Error('harness API 未就绪');
    return api.readState();
  });
}

async function openHarness(page: Page, mode: string): Promise<void> {
  await page.goto(`${BASE_URL}?mode=${mode}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__scrollFinalizeHarness), undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__scrollFinalizeHarness?.setReasoningExpanded(true));
}

async function waitForFullStream(page: Page): Promise<void> {
  await page.waitForFunction(
    (expected) => (window.__scrollFinalizeHarness?.progress().answerParagraphs ?? 0) >= expected,
    FULL_ANSWER_PARAGRAPHS,
    { timeout: 25_000 },
  );
  await page.waitForTimeout(400);
}

function describe(state: Awaited<ReturnType<typeof readState>>): string {
  return `distanceToBottom=${state.distanceToBottom.toFixed(1)} following=${state.following} showButton=${state.showScrollToBottom} lastGap=${state.lastGroupBottomGap?.toFixed(1)}`;
}

/**
 * 在一段时间窗内连续采样，返回「最小距底距离」与「是否全程保持跟随」。
 *
 * 内容逐 tick 增长时，跟随会以「增长 → 下一帧追平」的节奏推进，单点采样可能
 * 恰好落在追平前的一帧（历史缺陷是**永不追平**，而不是偶尔落后一帧）。因此
 * 「纯推理段增长仍贴底」这类断言用窗口内的最小值判定：只要窗口内出现过贴底，
 * 就证明跟随在推进；反过来，跟随被挂起 / RO 失效时永远到不了贴底。
 */
async function readMinDistance(
  page: Page,
  durationMs: number,
): Promise<{ minDistance: number; followingThroughout: boolean }> {
  const startedAt = Date.now();
  let minDistance = Number.POSITIVE_INFINITY;
  let followingThroughout = true;
  while (Date.now() - startedAt <= durationMs) {
    const state = await readState(page);
    minDistance = Math.min(minDistance, state.distanceToBottom);
    if (!state.following) followingThroughout = false;
    await page.waitForTimeout(60);
  }
  return { minDistance, followingThroughout };
}

const browser = await chromium.launch();
try {
  for (const mode of MODES) {
    // ── 场景 E：打开即贴底（长历史）+ 打开后迟到增长 ─────────────────
    // 打开一个已经有很多轮历史的会话：开屏贴底必须在首帧绘制前完成
    // （prePaintDistance），否则用户会先看到最旧的消息、之后才跳到最新；
    // 打开之后迟到落地的内容（异步 Markdown / 图片）也必须继续贴底。
    const pageE = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openHarness(pageE, mode);
    await pageE.waitForTimeout(200);
    const eOpen = await readState(pageE);
    check(
      `[E/${mode}] 打开长历史会话：首帧绘制前已贴底`,
      eOpen.prePaintDistance !== null && eOpen.prePaintDistance <= 1,
      `prePaintDistance=${eOpen.prePaintDistance?.toFixed(1)} ${describe(eOpen)}`,
    );
    check(
      `[E/${mode}] 打开后视口停在最新消息底部且跟随未挂起`,
      eOpen.distanceToBottom <= 1 && eOpen.following && !eOpen.showScrollToBottom,
      describe(eOpen),
    );

    await pageE.evaluate(() => window.__scrollFinalizeHarness?.lateGrow());
    await pageE.waitForTimeout(500);
    const eLate = await readState(pageE);
    check(`[E/${mode}] 打开后迟到增长仍自动贴底`, eLate.distanceToBottom <= 1, describe(eLate));
    console.log(`[E/${mode}] 开屏 ${describe(eOpen)} → 迟到增长 ${describe(eLate)}`);
    await pageE.close();

    // ── 场景 A：完整流式 → 定稿 ──────────────────────────────────────
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openHarness(page, mode);
    await page.evaluate(() => window.__scrollFinalizeHarness?.start());
    await waitForFullStream(page);

    const beforeFinalize = await readState(page);
    check(
      `[A/${mode}] 流式期间自动贴底`,
      beforeFinalize.distanceToBottom <= 1 && beforeFinalize.following,
      describe(beforeFinalize),
    );

    await page.evaluate(() => window.__scrollFinalizeHarness?.finalize());
    await page.waitForTimeout(120);
    const after120 = await readState(page);
    await page.waitForTimeout(400);
    const after520 = await readState(page);
    await page.waitForTimeout(1_200);
    const afterSettle = await readState(page);

    check(
      `[A/${mode}] finalize 后视口仍贴底（120ms）`,
      after120.distanceToBottom <= 1,
      describe(after120),
    );
    check(
      `[A/${mode}] finalize 后视口仍贴底（500ms）`,
      after520.distanceToBottom <= 1,
      describe(after520),
    );
    check(
      `[A/${mode}] finalize 后视口仍贴底（1.7s 稳态）`,
      afterSettle.distanceToBottom <= 1,
      describe(afterSettle),
    );
    check(
      `[A/${mode}] finalize 后跟随未被挂起`,
      afterSettle.following && !afterSettle.showScrollToBottom,
      describe(afterSettle),
    );
    console.log(`[A/${mode}] ${describe(afterSettle)}`);
    await page.close();

    // ── 场景 B：揭示滞后时定稿 + 延迟快照对账 ────────────────────────
    const pageB = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openHarness(pageB, mode);
    await pageB.evaluate(() => window.__scrollFinalizeHarness?.start());
    await pageB.waitForFunction(
      () => (window.__scrollFinalizeHarness?.progress().reasoningParagraphs ?? 0) >= 6,
      undefined,
      { timeout: 20_000 },
    );
    await pageB.waitForTimeout(120);

    await pageB.evaluate(() => window.__scrollFinalizeHarness?.finalize());
    await pageB.waitForTimeout(120);
    const bAfter120 = await readState(pageB);
    await pageB.waitForTimeout(1_600);
    const bAfterSettle = await readState(pageB);

    check(
      `[B/${mode}] 定稿瞬间的大幅增高后视口仍贴底（120ms）`,
      bAfter120.distanceToBottom <= 1,
      describe(bAfter120),
    );
    check(
      `[B/${mode}] 定稿瞬间的大幅增高后视口仍贴底（稳态）`,
      bAfterSettle.distanceToBottom <= 1,
      describe(bAfterSettle),
    );
    check(
      `[B/${mode}] 定稿后跟随未被挂起`,
      bAfterSettle.following && !bAfterSettle.showScrollToBottom,
      describe(bAfterSettle),
    );

    await pageB.evaluate(() => window.__scrollFinalizeHarness?.snapshotReload());
    await pageB.waitForTimeout(120);
    const afterReload120 = await readState(pageB);
    await pageB.waitForTimeout(600);
    const afterReload = await readState(pageB);
    check(
      `[B/${mode}] 延迟快照对账后视口仍贴底（120ms）`,
      afterReload120.distanceToBottom <= 1,
      describe(afterReload120),
    );
    check(
      `[B/${mode}] 延迟快照对账后视口仍贴底（稳态）`,
      afterReload.distanceToBottom <= 1,
      describe(afterReload),
    );
    console.log(`[B/${mode}] 定稿 ${describe(bAfterSettle)} → 快照 ${describe(afterReload)}`);
    await pageB.close();

    // ── 场景 C：流式结束后输入区高度变化（滚动区可视高度变化）────────
    const pageC = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openHarness(pageC, mode);
    await pageC.evaluate(() => window.__scrollFinalizeHarness?.start());
    await waitForFullStream(pageC);

    // 输入区变高（如统计行 / 排队提示出现）→ 滚动区变矮 → 到最新处的距离变大。
    await pageC.evaluate(() => window.__scrollFinalizeHarness?.setComposerHeight(220));
    await pageC.waitForTimeout(500);
    const cGrow = await readState(pageC);
    check(`[C/${mode}] 输入区变高后视口仍贴底`, cGrow.distanceToBottom <= 1, describe(cGrow));

    // 输入区变矮 → 滚动区变高 → 浏览器把 scrollTop 钳到新的 maxScrollTop。
    await pageC.evaluate(() => window.__scrollFinalizeHarness?.setComposerHeight(64));
    await pageC.waitForTimeout(500);
    const cShrink = await readState(pageC);
    check(
      `[C/${mode}] 输入区变矮（浏览器钳位）后视口仍贴底`,
      cShrink.distanceToBottom <= 1,
      describe(cShrink),
    );

    // 钳位之后定稿：内容增长不得被误判为外部滚动。
    await pageC.evaluate(() => window.__scrollFinalizeHarness?.finalize());
    await pageC.waitForTimeout(1_000);
    const cFinalize = await readState(pageC);
    check(`[C/${mode}] 钳位后定稿仍贴底`, cFinalize.distanceToBottom <= 1, describe(cFinalize));
    check(
      `[C/${mode}] 钳位后跟随未被挂起`,
      cFinalize.following && !cFinalize.showScrollToBottom,
      describe(cFinalize),
    );
    console.log(
      `[C/${mode}] 输入区变高 ${describe(cGrow)} → 变矮 ${describe(cShrink)} → 定稿 ${describe(cFinalize)}`,
    );
    await pageC.close();

    // ── 场景 D：纯推理段增长 + 迟到增长（只能靠内容列 RO 跟随）────────
    const pageD = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openHarness(pageD, mode);
    await pageD.evaluate(() => window.__scrollFinalizeHarness?.start());

    // 推理阶段没有任何 buffer 变化：跟随只能来自内容列 ResizeObserver。
    await pageD.waitForFunction(
      () => (window.__scrollFinalizeHarness?.progress().reasoningParagraphs ?? 0) >= 10,
      undefined,
      { timeout: 20_000 },
    );
    const dReasoning = await readMinDistance(pageD, 1_200);
    const dProgress = await pageD.evaluate(() => window.__scrollFinalizeHarness?.progress());
    check(
      `[D/${mode}] 纯推理段增长（无 buffer 变化）仍自动贴底`,
      dReasoning.minDistance <= 2 && dReasoning.followingThroughout,
      `windowMinDistance=${dReasoning.minDistance.toFixed(1)} followingThroughout=${dReasoning.followingThroughout} progress=${JSON.stringify(dProgress)}`,
    );

    // 定稿之后才落地的内容增长（异步 Markdown / 图片 / 工具输出）。
    await waitForFullStream(pageD);
    await pageD.evaluate(() => window.__scrollFinalizeHarness?.finalize());
    await pageD.waitForTimeout(500);
    const dFinalize = await readState(pageD);
    await pageD.evaluate(() => window.__scrollFinalizeHarness?.lateGrow());
    await pageD.waitForTimeout(500);
    const dLate = await readState(pageD);
    check(`[D/${mode}] 定稿后迟到增长仍自动贴底`, dLate.distanceToBottom <= 1, describe(dLate));
    check(
      `[D/${mode}] 迟到增长后跟随未被挂起`,
      dLate.following && !dLate.showScrollToBottom,
      describe(dLate),
    );
    console.log(
      `[D/${mode}] 推理段 windowMinDistance=${dReasoning.minDistance.toFixed(1)}（following=${dReasoning.followingThroughout}） → 定稿 ${describe(dFinalize)} → 迟到增长 ${describe(dLate)}`,
    );
    await pageD.close();
  }
} finally {
  await browser.close();
}

console.log(`\n对话 finalize 自动贴底验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
