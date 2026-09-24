/**
 * 插件 / 技能 / MCP 管理面三视口验收（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：真实布局下的截断与横向溢出、真实引擎解析后的
 * 语义色与 focus ring，以及行内编辑 / 新增表单 / 开关在真实布局里的可用性。
 *
 * ⚠️ playwright 用动态导入 + NODE_PATH——运行方式见同目录 `README.md`：
 *   NODE_PATH=packages/browser-automation/node_modules \
 *     bun apps/web/harness/verify-plugin-manager-3viewports.ts
 */
let chromium: typeof import('playwright').chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('无法解析 playwright —— 请在仓库根目录用以下命令运行：');
  console.error(
    '  NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/verify-plugin-manager-3viewports.ts',
  );
  process.exit(1);
}

const URL = 'http://127.0.0.1:5173/harness/plugin-manager-3viewports.html';
const VIEWPORTS = [375, 768, 1280];

/** `.themed` 提供的主题色（与 harness HTML 的 token 快照一致）。 */
const ACCENT = 'rgb(92, 212, 192)';
const CONTRAST = 'rgb(240, 180, 41)';
const DANGER = 'rgb(240, 107, 126)';
const ACCENT_SUBTLE_PREFIX = 'rgba(92, 212, 192';

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-openawork-installed-skills]', { timeout: 30_000 });

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 1600 });

    const scope = page.locator('.viewport', { hasText: `${width}px` }).first();

    // 1) 三个管理面板都渲染
    check(
      `[${width}] 已安装技能列表渲染`,
      (await scope.locator('[data-openawork-installed-skills]').count()) === 1,
    );
    check(
      `[${width}] MCP 管理列表渲染`,
      (await scope.locator('[data-openawork-mcp-manager]').count()) === 1,
    );
    check(
      `[${width}] 技能市场渲染`,
      (await scope.locator('[data-openawork-skill-market]').count()) === 1,
    );

    // 2) 面板内部不产生横向滚动（窄视口下列必须换行而不是撑破）
    for (const selector of [
      '[data-openawork-installed-skills]',
      '[data-openawork-mcp-manager]',
      '[data-openawork-skill-market]',
    ]) {
      const overflow = await scope.locator(selector).evaluate((el) => ({
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
      }));
      check(
        `[${width}] ${selector} 无横向溢出`,
        overflow.scrollWidth <= overflow.clientWidth + 1,
        JSON.stringify(overflow),
      );
    }

    // 3) 技能长名称按省略号截断（375 下必须真实裁剪）
    const nameBox = await scope
      .locator('[data-isk-name]')
      .first()
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
      `[${width}] 技能名省略号样式生效`,
      nameBox.textOverflow === 'ellipsis' && nameBox.whiteSpace === 'nowrap',
      JSON.stringify(nameBox),
    );
    if (width === 375) {
      check(
        `[${width}] 长技能名确实被裁剪`,
        nameBox.scrollWidth > nameBox.clientWidth,
        JSON.stringify(nameBox),
      );
    }

    // 4) 语义色真实解析：启用开关轨道 = accent，更新箭头 = contrast，错误状态 = danger
    const trackColor = await scope
      .locator(
        '[data-isk-row="github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator"] [role="switch"] span',
      )
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    check(`[${width}] 技能开关轨道色 = accent`, trackColor === ACCENT, trackColor);

    const updateColor = await scope
      .locator('[data-isk-row="github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator"]')
      .first()
      .evaluate((el) => {
        const spans = Array.from(el.querySelectorAll('span'));
        const target = spans.find((span) => span.textContent?.startsWith('→'));
        return target ? getComputedStyle(target).color : null;
      })
      .catch(() => null);
    check(`[${width}] 更新版本号 = contrast`, updateColor === CONTRAST, String(updateColor));

    const errorColor = await scope.locator('[data-mcp-manager-row="broken"]').evaluate((el) => {
      // 取「直接承载文本的最小节点」，避免拿到继承默认色的祖先容器。
      const nodes = Array.from(el.querySelectorAll('div,span')).filter(
        (node) =>
          (node.textContent ?? '').includes('ECONNREFUSED') &&
          !Array.from(node.children).some((child) =>
            (child.textContent ?? '').includes('ECONNREFUSED'),
          ),
      );
      const target = nodes[0];
      return target ? getComputedStyle(target).color : null;
    });
    check(`[${width}] MCP 错误文案 = danger`, errorColor === DANGER, String(errorColor));

    // 5) focus ring（accent 2px outline + accent-subtle 阴影）。
    //    先按一次 Tab 把交互模态切到键盘，否则 :focus-visible 在指针交互后不生效。
    await page.keyboard.press('Tab');
    const skillSwitch = scope
      .locator('[data-isk-row="local-system:/home/await/.claude/skills/notes"] [role="switch"]')
      .first();
    await skillSwitch.focus();
    const focusStyle = await skillSwitch
      .locator('span')
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el.parentElement as HTMLElement);
        return {
          boxShadow: style.boxShadow,
          outlineColor: style.outlineColor,
          outlineOffset: style.outlineOffset,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
    check(
      `[${width}] 技能开关 focus ring 生效`,
      focusStyle.outlineStyle === 'solid' &&
        focusStyle.outlineWidth === '2px' &&
        focusStyle.outlineColor === ACCENT &&
        focusStyle.outlineOffset === '2px' &&
        focusStyle.boxShadow.includes(ACCENT_SUBTLE_PREFIX),
      JSON.stringify(focusStyle),
    );

    // 6) 行内编辑与新增表单可用
    const fsRow = scope.locator('[data-mcp-manager-row="fs"]');
    await fsRow.getByText('编辑').click();
    const disabledToolsVisible = await fsRow.locator('[aria-label="禁用工具"]').isVisible();
    check(`[${width}] MCP 编辑展开禁用工具输入`, disabledToolsVisible);
    await fsRow.getByText('完成').click();
    check(
      `[${width}] MCP 编辑可收起`,
      (await fsRow.locator('[aria-label="禁用工具"]').count()) === 0,
    );

    const addButton = scope.locator('[data-openawork-mcp-manager] [data-mcp-add-toggle]');
    await addButton.click();
    const serverNameInput = scope.getByLabel('服务器名称');
    check(`[${width}] MCP 新增表单可展开`, await serverNameInput.isVisible());
    await addButton.click();
    check(`[${width}] MCP 新增表单可收起`, !(await serverNameInput.isVisible().catch(() => false)));

    // 7) 开关交互：点击后 aria-checked 翻转
    const fsSwitch = fsRow.locator('[role="switch"]').first();
    check(`[${width}] MCP 开关初始为开`, (await fsSwitch.getAttribute('aria-checked')) === 'true');
    await fsSwitch.click();
    check(
      `[${width}] MCP 开关点击后为关`,
      (await fsSwitch.getAttribute('aria-checked')) === 'false',
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
