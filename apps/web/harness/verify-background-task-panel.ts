/**
 * 后台任务面板（`BackgroundTaskPanel`）真实浏览器验收。
 *
 * 覆盖：
 *   - Wave 1 渲染骨架：5 个用例（fixtures / in-flight / loading / empty / error）× 3 视口
 *     都渲染出面板、无页面级错误、面板不横向溢出视口
 *   - Wave 3 行级断言：
 *     ① 每个 fixture 行 `scrollWidth <= clientWidth`（文本省略而非溢出）
 *     ② `task_id` / `terminalId` 复制按钮可见、可点、有 `aria-label`，点击不产生页面错误
 *     ③ 操作链路（点击 → 回调）＝打开子会话 / 停止子代理 / 查看后台命令 / 终止后台命令 / 全部停止 / 错误态重试，
 *        破坏性操作走确认弹窗
 *     ④ in-flight 用例：停止中 / 终止中按钮为 disabled
 *     ⑤ empty 态 + fixtures 态逐视口截图（/tmp/opencode/background-task-panel[-empty]-<width>.png）
 *
 * 运行方式见同目录 `README.md`。
 *
 * 另含**矮窗口阶段**（1280×460）：验证胶囊弹层在面板裁切约束下不被裁掉（`45vh` 加固的回归守卫）。
 *
 * ⚠️ 为什么 playwright 用动态导入 + NODE_PATH：
 * `apps/web` **不直接依赖** playwright（浏览器内核依赖只应存在于 `packages/browser-automation`），
 * 而 bun 对 workspace 包内的文件做严格依赖解析，裸名会直接报 `Cannot find package 'playwright'`。
 * 因此运行命令需指向该 workspace 的 node_modules —— 见下方 catch 分支与 README。
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-background-task-panel.ts',
  );
  process.exit(1);
}

const URL = 'http://127.0.0.1:5173/harness/background-task-panel.html';
const VIEWPORTS = [375, 768, 1280] as const;
const CASES = ['fixtures', 'in-flight', 'loading', 'empty', 'error'] as const;
const SCREENSHOT_DIR = '/tmp/opencode';

const failures: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes.push(name);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

interface HarnessWindow {
  __backgroundTaskPanelHarness?: { calls: string[] };
}

async function clearHarnessCalls(page: import('playwright').Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as unknown as HarnessWindow).__backgroundTaskPanelHarness;
    if (harness) harness.calls = [];
  });
}

async function readHarnessCalls(page: import('playwright').Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as HarnessWindow).__backgroundTaskPanelHarness?.calls ?? [],
  );
}

/** 行级断言 + 操作链路 + 截图（Wave 3）。 */
async function runWave3Checks(page: import('playwright').Page): Promise<void> {
  for (const width of VIEWPORTS) {
    const fixtures = page.locator(`.viewport[data-width="${width}"] [data-case="fixtures"]`);
    const rows = fixtures.locator('[data-testid="background-task-row"]');
    const rowCount = await rows.count();
    check(
      `[${width}] fixtures 渲染 4 行（2 子代理 + 2 命令）`,
      rowCount === 4,
      `count=${rowCount}`,
    );

    // ① 行不横向溢出 + ② 复制按钮可达
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const kind = (await row.getAttribute('data-kind')) ?? '?';
      const state = (await row.getAttribute('data-state')) ?? '?';
      const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
      check(`[${width}] ${kind}/${state} 行未横向溢出`, overflow <= 1, `overflow=${overflow}px`);

      const copyButton = row.locator('[data-testid="background-task-row-copy-id"]');
      const visible = await copyButton.isVisible();
      const enabled = await copyButton.isEnabled();
      const ariaLabel = (await copyButton.getAttribute('aria-label')) ?? '';
      check(`[${width}] ${kind}/${state} 复制按钮可见可点`, visible && enabled);
      check(`[${width}] ${kind}/${state} 复制按钮有 aria-label`, ariaLabel.length > 0);
      await copyButton.click(); // 剪贴板成功或被拒都算「可达」，只要不炸页面
    }
    check(`[${width}] 复制按钮点击未产生页面错误`, pageErrors.length === 0, pageErrors.join(' | '));

    // ③ 操作链路：点击 → 回调（破坏性操作走确认弹窗）
    const runningSubagent = fixtures
      .locator('[data-kind="subagent"][data-state="running"]')
      .first();
    const runningShell = fixtures.locator('[data-kind="shell"][data-state="running"]').first();

    await clearHarnessCalls(page);
    await runningSubagent.locator('[data-testid="background-task-row-open-session"]').click();
    check(
      `[${width}] 打开子会话回调`,
      (await readHarnessCalls(page)).includes('open:child-harness-running'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    await clearHarnessCalls(page);
    await runningSubagent.locator('[data-testid="background-task-row-stop"]').click();
    await page.locator('[data-testid="background-task-confirm-stop"]').click();
    check(
      `[${width}] 停止子代理回调（确认后）`,
      (await readHarnessCalls(page)).includes('stop:child-harness-running'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    await clearHarnessCalls(page);
    await runningShell.locator('[data-testid="background-task-row-preview-terminal"]').click();
    check(
      `[${width}] 查看后台命令回调`,
      (await readHarnessCalls(page)).includes('preview:term-harness-running'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    await clearHarnessCalls(page);
    await runningShell.locator('[data-testid="background-task-row-kill-terminal"]').click();
    await page.locator('[data-testid="background-task-confirm-kill"]').click();
    check(
      `[${width}] 终止后台命令回调（确认后）`,
      (await readHarnessCalls(page)).includes('kill:term-harness-running'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    await clearHarnessCalls(page);
    await fixtures.locator('[data-testid="background-task-stop-all"]').click();
    await page.locator('[data-testid="background-task-confirm-stop-all"]').click();
    check(
      `[${width}] 全部停止子代理回调（确认后）`,
      (await readHarnessCalls(page)).includes('stop-all'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    // ④ in-flight：停止中 / 终止中为禁用态
    const inFlight = page.locator(`.viewport[data-width="${width}"] [data-case="in-flight"]`);
    const inFlightStop = inFlight.locator(
      '[data-kind="subagent"][data-state="running"] [data-testid="background-task-row-stop"]',
    );
    const inFlightStopText = ((await inFlightStop.textContent()) ?? '').trim();
    check(`[${width}] 停止中按钮禁用`, await inFlightStop.isDisabled());
    check(`[${width}] 停止中按钮文案`, inFlightStopText.includes('停止中'), inFlightStopText);

    const inFlightKill = inFlight.locator(
      '[data-kind="shell"][data-state="running"] [data-testid="background-task-row-kill-terminal"]',
    );
    const inFlightKillText = ((await inFlightKill.textContent()) ?? '').trim();
    check(`[${width}] 终止中按钮禁用`, await inFlightKill.isDisabled());
    check(`[${width}] 终止中按钮文案`, inFlightKillText.includes('终止中'), inFlightKillText);

    // ⑤ 错误态重试 + 三态可见性 + 截图
    const emptyCase = page.locator(`.viewport[data-width="${width}"] [data-case="empty"]`);
    const errorCase = page.locator(`.viewport[data-width="${width}"] [data-case="error"]`);
    check(
      `[${width}] empty 态可见`,
      await emptyCase.locator('[data-testid="background-task-empty"]').isVisible(),
    );
    check(
      `[${width}] error 态可见`,
      await errorCase.locator('[data-testid="background-task-error"]').isVisible(),
    );
    await clearHarnessCalls(page);
    await errorCase.locator('[data-testid="background-task-retry"]').click();
    check(
      `[${width}] 错误态重试回调`,
      (await readHarnessCalls(page)).includes('reload'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    // ⑥ 常驻胶囊（composerFooterSlot）：可见性 / 展开 / 操作链路 / 空态不出现
    const chipCase = page.locator(`.viewport[data-width="${width}"] [data-case="chip"]`);
    const chip = chipCase.locator('[data-testid="background-task-chip"]');
    check(`[${width}] 胶囊可见`, await chip.isVisible());
    const chipBox = await chip.boundingBox();
    check(
      `[${width}] 胶囊未横向溢出容器`,
      chipBox !== null && chipBox.x >= 0 && chipBox.x + chipBox.width <= width + 1,
      JSON.stringify(chipBox),
    );
    await chip.click();
    const chipPopover = chipCase.locator('[data-testid="background-task-chip-popover"]');
    check(`[${width}] 胶囊展开列表`, await chipPopover.isVisible());
    check(
      `[${width}] 胶囊列表渲染 3 行活跃任务`,
      (await chipCase.locator('[data-testid="background-task-chip-row"]').count()) === 3,
    );

    await clearHarnessCalls(page);
    await chipCase.locator('[data-testid="background-task-chip-row-open-session"]').first().click();
    check(
      `[${width}] 胶囊：打开子会话回调`,
      (await readHarnessCalls(page)).includes('chip-open:child-harness-running'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    await chip.click();
    await clearHarnessCalls(page);
    await chipCase.locator('[data-testid="background-task-chip-row-stop"]').first().click();
    await page.locator('[data-testid="background-task-confirm-stop"]').click();
    check(
      `[${width}] 胶囊：停止子代理回调（确认后）`,
      (await readHarnessCalls(page)).includes('chip-stop:child-harness-running'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    await chip.click();
    await clearHarnessCalls(page);
    await chipCase
      .locator('[data-testid="background-task-chip-row-preview-terminal"]')
      .first()
      .click();
    check(
      `[${width}] 胶囊：查看终端回调`,
      (await readHarnessCalls(page)).includes('chip-preview:term-harness-running'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    await chip.click();
    await clearHarnessCalls(page);
    await chipCase.locator('[data-testid="background-task-chip-open-panel"]').click();
    check(
      `[${width}] 胶囊：打开完整面板回调`,
      (await readHarnessCalls(page)).includes('chip-open-panel'),
      JSON.stringify(await readHarnessCalls(page)),
    );

    await chip.click();
    check(`[${width}] 胶囊：列表可再次展开`, await chipPopover.isVisible());
    await page.keyboard.press('Escape');
    check(`[${width}] 胶囊：Esc 后列表关闭`, !(await chipPopover.isVisible()));

    check(
      `[${width}] 无活跃任务时不渲染胶囊`,
      (await page
        .locator(
          `.viewport[data-width="${width}"] [data-case="chip-idle"] [data-testid="background-task-chip"]`,
        )
        .count()) === 0,
    );
    await chipCase.screenshot({ path: `${SCREENSHOT_DIR}/background-task-chip-${width}.png` });

    await fixtures.screenshot({ path: `${SCREENSHOT_DIR}/background-task-panel-${width}.png` });
    await emptyCase.screenshot({
      path: `${SCREENSHOT_DIR}/background-task-panel-empty-${width}.png`,
    });
  }
}

const browser = await chromium.launch();
const pageErrors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('[data-component="background-task-panel"]', { timeout: 30_000 });
  } catch {
    console.error('后台任务面板未渲染 —— 请确认 Vite dev server 已在 127.0.0.1:5173 运行，');
    console.error('且 W1（use-background-task-panel）/ W2b（background-task-panel）已落盘。');
    for (const error of pageErrors) console.error(`  页面错误：${error}`);
    await browser.close();
    process.exit(1);
  }

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 1200 });
    const scope = page.locator(`.viewport[data-width="${width}"]`);

    for (const testCase of CASES) {
      const panel = scope.locator(
        `[data-case="${testCase}"] [data-component="background-task-panel"]`,
      );
      const count = await panel.count();
      check(`[${width}] ${testCase} 渲染面板`, count === 1, `count=${count}`);
      if (count !== 1) continue;

      const metrics = await panel.evaluate((el) => ({
        clientWidth: el.clientWidth,
        height: el.getBoundingClientRect().height,
      }));
      check(
        `[${width}] ${testCase} 面板可见（高度 > 0）`,
        metrics.height > 0,
        JSON.stringify(metrics),
      );
      check(
        `[${width}] ${testCase} 面板未横向溢出视口`,
        metrics.clientWidth <= width,
        `clientWidth=${metrics.clientWidth} width=${width}`,
      );
    }
  }

  check('无页面级错误', pageErrors.length === 0, pageErrors.join(' | '));

  // ── 矮窗口阶段：把浏览器压到 460px 高，验证胶囊弹层在「面板裁切 + composer 贴底」的
  // 真实约束下不被裁掉（`maxHeight` 的 `45vh` 是相对浏览器窗口的，必须在矮窗口里测；
  // 去掉 45vh 上限时本阶段会失败——即这条断言是 45vh 加固的回归守卫）。
  await page.setViewportSize({ width: 1280, height: 460 });
  await page.waitForTimeout(200);

  const shortCase = page.locator('.viewport[data-width="1280"] [data-case="chip-short"]');
  const shortPane = shortCase.locator('[data-testid="chip-short-pane"]');
  const shortChip = shortCase.locator('[data-testid="background-task-chip"]');
  check('[short] 矮面板内胶囊可见', await shortChip.isVisible());
  await shortChip.click(); // 点击会滚动到元素，几何必须在滚动之后再取
  const shortPopover = shortCase.locator('[data-testid="background-task-chip-popover"]');
  check('[short] 弹层可见', await shortPopover.isVisible());
  const shortPaneBox = await shortPane.boundingBox();
  const shortPopoverBox = await shortPopover.boundingBox();
  if (shortPaneBox && shortPopoverBox) {
    check(
      '[short] 弹层未被面板上沿裁掉（top 在面板内）',
      shortPopoverBox.y >= shortPaneBox.y - 0.5,
      `popoverTop=${Math.round(shortPopoverBox.y)} paneTop=${Math.round(shortPaneBox.y)}`,
    );
    check(
      '[short] 弹层未溢出面板下沿',
      shortPopoverBox.y + shortPopoverBox.height <= shortPaneBox.y + shortPaneBox.height + 0.5,
      `popoverBottom=${Math.round(shortPopoverBox.y + shortPopoverBox.height)} paneBottom=${Math.round(shortPaneBox.y + shortPaneBox.height)}`,
    );
  } else {
    check('[short] 弹层与面板几何可读', false, 'boundingBox 为空');
  }

  await clearHarnessCalls(page);
  const shortOpenPanel = shortCase.locator('[data-testid="background-task-chip-open-panel"]');
  check('[short] 底部「打开后台面板」可见', await shortOpenPanel.isVisible());
  await shortOpenPanel.click();
  check(
    '[short] 底部操作在矮窗口下仍可达',
    (await readHarnessCalls(page)).includes('chip-open-panel'),
    JSON.stringify(await readHarnessCalls(page)),
  );
  await shortCase.screenshot({ path: `${SCREENSHOT_DIR}/background-task-chip-short.png` });
  await page.setViewportSize({ width: 1280, height: 1200 });

  await runWave3Checks(page);
} finally {
  await browser.close();
}

console.log(
  `\n后台任务面板验收（三视口 375 / 768 / 1280）：${passes.length} 通过 / ${failures.length} 失败`,
);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
  console.log(
    `截图：${SCREENSHOT_DIR}/background-task-panel-{375,768,1280}.png 与 background-task-panel-empty-{375,768,1280}.png`,
  );
}
