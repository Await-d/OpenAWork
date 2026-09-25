/**
 * 插件市场三视口验收（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：窄视口下的换行/省略号/横向溢出、真实引擎解析后的
 * 语义色（accent/contrast）与 focus ring，以及信任确认 / 详情 / 来源管理在真实
 * 布局里的可用性。
 *
 * ⚠️ playwright 用动态导入 + NODE_PATH——运行方式见同目录 `README.md`：
 *   NODE_PATH=packages/browser-automation/node_modules \
 *     bun apps/web/harness/verify-plugin-market-3viewports.ts
 */

declare global {
  interface Window {
    __pluginMarketHarness?: { calls: string[] };
  }
}

let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-plugin-market-3viewports.ts',
  );
  process.exit(1);
}

const URL = 'http://127.0.0.1:5173/harness/plugin-market-3viewports.html';
const VIEWPORTS = [375, 768, 1280];

const ACCENT = 'rgb(92, 212, 192)';
const CONTRAST = 'rgb(240, 180, 41)';
const ACCENT_SUBTLE_PREFIX = 'rgba(92, 212, 192';

const LONG_REPO = 'very-long-org-name/very-long-repo-name-for-truncation-check';
const LONG_ENTRY_ID = `${LONG_REPO}/analytics-dashboard-extension-with-a-very-long-name`;

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 2200 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-plugin-market]', { timeout: 30_000 });

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 2200 });

    const scope = page.locator('.viewport', { hasText: `${width}px` }).first();
    const market = scope.locator('[data-case="plugin-market"] [data-plugin-market]');
    const empty = scope.locator('[data-case="plugin-market-empty"] [data-plugin-market]');

    // 1) 渲染
    check(`[${width}] 插件市场渲染`, (await market.count()) === 1);
    check(`[${width}] 市场条目三行`, (await market.locator('[data-pkm-entry]').count()) === 3);
    check(`[${width}] 空态渲染`, (await empty.locator('[data-pkm-empty]').count()) === 1);

    // 2) 无横向溢出
    for (const [label, locator] of [
      ['市场', market],
      ['空态', empty],
    ] as const) {
      const box = await locator.evaluate((el) => ({
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
      }));
      check(
        `[${width}] ${label}无横向溢出`,
        box.scrollWidth <= box.clientWidth + 1,
        JSON.stringify(box),
      );
    }

    // 3) 超长 repo 行省略号（375 下真实裁剪）
    const repoBox = await market
      .locator(`[data-pkm-entry="${LONG_ENTRY_ID}"] [data-pkm-repo]`)
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
        };
      });
    check(
      `[${width}] 长 repo 行省略号样式生效`,
      repoBox.textOverflow === 'ellipsis' && repoBox.whiteSpace === 'nowrap',
      JSON.stringify(repoBox),
    );
    if (width === 375) {
      check(
        `[${width}] 长 repo 行确实被裁剪`,
        repoBox.scrollWidth > repoBox.clientWidth,
        JSON.stringify(repoBox),
      );
    }

    // 4) 语义色：版本徽章 = accent、失败来源提示 = contrast
    const versionBadge = await market
      .locator('[data-pkm-entry="acme/plugins/echo"] span', { hasText: 'v1.0.0' })
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    check(`[${width}] 版本徽章 = accent`, versionBadge === ACCENT, versionBadge);

    const failedNotice = await market
      .locator('[role="alert"]', { hasText: '读取失败' })
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    check(`[${width}] 失败来源提示 = contrast`, failedNotice === CONTRAST, failedNotice);

    // 5) focus ring（先 Tab 建立键盘模态）
    await page.keyboard.press('Tab');
    const searchButton = market.getByRole('button', { name: '搜索', exact: true });
    await searchButton.focus();
    const focusStyle = await searchButton.evaluate((el) => {
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
      `[${width}] 搜索按钮 focus ring 生效`,
      focusStyle.outlineStyle === 'solid' &&
        focusStyle.outlineWidth === '2px' &&
        focusStyle.outlineColor === ACCENT &&
        focusStyle.outlineOffset === '2px' &&
        focusStyle.boxShadow.includes(ACCENT_SUBTLE_PREFIX),
      JSON.stringify(focusStyle),
    );

    // 6) 搜索：关键字交给回调
    const searchInput = market.getByLabel('搜索插件市场');
    await searchInput.fill('echo');
    await searchButton.click();
    const callsAfterSearch = await page.evaluate(() => window.__pluginMarketHarness?.calls ?? []);
    check(
      `[${width}] 搜索回调带关键字`,
      callsAfterSearch.at(-1) === 'refresh:echo',
      String(callsAfterSearch.at(-1)),
    );

    // 7) 信任确认：安装 → 确认安装
    const echoRow = market.locator('[data-pkm-entry="acme/plugins/echo"]');
    await echoRow.getByRole('button', { name: '安装', exact: true }).click();
    const confirmText = await echoRow.locator('[data-pkm-confirm]').textContent();
    check(
      `[${width}] 安装前展示信任确认（含无沙箱与来源）`,
      (confirmText ?? '').includes('无沙箱') && (confirmText ?? '').includes('acme/plugins'),
    );
    await echoRow.getByRole('button', { name: '确认安装' }).click();
    const callsAfterInstall = await page.evaluate(() => window.__pluginMarketHarness?.calls ?? []);
    check(
      `[${width}] 确认后触发安装回调`,
      callsAfterInstall.at(-1) === 'install:acme/plugins/echo',
      String(callsAfterInstall.at(-1)),
    );

    // 8) 详情：打开 → README 渲染 → 关闭
    await echoRow.getByRole('button', { name: '详情' }).click();
    const detailCard = market.locator('[data-pkm-detail]');
    check(`[${width}] 详情卡渲染`, (await detailCard.count()) === 1);
    check(
      `[${width}] 详情 README 渲染`,
      ((await detailCard.locator('[data-pkm-readme]').textContent()) ?? '').includes('# echo'),
    );
    await detailCard.getByRole('button', { name: '关闭' }).click();
    const callsAfterClose = await page.evaluate(() => window.__pluginMarketHarness?.calls ?? []);
    check(
      `[${width}] 关闭详情回调`,
      callsAfterClose.at(-1) === 'close-detail' && (await detailCard.count()) === 0,
      String(callsAfterClose.at(-1)),
    );

    // 9) 来源管理：展开 → 添加 → 移除
    await market.getByRole('button', { name: /来源（2）/ }).click();
    const sourcesPanel = market.locator('[data-pkm-sources]');
    check(`[${width}] 来源面板展开`, (await sourcesPanel.count()) === 1);
    check(`[${width}] 来源行数量`, (await sourcesPanel.locator('[data-pkm-source]').count()) === 2);

    await sourcesPanel.getByLabel('插件源仓库').fill('acme/new');
    await sourcesPanel.getByRole('button', { name: '添加来源' }).click();
    const callsAfterAdd = await page.evaluate(() => window.__pluginMarketHarness?.calls ?? []);
    check(
      `[${width}] 添加来源回调`,
      callsAfterAdd.at(-1) === 'add:acme/new:',
      String(callsAfterAdd.at(-1)),
    );

    await sourcesPanel
      .locator('[data-pkm-source="acme/plugins"]')
      .getByRole('button', { name: '移除' })
      .click();
    const callsAfterRemove = await page.evaluate(() => window.__pluginMarketHarness?.calls ?? []);
    check(
      `[${width}] 移除来源回调`,
      callsAfterRemove.at(-1) === 'remove-source:acme/plugins',
      String(callsAfterRemove.at(-1)),
    );
  }
} finally {
  await browser.close();
}

console.log(`\n${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.error(failures.map((failure) => `  ✗ ${failure}`).join('\n'));
  process.exit(1);
}
