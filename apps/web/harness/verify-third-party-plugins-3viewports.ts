/**
 * 已安装插件管理面三视口验收（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：真实布局下的截断与横向溢出、真实引擎解析后的
 * 语义色与 focus ring，以及卸载二次确认 / 安装表单在真实布局里的可用性。
 *
 * ⚠️ playwright 用动态导入 + NODE_PATH——运行方式见同目录 `README.md`：
 *   NODE_PATH=packages/browser-automation/node_modules \
 *     bun apps/web/harness/verify-third-party-plugins-3viewports.ts
 */

declare global {
  interface Window {
    __thirdPartyPluginsHarness?: { calls: string[] };
  }
}

let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-third-party-plugins-3viewports.ts',
  );
  process.exit(1);
}

const URL = 'http://127.0.0.1:5173/harness/third-party-plugins-3viewports.html';
const VIEWPORTS = [375, 768, 1280];

/** `.themed` 提供的主题色（与 harness HTML 的 token 快照一致）。 */
const ACCENT = 'rgb(92, 212, 192)';
const SUCCESS = 'rgb(61, 212, 154)';
const DANGER = 'rgb(240, 107, 126)';
const FG_SUBTLE = 'rgb(77, 91, 110)';
const ACCENT_SUBTLE_PREFIX = 'rgba(92, 212, 192';

const LONG_ID = 'example.analytics-dashboard-extension-with-a-very-long-plugin-identifier-name';

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-third-party-plugins]', { timeout: 30_000 });

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 2000 });

    const scope = page.locator('.viewport', { hasText: `${width}px` }).first();
    const listCase = scope.locator('[data-case="third-party-plugins"] [data-third-party-plugins]');
    const emptyCase = scope.locator(
      '[data-case="third-party-plugins-empty"] [data-third-party-plugins]',
    );

    // 1) 渲染：列表五行 + 空态
    check(`[${width}] 插件列表渲染`, (await listCase.count()) === 1);
    check(`[${width}] 插件列表五行`, (await listCase.locator('[data-tpp-row]').count()) === 5);
    check(`[${width}] 空态渲染`, (await emptyCase.locator('[data-tpp-empty]').count()) === 1);

    // 2) 面板内部不产生横向滚动
    for (const [label, locator] of [
      ['列表', listCase],
      ['空态', emptyCase],
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

    // 3) 超长插件 id 按省略号截断（375 下必须真实裁剪）
    const idBox = await listCase
      .locator(`[data-tpp-row="${LONG_ID}"] [data-tpp-id]`)
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
      `[${width}] 插件 id 省略号样式生效`,
      idBox.textOverflow === 'ellipsis' && idBox.whiteSpace === 'nowrap',
      JSON.stringify(idBox),
    );
    if (width === 375) {
      check(
        `[${width}] 超长 id 确实被裁剪`,
        idBox.scrollWidth > idBox.clientWidth,
        JSON.stringify(idBox),
      );
    }

    // 4) 语义色真实解析
    const activeDot = await listCase
      .locator('[data-tpp-row="demo.echo"] [data-tpp-status="active"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`[${width}] 活跃状态点 = success`, activeDot === SUCCESS, activeDot);

    const failedDot = await listCase
      .locator('[data-tpp-row="demo.broken"] [data-tpp-status="failed"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`[${width}] 失败状态点 = danger`, failedDot === DANGER, failedDot);

    const errorColor = await listCase
      .locator('[data-tpp-row="demo.broken"] [data-tpp-error]')
      .evaluate((el) => getComputedStyle(el).color);
    check(`[${width}] 失败原因 = danger`, errorColor === DANGER, errorColor);

    const successBadge = await listCase
      .locator('[data-tpp-row="demo.echo"] [data-tpp-badge="success"]')
      .evaluate((el) => getComputedStyle(el).color);
    check(`[${width}] 运行中徽章 = success`, successBadge === SUCCESS, successBadge);

    // 5) 「外部加载」形态不显示重载 / 卸载
    const legacyRow = listCase.locator('[data-tpp-row="legacy.env-plugin"]');
    check(
      `[${width}] 外部加载无重载/卸载按钮`,
      (await legacyRow.getByText('重载', { exact: true }).count()) === 0 &&
        (await legacyRow.getByText('卸载', { exact: true }).count()) === 0,
    );

    // 5b) 已停用行：灰点 + 「已停用」徽章 + 只有「启用」（无重载/停用）
    const pausedRow = listCase.locator('[data-tpp-row="demo.paused"]');
    const pausedDot = await pausedRow
      .locator('[data-tpp-status="disabled"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`[${width}] 已停用状态点 = fg-subtle`, pausedDot === FG_SUBTLE, pausedDot);
    check(`[${width}] 已停用徽章出现`, (await pausedRow.getByText('已停用').count()) === 1);
    check(
      `[${width}] 已停用行只提供启用`,
      (await pausedRow.getByRole('button', { name: '启用' }).count()) === 1 &&
        (await pausedRow.getByRole('button', { name: '重载' }).count()) === 0 &&
        (await pausedRow.getByRole('button', { name: '停用' }).count()) === 0,
    );

    // 5c) 停用按钮真实点击 → 回调记录（fixture 不更新，仅验证接线）
    const echoRowForDisable = listCase.locator('[data-tpp-row="demo.echo"]');
    await echoRowForDisable.getByRole('button', { name: '停用' }).click();
    const callsAfterDisable = await page.evaluate(
      () => window.__thirdPartyPluginsHarness?.calls ?? [],
    );
    check(
      `[${width}] 停用回调记录`,
      callsAfterDisable.at(-1) === 'disable:demo.echo',
      String(callsAfterDisable.at(-1)),
    );

    // 6) focus ring（先按 Tab 切到键盘交互模态；按钮初始 disabled，
    //    需先填入路径使其可用才能聚焦）
    await page.keyboard.press('Tab');
    const focusPathInput = listCase.getByLabel('插件路径');
    await focusPathInput.fill('/tmp/focus-check');
    const installButton = listCase.getByRole('button', { name: '安装' });
    await installButton.focus();
    const focusStyle = await installButton.evaluate((el) => {
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
      `[${width}] 安装按钮 focus ring 生效`,
      focusStyle.outlineStyle === 'solid' &&
        focusStyle.outlineWidth === '2px' &&
        focusStyle.outlineColor === ACCENT &&
        focusStyle.outlineOffset === '2px' &&
        focusStyle.boxShadow.includes(ACCENT_SUBTLE_PREFIX),
      JSON.stringify(focusStyle),
    );

    // 7) 卸载二次确认（真实点击；首次点击不得触发回调）
    const echoRow = listCase.locator('[data-tpp-row="demo.echo"]');
    const callsBefore = await page.evaluate(
      () => window.__thirdPartyPluginsHarness?.calls.length ?? 0,
    );
    await echoRow.getByRole('button', { name: '卸载' }).click();
    const callsAfterFirstClick = await page.evaluate(
      () => window.__thirdPartyPluginsHarness?.calls.length ?? 0,
    );
    check(`[${width}] 卸载首次点击不触发回调`, callsAfterFirstClick === callsBefore);
    check(
      `[${width}] 二次确认按钮出现`,
      (await echoRow.getByRole('button', { name: '确认卸载' }).count()) === 1,
    );
    await echoRow.getByRole('button', { name: '确认卸载' }).click();
    const callsAfterConfirm = await page.evaluate(
      () => window.__thirdPartyPluginsHarness?.calls ?? [],
    );
    check(
      `[${width}] 确认后记录卸载调用`,
      callsAfterConfirm.at(-1) === 'remove:demo-echo',
      String(callsAfterConfirm.at(-1)),
    );

    // 8) 安装表单：输入 + 提交 → 回调带路径；成功后输入清空
    const pathInput = listCase.getByLabel('插件路径');
    await pathInput.fill('/srv/plugins/new-plugin');
    await listCase.getByRole('button', { name: '安装' }).click();
    const callsAfterInstall = await page.evaluate(
      () => window.__thirdPartyPluginsHarness?.calls ?? [],
    );
    check(
      `[${width}] 安装回调带路径与 force 标记`,
      callsAfterInstall.at(-1) === 'install:/srv/plugins/new-plugin:false',
      String(callsAfterInstall.at(-1)),
    );
    check(`[${width}] 安装成功后清空输入`, (await pathInput.inputValue()) === '');
  }
} finally {
  await browser.close();
}

console.log(`\n${passes.length} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.error(failures.map((failure) => `  ✗ ${failure}`).join('\n'));
  process.exit(1);
}
