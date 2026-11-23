import assert from 'node:assert/strict';
import { chromium } from '../../../packages/browser-automation/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() =>
    localStorage.setItem('openawork:builtin-browser:native-render:v3', '1'),
  );
  await page.route('https://example.test/**', (route) => {
    return route.fulfill({ body: 'preview' });
  });
  await page.goto('http://127.0.0.1:5173/harness/browser-open-request.html');
  const key = 'openawork:builtin-browser:tabs:v1:/browser-open-request';
  await page.evaluate(
    (storageKey) =>
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          activeTabId: 'old',
          tabs: [
            {
              id: 'old',
              url: 'https://example.test/old',
              title: 'Old',
              history: ['https://example.test/old'],
              historyIndex: 0,
            },
          ],
        }),
      ),
    key,
  );
  const state = () =>
    page.evaluate(
      (storageKey) =>
        JSON.parse(localStorage.getItem(storageKey) ?? '{}') as {
          activeTabId: string;
          tabs: Array<{ id: string; url: string; history: string[] }>;
        },
      key,
    );
  await page.getByRole('button', { name: '当前标签打开', exact: true }).click();
  await page.getByRole('button', { name: '恢复工作区', exact: true }).click();
  await page.waitForFunction(
    (storageKey) =>
      JSON.parse(localStorage.getItem(storageKey) ?? '{}').tabs?.[0]?.url ===
      'https://example.test/requested',
    key,
  );
  assert.equal((await state()).tabs.length, 1, '恢复旧标签后在当前标签导航');
  await page.locator('iframe[title="内置浏览器"][src="https://example.test/requested"]').waitFor();
  const firstFrame = await page
    .locator('iframe[src="https://example.test/requested"]')
    .elementHandle();
  assert.deepEqual((await state()).tabs[0]?.history, [
    'https://example.test/old',
    'https://example.test/requested',
  ]);
  await page.getByRole('button', { name: '当前标签打开', exact: true }).click();
  await page.waitForFunction(
    (storageKey) =>
      JSON.parse(localStorage.getItem(storageKey) ?? '{}').tabs?.[0]?.history.length === 3,
    key,
  );
  assert.equal(
    await firstFrame?.evaluate((frame) => frame.isConnected),
    false,
    '重复地址重新加载真实 iframe',
  );
  await page.getByRole('button', { name: '新标签打开', exact: true }).click();
  await page.waitForFunction(
    (storageKey) => JSON.parse(localStorage.getItem(storageKey) ?? '{}').tabs?.length === 2,
    key,
  );
  const before = await state();
  assert.equal(
    before.tabs.find((tab) => tab.id === before.activeTabId)?.url,
    'https://example.test/requested',
  );
  await page.getByRole('button', { name: '卸载', exact: true }).click();
  await page.getByRole('button', { name: '仅打开面板', exact: true }).click();
  assert.deepEqual(await state(), before, '重挂载与仅开面板不重复消费');
  await page.getByRole('button', { name: '卸载', exact: true }).click();
  await page.getByRole('button', { name: '新标签打开', exact: true }).click();
  await page.waitForFunction(
    (storageKey) => JSON.parse(localStorage.getItem(storageKey) ?? '{}').tabs?.length === 3,
    key,
  );
  assert.deepEqual((await state()).tabs.slice(0, 2), before.tabs, '挂载前的新标签请求保留旧标签');
  const previous = await state();
  await page.getByRole('button', { name: '新地址新标签', exact: true }).click();
  await page.waitForFunction(
    (storageKey) => JSON.parse(localStorage.getItem(storageKey) ?? '{}').tabs?.length === 4,
    key,
  );
  const changed = await state();
  assert.deepEqual(changed.tabs.slice(0, 3), previous.tabs, '新 URL 不覆盖旧标签');
  assert.deepEqual(
    changed.tabs[3]?.history,
    ['https://example.test/another'],
    '显式请求与 URL 同步不双重导航',
  );
  const other = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('openawork:builtin-browser:tabs:v1:/other-browser') ?? '{}'),
  );
  assert.equal(other.tabs.length, 1);
  assert.notEqual(other.tabs[0].url, 'https://example.test/requested', '其他工作区不消费');
  console.log(
    'PASS: persisted tabs, repeated URL, new tab, StrictMode single consumption, remount, workspace isolation',
  );
  const hostPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors: string[] = [];
  hostPage.on('pageerror', (error) => pageErrors.push(error.message));
  await hostPage.route('https://example.test/**', (route) => route.fulfill({ body: 'preview' }));
  await hostPage.addInitScript(() => {
    localStorage.setItem('openawork:builtin-browser:native-render:v3', '1');
    for (const workspace of ['a', 'b']) {
      const url = `https://example.test/old-${workspace}`;
      localStorage.setItem(
        `openawork:builtin-browser:tabs:v1:/browser-host-${workspace}`,
        JSON.stringify({
          version: 1,
          activeTabId: `old-${workspace}`,
          tabs: [{ id: `old-${workspace}`, url, title: 'Old', history: [url], historyIndex: 0 }],
        }),
      );
    }
  });
  await hostPage.goto('http://127.0.0.1:5173/harness/browser-open-request.html?hosts');
  await hostPage.waitForLoadState('networkidle');
  const hostState = (workspace = 'a') =>
    hostPage.evaluate(
      (name) =>
        JSON.parse(
          localStorage.getItem(`openawork:builtin-browser:tabs:v1:/browser-host-${name}`) ?? '{}',
        ),
      workspace,
    );
  const waitTabs = (workspace: string, count: number) =>
    hostPage.waitForFunction(
      ({ workspace, count }) =>
        JSON.parse(
          localStorage.getItem(`openawork:builtin-browser:tabs:v1:/browser-host-${workspace}`) ??
            '{}',
        ).tabs?.length === count,
      { workspace, count },
    );
  const click = (name: string) => hostPage.getByRole('button', { name, exact: true }).click();
  const expectOwner = async (owner: 'main' | 'dock') => {
    const frames = hostPage.locator('iframe[title="内置浏览器"]');
    assert.equal(await frames.count(), 1, '两个真实宿主只挂载一个浏览器');
    assert.equal(
      await hostPage.getByTestId(`${owner}-host`).locator('iframe[title="内置浏览器"]').count(),
      1,
    );
  };
  await expectOwner('dock');
  const hiddenBefore = await hostState();
  await click('隐藏时请求');
  await hostPage.waitForLoadState('networkidle');
  assert.deepEqual(await hostState(), hiddenBefore, '隐藏的真实浏览器不能消费请求');
  await click('仅打开面板');
  await waitTabs('a', 2);
  const revealed = await hostState();
  assert.deepEqual(revealed.tabs[0], hiddenBefore.tabs[0], '显示后恢复旧标签并追加一次');
  await expectOwner('dock');
  await hostPage.locator('iframe[src="https://example.test/requested"]').waitFor();
  const hostFrame = await hostPage
    .locator('iframe[src="https://example.test/requested"]')
    .elementHandle();
  await click('当前标签打开');
  await hostPage.waitForFunction(() => {
    const state = JSON.parse(
      localStorage.getItem('openawork:builtin-browser:tabs:v1:/browser-host-a') ?? '{}',
    );
    return (
      state.tabs?.find((tab: { id: string; history: string[] }) => tab.id === state.activeTabId)
        ?.history.length === 2
    );
  });
  assert.equal(
    await hostFrame?.evaluate((frame) => frame.isConnected),
    false,
    '真实宿主 currentTab 同 URL 重载',
  );
  const beforePromotion = await hostState();
  await click('提升');
  await hostPage.waitForLoadState('networkidle');
  await expectOwner('main');
  assert.deepEqual(await hostState(), beforePromotion, '提升不重复消费');
  await click('新标签打开');
  await waitTabs('a', 3);
  await expectOwner('dock');
  const afterHandoff = await hostState();
  assert.deepEqual(
    afterHandoff.tabs.slice(0, 2),
    beforePromotion.tabs,
    '回停靠的新标签请求保留已有标签',
  );
  await click('切换工作区并打开');
  await waitTabs('b', 2);
  const workspaceB = await hostState('b');
  assert.equal(workspaceB.tabs[0].id, 'old-b', '新工作区先恢复旧标签');
  assert.deepEqual(workspaceB.tabs[0].history, ['https://example.test/old-b']);
  assert.deepEqual(
    workspaceB.tabs[1].history,
    ['https://example.test/workspace-b'],
    '切换时请求仅导航一次',
  );
  assert.deepEqual(await hostState(), afterHandoff, '工作区切换不污染原标签');
  await click('返回工作区');
  await hostPage.waitForLoadState('networkidle');
  assert.deepEqual(await hostState(), afterHandoff, '切回恢复原工作区且不重放');
  await expectOwner('dock');
  assert.deepEqual(pageErrors, [], '真实宿主无未捕获浏览器错误');
  await hostPage.screenshot({ path: '/tmp/browser-open-request-hosts.png', fullPage: true });
  console.log(
    'PASS: real FusionWorkspaceTab/EditorBrowserWorkspace, hidden requests, promotion/dock handoff, persisted workspace switch, no page errors',
  );
} finally {
  await browser.close();
}
