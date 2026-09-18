import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * 临时视觉验收：输入框内「审批方式」档位下拉（Phase 1 迁移后的控件）。
 * 复用 fusion-layout.spec.ts 的网关 mock + auth 播种套路，在真实 Chromium 中
 * 验证交互链路、琥珀语义色、顶栏只读 chip 与 375px 窄屏表现。
 */

const SESSION_ID = 'session-desktop-demo';
const GATEWAY_URL = 'http://mock-gateway.invalid';
const NOW = 1_784_368_800_000;
const SHOT_DIR = '/tmp/opencode';

/**
 * 冷启动预算：每次 playwright test 都会拉起全新的 vite dev server，
 * 「按需编译复用的 web App」只由下方 beforeAll 预热付一次——预热与首屏等待放宽到 240s；
 * 用例超时保持 120s 仅作兜底（预热完成后交互链路本身是秒级的）。
 */
const APP_SHELL_TIMEOUT = 240_000;
const TEST_TIMEOUT = 120_000;

test.setTimeout(TEST_TIMEOUT);

const SESSION_FIXTURE = {
  id: SESSION_ID,
  title: 'Permission Mode Visual Check',
  createdAt: NOW,
  updatedAt: NOW,
  parentSessionId: null,
  team_parent_session_id: null,
  state_status: 'idle',
  role_layer: null,
  substate: null,
  messages: [],
  metadata_json: '{}',
  runEvents: [],
  todos: [],
};

async function installDesktopGatewayMocks(page: Page): Promise<void> {
  await page.route(`${GATEWAY_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    switch (url.pathname) {
      case '/notifications':
        return json([]);
      case '/notifications/preferences':
        return json({ desktop: true, email: false });
      case '/sessions':
        return json({ sessions: [] });
      case `/sessions/${SESSION_ID}`:
        return json({ session: SESSION_FIXTURE });
      case `/sessions/${SESSION_ID}/recovery`:
        return json({
          recovery: {
            activeStream: null,
            children: [],
            pendingPermissions: [],
            pendingQuestions: [],
            ratings: [],
            session: SESSION_FIXTURE,
            tasks: [],
            todoLanes: { main: [], temp: [] },
            totalMessageCount: 0,
            totalTurnCount: 0,
          },
        });
      case `/sessions/${SESSION_ID}/artifacts`:
        return json({ contentArtifacts: [] });
      case `/sessions/${SESSION_ID}/terminals`:
        return json({ terminals: [] });
      case '/sessions/search':
        return json({ results: [] });
      case '/team/runtime':
        return json({ sessions: [], workspaces: [], events: [] });
      case '/team/workspaces':
        return json([]);
      case '/commands':
        return json({ commands: [] });
      case '/settings/profile':
        return json({ displayName: 'Tester' });
      case '/settings/companion':
        return json({
          preferences: { enabled: true, voiceOutputEnabled: false },
          bindings: {},
          profile: null,
          feature: { enabled: true, mode: 'beta' },
        });
      case '/settings/model-prices':
        return json([]);
      case '/settings/plugins':
        return json([]);
      case '/settings/providers':
        return json([]);
      case '/settings/telemetry/consent':
        return json({ granted: false });
      case '/capabilities':
        return json({ capabilities: [] });
      default:
        return json({});
    }
  });
}

async function seedDesktopStorage(page: Page): Promise<void> {
  await page.addInitScript(
    ({ gatewayUrl }: { gatewayUrl: string }) => {
      localStorage.setItem('onboarded', '1');
      localStorage.setItem('telemetry_consent_shown', '1');
      localStorage.setItem('telemetry_consent', 'declined');
      localStorage.setItem('desktop_gateway_mode', 'remote');
      localStorage.setItem(
        'auth-store',
        JSON.stringify({
          state: {
            accessToken: 'desktop-token',
            refreshToken: null,
            tokenExpiresAt: Date.now() + 60 * 60 * 1000,
            email: 'desktop@example.com',
            gatewayUrl,
            webAccessEnabled: false,
            webPort: 3000,
            webExposeLan: false,
          },
          version: 0,
        }),
      );
      localStorage.setItem(
        'openAwork-ui-state',
        JSON.stringify({
          state: {
            workbenchLayoutMode: 'classic',
            editorMode: false,
            editorFullScreen: false,
          },
          version: 20,
        }),
      );
    },
    { gatewayUrl: GATEWAY_URL },
  );
}

async function openChat(page: Page): Promise<void> {
  await installDesktopGatewayMocks(page);
  await seedDesktopStorage(page);
  // 用 commit 让 goto 尽快返回：HTML 解析、模块加载、首屏渲染都改由显式断言吸收，
  // 避免 vite 的按需编译时间藏在 goto 内部；冷编译已由下方 beforeAll 预热承担。
  await page.goto(`/chat/${SESSION_ID}`, { waitUntil: 'commit' });
  await expect(page.locator('.page-root')).toBeVisible({ timeout: APP_SHELL_TIMEOUT });
}

/**
 * 冷启动预热：每个 worker 先用一次性上下文跑通与用例完全一致的 mock/auth + 路由，
 * 让 vite 的按需编译只在 beforeAll 付一次，而不是算进首个用例的超时预算。
 */
test.beforeAll(async ({ browser }) => {
  // beforeAll 钩子使用项目级超时（playwright.config.ts 中为 30s），必须单独放宽才能覆盖冷编译。
  test.setTimeout(APP_SHELL_TIMEOUT + 30_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await openChat(page);
  } finally {
    await context.close();
  }
});

/**
 * 断言浮层紧贴触发按钮：按实际展开方向计算两者间隙，必须落在 0–16px。
 * 这是「菜单脱离点击位置」定位回归的守门断言——上翻时不得再以输入框外壳为锚点。
 */
async function expectMenuAdjacentToTrigger(menu: Locator, trigger: Locator): Promise<void> {
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('下拉浮层未取得布局盒');
  const triggerBox = await trigger.boundingBox();
  if (!triggerBox) throw new Error('触发按钮未取得布局盒');
  const menuAbove = menuBox.y + menuBox.height <= triggerBox.y;
  const gap = menuAbove
    ? triggerBox.y - (menuBox.y + menuBox.height)
    : menuBox.y - (triggerBox.y + triggerBox.height);
  expect(
    gap >= 0 && gap <= 16,
    `菜单与触发按钮的实测间隙为 ${gap}px（${menuAbove ? '菜单在按钮上方' : '菜单在按钮下方'}），必须紧贴触发按钮且不超过 16px`,
  ).toBe(true);
}

test('审批方式档位下拉：交互链路 + 琥珀语义色（顶栏不再重复展示 YOLO）', async ({ page }) => {
  await openChat(page);

  const trigger = page.getByRole('button', { name: /每次询问|免审批/ });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('data-tone', 'default');

  await trigger.click();
  const menu = page.getByRole('menu', { name: '工具调用审批方式' });
  await expect(menu).toBeVisible();

  // 设计令牌守门：dev / e2e harness 必须加载 web 样式入口，浮层背景不能被解析为透明，
  // 否则说明 var(--bg-overlay) 未解析（菜单会退化成无背景、无边框的裸浮层）。
  const menuBackground = await menu.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(
    menuBackground !== 'rgba(0, 0, 0, 0)' && menuBackground !== 'transparent',
    `浮层背景色解析为 ${menuBackground}，说明设计令牌未加载（dev harness 缺少 web 样式入口）`,
  ).toBe(true);

  await expect(page.getByRole('menuitemradio', { name: /每次询问/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('menuitemradio', { name: /免审批/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // —— 几何断言：菜单盒不出视口、不压触发按钮、末项不溢出容器、内容不溢出滚动容器 ——
  // 先等入场动画结束：动画期间浮层带 translateY(4px) 且 opacity 未到 1，会让测量与截图抖动。
  await expect(menu).toHaveCSS('opacity', '1');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('未取得视口尺寸');
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('下拉浮层未取得布局盒');
  expect(
    menuBox.x >= 0 &&
      menuBox.y >= 0 &&
      menuBox.x + menuBox.width <= viewport.width &&
      menuBox.y + menuBox.height <= viewport.height,
    `菜单盒 ${JSON.stringify(menuBox)} 必须完整落在视口 ${JSON.stringify(viewport)} 内`,
  ).toBe(true);

  const triggerBox = await trigger.boundingBox();
  if (!triggerBox) throw new Error('触发按钮未取得布局盒');
  expect(
    menuBox.x < triggerBox.x + triggerBox.width &&
      triggerBox.x < menuBox.x + menuBox.width &&
      menuBox.y < triggerBox.y + triggerBox.height &&
      triggerBox.y < menuBox.y + menuBox.height,
    `菜单盒 ${JSON.stringify(menuBox)} 不得与触发按钮 ${JSON.stringify(triggerBox)} 相交`,
  ).toBe(false);

  // —— 相邻性断言：菜单必须锚定在触发按钮正上方 / 正下方，而不是飘到视口高处 ——
  await expectMenuAdjacentToTrigger(menu, trigger);

  const lastItemBox = await page.getByRole('menuitemradio', { name: /免审批/ }).boundingBox();
  if (!lastItemBox) throw new Error('末项未取得布局盒');
  expect(
    lastItemBox.x >= menuBox.x &&
      lastItemBox.y >= menuBox.y &&
      lastItemBox.x + lastItemBox.width <= menuBox.x + menuBox.width &&
      lastItemBox.y + lastItemBox.height <= menuBox.y + menuBox.height,
    `末项 ${JSON.stringify(lastItemBox)} 必须被菜单盒 ${JSON.stringify(menuBox)} 完整包含，不得溢出圆角边框`,
  ).toBe(true);

  const scrollMetrics = await menu.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    overflowY: getComputedStyle(node).overflowY,
  }));
  expect(scrollMetrics.overflowY, '菜单必须是滚动容器（overflow-y 计算值应为 auto）').toBe('auto');
  expect(
    scrollMetrics.scrollHeight,
    `正常视口下菜单内容不得溢出：scrollHeight=${scrollMetrics.scrollHeight} 应 <= clientHeight+1=${scrollMetrics.clientHeight + 1}`,
  ).toBeLessThanOrEqual(scrollMetrics.clientHeight + 1);

  await page.screenshot({ path: `${SHOT_DIR}/permission-01-open.png` });

  // 首次切到免审批 → 浮层内联确认
  await page.getByRole('menuitemradio', { name: /免审批/ }).click();
  const confirmButton = page.getByRole('button', { name: '确认开启' });
  await expect(confirmButton).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/permission-02-confirm.png` });

  await confirmButton.click();
  await expect(trigger).toHaveAttribute('data-tone', 'warning');
  await expect(trigger).toContainText('免审批');
  await page.screenshot({ path: `${SHOT_DIR}/permission-03-enabled.png` });

  // 顶栏不再重复展示 YOLO：该档位只在输入框的权限档位控件内调整
  const chip = page.getByTestId('chat-top-bar-yolo-chip');
  await expect(chip).toHaveCount(0);

  // 再切回每次询问：不应二次确认
  await trigger.click();
  await page.getByRole('menuitemradio', { name: /每次询问/ }).click();
  await expect(trigger).toHaveAttribute('data-tone', 'default');
  await expect(chip).toHaveCount(0);
});

test('选择「编辑自动」后顶栏出现中性 chip，且不是琥珀 YOLO chip', async ({ page }) => {
  await openChat(page);

  const trigger = page.getByRole('button', { name: /每次询问|编辑自动|免审批/ });
  await expect(trigger).toHaveAttribute('data-tone', 'default');

  await trigger.click();
  const menu = page.getByRole('menu', { name: '工具调用审批方式' });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: /编辑自动/ })).toHaveAttribute(
    'data-tone',
    'default',
  );

  // 中档不弹内联确认：点击后直接生效。
  await page.getByRole('menuitemradio', { name: /编辑自动/ }).click();
  await expect(page.getByRole('button', { name: '确认开启' })).toHaveCount(0);
  await expect(trigger).toContainText('编辑自动');
  await expect(trigger).toHaveAttribute('data-tone', 'default');

  const autoEditChip = page.getByTestId('chat-top-bar-auto-edit-chip');
  await expect(autoEditChip).toBeVisible();
  await expect(autoEditChip).toHaveAttribute('data-tone', 'info');
  await expect(autoEditChip).toContainText('编辑自动');
  // 中档不能渲染成琥珀警示 chip，也不能出现 YOLO 只读标识。
  await expect(page.getByTestId('chat-top-bar-yolo-chip')).toHaveCount(0);

  await page.screenshot({ path: `${SHOT_DIR}/permission-05-auto-edit-chip.png` });
});

test('审批方式下拉：键盘可达（方向键 + Escape）', async ({ page }) => {
  await openChat(page);

  const trigger = page.getByRole('button', { name: /每次询问|编辑自动|免审批/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: '工具调用审批方式' })).toBeVisible();

  // 打开后焦点在浮层容器上（当前档位处于高亮态），方向键从当前档位向后移动。
  // 注：首个 ArrowDown 会跳过已选中的「每次询问」直接落到下一档，这是当前实现
  // 与 APG「打开即聚焦首个/当前项」的已知偏差，已在交付说明中记录为 Phase 2 打磨项。
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: /编辑自动/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: /免审批/ })).toBeFocused();
  // 三档全部可达，且从末档回绕到首档。
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: /每次询问/ })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '工具调用审批方式' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('375px 窄屏：控件收窄且不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 820 });
  await openChat(page);

  const trigger = page.getByRole('button', { name: /每次询问|免审批/ });
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  if (!box) throw new Error('审批方式控件未取得布局盒');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);

  await trigger.click();
  const menu = page.getByRole('menu', { name: '工具调用审批方式' });
  // 等入场动画结束再测量，避免 translateY(4px) 让间隙与截图抖动。
  await expect(menu).toHaveCSS('opacity', '1');
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('下拉浮层未取得布局盒');
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(375);
  // 窄屏也必须紧贴触发按钮：375px 截图要能直接看到菜单锚定在按钮上方。
  await expectMenuAdjacentToTrigger(menu, trigger);
  await page.screenshot({ path: `${SHOT_DIR}/permission-04-375.png` });
});
