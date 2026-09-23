/**
 * `SubAgentRunList` 折叠功能验收（真实 Chromium）。
 *
 * 运行方式见同目录 `README.md`：
 *   NODE_PATH=packages/browser-automation/node_modules \
 *     bun apps/web/harness/verify-sub-agent-run-list.ts
 *
 * 守卫目标：
 *   - 折叠的真实布局效果（容器高度收缩、卡片列表 display:none、展开恢复）
 *   - hover / focus 的计算样式必须来自**真实存在的 token 变量**
 *     （内联样式断言看不到「变量名笔误 → 静默回退」）
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-sub-agent-run-list.ts',
  );
  process.exit(1);
}

type Locator = import('playwright').Locator;

const URL = 'http://127.0.0.1:5173/harness/sub-agent-run-list.html';
const VIEWPORTS = [375, 768, 1280] as const;
const HOST_HEIGHT = 360;
// 折叠后高度 = 上下 padding(12+12) + 表头按钮（padding 4+6 + 徽标行高 14）≈ 48。
// 阈值留出字体 / 缩放余量，同时足以区分「收缩了」与「没收缩」。
const COLLAPSED_MAX_HEIGHT = 90;

/** 与 `sub-agent-run-list.html` 的 `.harness-theme` 哨兵色值一一对应（两处必须同步）。 */
const SENTINEL = {
  bgHover: 'rgb(13, 59, 46)', // --bg-hover #0d3b2e
  accent: 'rgb(124, 58, 237)', // --accent #7c3aed
  accentSubtleShadow: 'rgba(124, 58, 237, 0.14)', // --accent-subtle
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

/** 读取折叠相关的真实布局状态（section 高度 / 列表显示 / 开关属性）。 */
async function readListState(section: Locator) {
  return section.evaluate((el) => {
    const toggle = el.querySelector<HTMLButtonElement>('.sub-agent-run-list__toggle');
    const listId = toggle?.getAttribute('aria-controls') ?? '';
    const list = document.getElementById(listId);
    const rect = el.getBoundingClientRect();
    return {
      ariaLabel: toggle?.getAttribute('aria-label') ?? null,
      expanded: toggle?.getAttribute('aria-expanded') ?? null,
      listDisplay: list ? getComputedStyle(list).display : null,
      listHeight: list?.getBoundingClientRect().height ?? -1,
      sectionHeight: rect.height,
      sectionWidth: rect.width,
      sectionRight: rect.right,
    };
  });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  for (const width of VIEWPORTS) {
    const tag = `[${width}px]`;
    const host = page.locator(`[data-viewport="${width}"] .host`);
    const section = host.locator('section[aria-label="子代理运行列表"]');
    await section.waitFor({ timeout: 30_000 });

    const toggle = section.locator('.sub-agent-run-list__toggle');
    const hostRight = await host.evaluate((el) => el.getBoundingClientRect().right);

    // 1) 默认展开：容器占满宿主高度、卡片可见
    const expandedState = await readListState(section);
    check(
      `${tag} 默认 aria-expanded=true`,
      expandedState.expanded === 'true',
      String(expandedState.expanded),
    );
    check(
      `${tag} 默认开关标签为「折叠子代理列表」`,
      expandedState.ariaLabel === '折叠子代理列表',
      String(expandedState.ariaLabel),
    );
    check(
      `${tag} 展开时列表 display:flex`,
      expandedState.listDisplay === 'flex',
      String(expandedState.listDisplay),
    );
    check(
      `${tag} 展开时容器占满宿主高度`,
      Math.abs(expandedState.sectionHeight - HOST_HEIGHT) <= 1,
      String(expandedState.sectionHeight),
    );
    check(
      `${tag} 展开时卡片可见`,
      await section.getByText('审计会话唤醒原语并整理结论').isVisible(),
    );
    check(`${tag} 展开时活跃徽标可见`, await section.getByText('2 活跃').isVisible());

    // 2) 点击折叠：容器收缩为迷你胶囊（高度为表头、宽度为内容宽）、
    //    卡片列表隐藏、总数保留、运行中转脉冲点
    await toggle.click();
    await page.waitForTimeout(200);
    const collapsedState = await readListState(section);
    check(
      `${tag} 折叠后 aria-expanded=false`,
      collapsedState.expanded === 'false',
      String(collapsedState.expanded),
    );
    check(
      `${tag} 折叠后开关标签为「展开子代理列表」`,
      collapsedState.ariaLabel === '展开子代理列表',
      String(collapsedState.ariaLabel),
    );
    check(
      `${tag} 折叠后列表 display:none`,
      collapsedState.listDisplay === 'none',
      String(collapsedState.listDisplay),
    );
    check(
      `${tag} 折叠后卡片区域高度为 0`,
      collapsedState.listHeight === 0,
      String(collapsedState.listHeight),
    );
    check(
      `${tag} 折叠后容器收缩为表头高度`,
      collapsedState.sectionHeight > 20 && collapsedState.sectionHeight <= COLLAPSED_MAX_HEIGHT,
      String(collapsedState.sectionHeight),
    );
    check(`${tag} 折叠后计数仍可见`, await section.getByText('3', { exact: true }).isVisible());
    check(
      `${tag} 折叠后「子代理」标签隐藏（迷你胶囊）`,
      (await section.getByText('子代理', { exact: true }).count()) === 0,
    );
    check(
      `${tag} 折叠后运行中转脉冲点（title 标注数量）`,
      await section.getByTitle('2 个运行中').isVisible(),
    );
    // 折叠胶囊现在承载「后台 N 运行中」（脉冲点 + 文案 + 总数徽标）→ 实测约 132px；
    // 断言意图是「收缩为内容宽、且显著窄于展开态 200px」，故阈值放宽到 140 并保留
    // `< expanded` 的严格关系（旧阈值 100 只匹配「子代理」单词时代的胶囊）。
    check(
      `${tag} 折叠后宽度收缩为内容宽`,
      collapsedState.sectionWidth < expandedState.sectionWidth &&
        collapsedState.sectionWidth <= 140,
      `collapsed=${collapsedState.sectionWidth} expanded=${expandedState.sectionWidth}`,
    );

    // 3) 再次展开：高度恢复宿主高度；固定 200px 栏宽不溢出宿主
    await toggle.click();
    await page.waitForTimeout(200);
    const reExpandedState = await readListState(section);
    check(
      `${tag} 再次展开 aria-expanded=true`,
      reExpandedState.expanded === 'true',
      String(reExpandedState.expanded),
    );
    check(
      `${tag} 再次展开容器恢复宿主高度`,
      Math.abs(reExpandedState.sectionHeight - HOST_HEIGHT) <= 1,
      String(reExpandedState.sectionHeight),
    );
    check(
      `${tag} 栏宽固定且不溢出宿主`,
      // 应用为全局 border-box（本页已对齐），200 为实占宽度（含左 padding 8）；
      // 断言只守卫「不随内容变宽、不溢出宿主」。
      reExpandedState.sectionWidth <= 209 && reExpandedState.sectionRight <= hostRight + 0.5,
      `width=${reExpandedState.sectionWidth} right=${reExpandedState.sectionRight} hostRight=${hostRight}`,
    );
  }

  // 4) 交互状态计算值：focus ring 与 hover 背景必须解析到哨兵变量。
  //    用键盘 Tab 聚焦第一个开关——鼠标交互之后的脚本 focus() 不触发 `:focus-visible`。
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Tab');
  const firstToggle = page.locator('[data-viewport="375"] .sub-agent-run-list__toggle');
  const focusedClass = await page.evaluate(() => document.activeElement?.className ?? '');
  check('Tab 焦点落在开关上', focusedClass.includes('sub-agent-run-list__toggle'), focusedClass);

  const focusStyle = await firstToggle.evaluate((el) => {
    const style = getComputedStyle(el);
    return { outline: style.outline, offset: style.outlineOffset, shadow: style.boxShadow };
  });
  check(
    'focus ring = 2px accent + offset 2px',
    focusStyle.outline.includes(SENTINEL.accent) &&
      focusStyle.outline.includes('2px') &&
      focusStyle.outline.includes('solid') &&
      focusStyle.offset === '2px',
    JSON.stringify(focusStyle),
  );
  check(
    'focus ring 阴影包含 accent-subtle 4px',
    focusStyle.shadow.includes(SENTINEL.accentSubtleShadow) && focusStyle.shadow.includes('4px'),
    focusStyle.shadow,
  );

  await firstToggle.hover();
  await page.waitForTimeout(300);
  const hoverBg = await firstToggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  check('开关 hover 背景 = --bg-hover 哨兵', hoverBg === SENTINEL.bgHover, hoverBg);

  // 5) 点击接线：停止按钮 → stop:<childId>；卡片 → open:<childId>
  const wideSection = page.locator('[data-viewport="1280"] section[aria-label="子代理运行列表"]');
  await wideSection.getByRole('button', { name: '停止子代理 审计会话唤醒原语并整理结论' }).click();
  await wideSection.getByText('审计会话唤醒原语并整理结论').first().click();
  const calls = await page.evaluate(() => window.__subAgentRunListHarness?.calls ?? []);
  check('停止按钮回调记录', calls.includes('stop:child-harness-running'), JSON.stringify(calls));
  check('卡片点击回调记录', calls.includes('open:child-harness-running'), JSON.stringify(calls));

  // 6) 页面不横向溢出视口
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check('页面不横向溢出视口', scrollWidth <= 1280, String(scrollWidth));

  // 7) 折叠状态持久化：折叠后刷新页面仍保持折叠；展开后写回默认态
  const wideToggle = wideSection.locator('.sub-agent-run-list__toggle');
  await wideToggle.click();
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedSection = page.locator(
    '[data-viewport="1280"] section[aria-label="子代理运行列表"]',
  );
  await reloadedSection.waitFor({ timeout: 30_000 });
  const reloadedToggle = reloadedSection.locator('.sub-agent-run-list__toggle');
  const reloadedExpanded = await reloadedToggle.getAttribute('aria-expanded');
  check(
    '刷新后仍保持折叠（localStorage 记忆）',
    reloadedExpanded === 'false',
    String(reloadedExpanded),
  );

  await reloadedToggle.click();
  await page.waitForTimeout(200);
  const storedCollapsed = await page.evaluate(() =>
    window.localStorage.getItem('chat.subagentRunList.collapsed'),
  );
  check('展开后写回未折叠状态', storedCollapsed === '0', String(storedCollapsed));
} finally {
  await browser.close();
}

console.log(`\n子代理运行列表折叠验收：${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：');
  for (const failure of failures) {
    console.log(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
}
