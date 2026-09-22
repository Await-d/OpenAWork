/**
 * `DevtoolsSectionNav` 交互状态验收（真实 Chromium）。
 *
 * 运行方式见同目录 `README.md`：
 *   NODE_PATH=packages/browser-automation/node_modules \
 *     bun apps/web/harness/verify-devtools-nav.ts
 *
 * 守卫目标：hover / focus 的计算样式必须来自**真实存在的 token 变量**。
 * 历史缺陷：devtools 的 hover 曾写成不存在的 `--bg-subtle`，浏览器解析失败后
 * 背景静默保持初始值——内联样式断言发现不了，只有真实引擎的计算值能判定。
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-devtools-nav.ts',
  );
  process.exit(1);
}

const URL = 'http://127.0.0.1:5173/harness/devtools-nav.html';

/** 与 `devtools-nav.html` 的 `.harness-theme` 哨兵色值一一对应（两处必须同步）。 */
const SENTINEL = {
  bgHover: 'rgb(13, 59, 46)', // --bg-hover #0d3b2e
  accent: 'rgb(124, 58, 237)', // --accent #7c3aed
  trapBgSubtle: 'rgb(255, 0, 255)', // --bg-subtle #ff00ff（陷阱：组件不得使用）
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 400 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-case="nav"] [role="group"]', { timeout: 30_000 });

  const nav = page.locator('[data-case="nav"]');
  const tab = (label: string) => nav.getByRole('button', { name: new RegExp(`^${label}`) });

  // 1) 四个分区渲染，初始选中「总览」
  for (const label of ['总览', '诊断', '日志', 'Worker']) {
    check(`渲染分区「${label}」`, (await tab(label).count()) === 1);
  }
  check(
    '初始选中「总览」',
    (await tab('总览').getAttribute('aria-pressed')) === 'true' &&
      (await tab('诊断').getAttribute('aria-pressed')) === 'false',
  );

  // 2) 未选中分区 hover：背景必须解析为 --bg-hover 哨兵（而非陷阱 --bg-subtle）
  await tab('诊断').hover();
  await page.waitForTimeout(300);
  const hoverBg = await tab('诊断').evaluate((el) => getComputedStyle(el).backgroundColor);
  check(`未选中分区 hover 背景 = --bg-hover 哨兵`, hoverBg === SENTINEL.bgHover, hoverBg);
  check(`未选中分区 hover 未误用 --bg-subtle`, hoverBg !== SENTINEL.trapBgSubtle, hoverBg);

  // 3) 选中分区 hover：保持 accent 背景
  await tab('总览').hover();
  await page.waitForTimeout(300);
  const selectedHoverBg = await tab('总览').evaluate((el) => getComputedStyle(el).backgroundColor);
  check(`选中分区 hover 保持 accent`, selectedHoverBg === SENTINEL.accent, selectedHoverBg);

  // 4) focus ring：2px accent + offset 2px
  await tab('日志').focus();
  const focusStyle = await tab('日志').evaluate((el) => {
    const style = getComputedStyle(el);
    return { outline: style.outline, offset: style.outlineOffset };
  });
  check(
    'focus ring = 2px accent + offset 2px',
    focusStyle.outline.includes(SENTINEL.accent) &&
      focusStyle.outline.includes('2px') &&
      focusStyle.outline.includes('solid') &&
      focusStyle.offset === '2px',
    JSON.stringify(focusStyle),
  );

  // 5) 点击切换分区 + 回调记录
  await tab('日志').click();
  await page.waitForTimeout(200);
  const selections = await page.evaluate(() => window.__devtoolsNavSelections ?? []);
  check('点击回调记录分区 id', selections.includes('logs'), JSON.stringify(selections));
  check(
    '选中态转移到「日志」',
    (await tab('日志').getAttribute('aria-pressed')) === 'true' &&
      (await tab('总览').getAttribute('aria-pressed')) === 'false',
  );

  // 6) 自动刷新开关
  const autoRefreshSwitch = nav.getByRole('switch', { name: /自动刷新/ });
  check('自动刷新开关存在', (await autoRefreshSwitch.count()) === 1);
  await autoRefreshSwitch.click();
  const autoRefreshEvents = await page.evaluate(() => window.__devtoolsNavAutoRefresh ?? []);
  check(
    '自动刷新回调收到 true',
    autoRefreshEvents.includes(true),
    JSON.stringify(autoRefreshEvents),
  );

  // 7) 导出下拉：打开 → 三个菜单项 → Escape 关闭
  await nav.getByRole('button', { name: /导出/ }).click();
  await page.waitForTimeout(200);
  check('导出菜单打开', (await nav.getByRole('menuitem').count()) === 3);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Escape 关闭导出菜单', (await nav.getByRole('menuitem').count()) === 0);

  // 8) 「复制排障上下文」按钮：带问题计数、点击后回调 + 成功反馈
  const bundleButton = nav.getByRole('button', { name: /复制排障上下文/ });
  check('复制排障上下文按钮带计数', (await bundleButton.textContent())?.includes('(3)') === true);
  await bundleButton.click();
  await page.waitForTimeout(300);
  const bundleCopies = await page.evaluate(() => window.__devtoolsNavBundleCopies ?? 0);
  check('复制回调被调用', bundleCopies === 1, String(bundleCopies));
  check('复制成功反馈可见', (await nav.getByText('已复制，可直接粘贴给 AI').count()) === 1);

  // 9) 列表行 hover（`rowInteractionProps` 公共路径）同样解析到 --bg-hover
  const rowHover = page.locator('[data-case="row-hover"]');
  const rowRestBg = await rowHover.evaluate((el) => getComputedStyle(el).backgroundColor);
  await rowHover.hover();
  await page.waitForTimeout(300);
  const rowHoverBg = await rowHover.evaluate((el) => getComputedStyle(el).backgroundColor);
  check(`列表行静止背景为透明`, rowRestBg === 'rgba(0, 0, 0, 0)', rowRestBg);
  check(`列表行 hover 背景 = --bg-hover 哨兵`, rowHoverBg === SENTINEL.bgHover, rowHoverBg);
  check(`列表行 hover 未误用 --bg-subtle`, rowHoverBg !== SENTINEL.trapBgSubtle, rowHoverBg);
} finally {
  await browser.close();
}

console.log(`\ndevtools 分区导航验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
