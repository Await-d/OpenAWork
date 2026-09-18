import { createServer } from 'node:http';

import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BrowserAutomationError } from './index.js';
import { BrowserLiveSession } from './live-session.js';
import type {
  BrowserLiveA11yNodeLike,
  BrowserLiveDomNodeLike,
  BrowserLiveEvent,
} from './live-session-types.js';

async function probeChromium(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true, timeout: 30_000 });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const chromiumAvailable = await probeChromium();

function waitForEvent(
  session: BrowserLiveSession,
  predicate: (event: BrowserLiveEvent) => boolean,
  timeoutMs = 15_000,
): Promise<BrowserLiveEvent> {
  return new Promise<BrowserLiveEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('Timed out waiting for live event'));
    }, timeoutMs);
    const off = session.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

function dataUrl(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

function utf8DataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function withHtmlServer(html: string, run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('html server did not expose a TCP port');
    }
    await run(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

function findDomNode(
  node: BrowserLiveDomNodeLike,
  predicate: (candidate: BrowserLiveDomNodeLike) => boolean,
): BrowserLiveDomNodeLike | null {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findDomNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function findA11yNode(
  node: BrowserLiveA11yNodeLike,
  predicate: (candidate: BrowserLiveA11yNodeLike) => boolean,
): BrowserLiveA11yNodeLike | null {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findA11yNode(child, predicate);
    if (found) return found;
  }
  return null;
}

describe.skipIf(!chromiumAvailable)('BrowserLiveSession chromium 集成测试', () => {
  it('start / close 具备幂等性', async () => {
    const session = new BrowserLiveSession({ engine: 'chromium' });
    expect(session.isStarted()).toBe(false);

    await session.start();
    expect(session.isStarted()).toBe(true);
    await expect(session.start()).rejects.toBeInstanceOf(BrowserAutomationError);

    await session.close();
    await session.close();
    expect(session.isStarted()).toBe(false);

    await session.start();
    expect(session.isStarted()).toBe(true);
    await session.close();
  }, 60_000);

  describe('已启动会话', () => {
    let session: BrowserLiveSession;

    beforeAll(async () => {
      session = new BrowserLiveSession({ engine: 'chromium' });
      await session.start();
    }, 60_000);

    afterAll(async () => {
      await session.close();
    });

    it('supportsScreencast 在 chromium 上为 true', () => {
      expect(session.getEngine()).toBe('chromium');
      expect(session.supportsScreencast()).toBe(true);
    });

    it('goto / reload / currentUrl / currentTitle 可用', async () => {
      await session.goto(
        dataUrl('<html><head><title>live-title</title></head><body>ok</body></html>'),
      );
      expect(await session.currentTitle()).toBe('live-title');
      expect((await session.currentUrl()).startsWith('data:text/html')).toBe(true);
      await session.reload();
      expect(await session.currentTitle()).toBe('live-title');
    }, 30_000);

    it('导航后发出携带标题的 nav 事件', async () => {
      const navPromise = waitForEvent(
        session,
        (event) => event.type === 'nav' && event.url.includes('live-nav-probe'),
      );
      await session.goto(
        dataUrl('<html><head><title>live-nav-probe</title></head><body>ok</body></html>'),
      );

      const event = await navPromise;
      expect(event.type).toBe('nav');
      if (event.type !== 'nav') throw new Error('unexpected event type');
      expect(event.title).toBe('live-nav-probe');
      expect(event.url.includes('live-nav-probe')).toBe(true);
      expect(typeof event.timestamp).toBe('number');
    }, 30_000);

    it('捕获 console 事件', async () => {
      const consolePromise = waitForEvent(
        session,
        (event) => event.type === 'console' && event.text.includes('live-console-probe'),
      );
      await session.goto(
        dataUrl("<html><body><script>console.warn('live-console-probe')</script></body></html>"),
      );

      const event = await consolePromise;
      expect(event.type).toBe('console');
      if (event.type !== 'console') throw new Error('unexpected event type');
      expect(event.level).toBe('warn');
      expect(typeof event.timestamp).toBe('number');
    }, 30_000);

    it('startScreencast 收到帧且 ackScreencastFrame 可解析', async () => {
      await session.goto(
        dataUrl('<html><body style="margin:0;background:#0af"><h1>screencast</h1></body></html>'),
      );
      const framePromise = waitForEvent(
        session,
        (event) => event.type === 'screencastFrame',
        20_000,
      );
      await session.startScreencast({
        quality: 60,
        maxWidth: 800,
        maxHeight: 600,
        everyNthFrame: 1,
      });
      await session.dispatchInput({ kind: 'mouse', type: 'mouseMoved', x: 40, y: 40 });

      const event = await framePromise;
      expect(event.type).toBe('screencastFrame');
      if (event.type !== 'screencastFrame') throw new Error('unexpected event type');
      expect(typeof event.data).toBe('string');
      expect(event.data.length).toBeGreaterThan(0);
      expect(typeof event.frameSessionId).toBe('number');
      expect(typeof event.deviceWidth).toBe('number');

      await expect(session.ackScreencastFrame(event.frameSessionId)).resolves.toBeUndefined();
      await session.stopScreencast();
      await expect(session.stopScreencast()).resolves.toBeUndefined();
    }, 45_000);

    it('nodeAtPoint 返回包含 data-testid 的节点信息', async () => {
      const html =
        '<html><body style="margin:0"><button data-testid="live-probe" style="position:absolute;left:20px;top:20px;width:200px;height:100px">点击我</button></body></html>';
      await session.goto(dataUrl(html));

      const node = await session.nodeAtPoint(60, 60);
      expect(node).not.toBeNull();
      expect(node?.attributes['data-testid']).toBe('live-probe');
      expect(node?.selectorHint).toContain('[data-testid="live-probe"]');
      expect(node?.nodeName.toLowerCase()).toBe('button');
      expect(Object.keys(node?.computedStyles ?? {}).length).toBeGreaterThan(0);
    }, 30_000);

    it('nodeAtPoint 对 data-testid 返回唯一选择器', async () => {
      const html =
        '<html><body style="margin:0"><button data-testid="live-unique-testid" style="position:absolute;left:20px;top:20px;width:200px;height:100px">点击我</button></body></html>';
      await session.goto(dataUrl(html));

      const node = await session.nodeAtPoint(60, 60);
      expect(node?.selectorStrategy).toBe('data-testid');
      expect(node?.selectorUnique).toBe(true);
      const page = session.getCurrentPage();
      expect(await page.locator(node?.selectorHint ?? '').count()).toBe(1);
    }, 30_000);

    it('nodeAtPoint 对仅含 id 的节点返回唯一 id 选择器', async () => {
      const html =
        '<html><body style="margin:0"><div id="live-unique-id" style="position:absolute;left:20px;top:20px;width:200px;height:100px;background:#123456"></div></body></html>';
      await session.goto(dataUrl(html));

      const node = await session.nodeAtPoint(60, 60);
      expect(node?.selectorStrategy).toBe('id');
      expect(node?.selectorUnique).toBe(true);
      const page = session.getCurrentPage();
      expect(await page.locator(node?.selectorHint ?? '').count()).toBe(1);
    }, 30_000);

    it('nodeAtPoint 在无 testid/id 时回退到唯一 css-path 且可重新解析到同一元素', async () => {
      const html =
        '<html><body style="margin:0"><div data-marker="live-css-marker" style="position:absolute;left:20px;top:20px;width:200px;height:100px;background:#abcdef"></div></body></html>';
      await session.goto(dataUrl(html));

      const node = await session.nodeAtPoint(60, 60);
      expect(node?.selectorStrategy).toBe('css-path');
      expect(node?.selectorUnique).toBe(true);

      const page = session.getCurrentPage();
      const selector = node?.selectorHint ?? '';
      expect(await page.locator(selector).count()).toBe(1);
      expect(await page.locator(selector).getAttribute('data-marker')).toBe('live-css-marker');
    }, 30_000);

    it('nodeAtPoint 在 data-testid 重复时回退到唯一选择器', async () => {
      const html =
        '<html><body style="margin:0">' +
        '<button data-testid="live-dup" style="position:absolute;left:20px;top:20px;width:200px;height:100px">甲</button>' +
        '<button data-testid="live-dup" style="position:absolute;left:300px;top:20px;width:200px;height:100px">乙</button>' +
        '</body></html>';
      await session.goto(dataUrl(html));

      const node = await session.nodeAtPoint(60, 60);
      expect(node).not.toBeNull();
      expect(node?.selectorUnique).toBe(true);
      expect(node?.selectorHint).not.toBe('[data-testid="live-dup"]');

      const page = session.getCurrentPage();
      expect(await page.locator(node?.selectorHint ?? '').count()).toBe(1);
    }, 30_000);

    it('domTree 返回根节点非空且属性已扁平化', async () => {
      await session.goto(
        utf8DataUrl(
          '<html lang="zh-CN"><head><title>dom-tree-probe</title></head><body><div id="probe-host"><button data-testid="dom-probe" aria-label="探测按钮">点我</button></div></body></html>',
        ),
      );

      const tree = await session.domTree();
      expect(tree.root.nodeName.length).toBeGreaterThan(0);

      const probe = findDomNode(
        tree.root,
        (node) => node.attributes['data-testid'] === 'dom-probe',
      );
      expect(probe).not.toBeNull();
      expect(probe?.nodeName.toLowerCase()).toBe('button');
      expect(probe?.attributes['aria-label']).toBe('探测按钮');
      expect(probe?.childCount).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it('domTree 在深度不足时置 truncated，深层页面按足够深度完整返回', async () => {
      await session.goto(
        utf8DataUrl(
          '<html><body><div><section><button data-testid="deep-probe">deep</button></section></div></body></html>',
        ),
      );

      const shallow = await session.domTree({ depth: 1 });
      expect(shallow.truncated).toBe(true);

      const full = await session.domTree({ depth: 12 });
      expect(full.truncated).toBe(false);
      expect(
        findDomNode(full.root, (node) => node.attributes['data-testid'] === 'deep-probe'),
      ).not.toBeNull();
    }, 30_000);

    it('accessibilitySnapshot 返回含带名称按钮的无障碍树', async () => {
      await session.goto(
        utf8DataUrl(
          '<html><body><main><button data-testid="a11y-probe">确认提交</button></main></body></html>',
        ),
      );

      const snapshot = await session.accessibilitySnapshot();
      expect(snapshot.root).not.toBeNull();
      expect(snapshot.nodeCount).toBeGreaterThan(0);

      const root = snapshot.root;
      if (!root) throw new Error('expected an accessibility root');
      const button = findA11yNode(
        root,
        (node) => node.role === 'button' && node.name === '确认提交',
      );
      expect(button).not.toBeNull();
    }, 30_000);

    it('nodeAtPoint 在请求完整样式时携带 fullComputedStyles，缺省路径不带', async () => {
      await session.goto(
        utf8DataUrl(
          '<html><body style="margin:0"><div data-testid="styles-probe" style="position:absolute;left:20px;top:20px;width:100px;height:50px;color:rgb(1, 2, 3)"></div></body></html>',
        ),
      );

      const withStyles = await session.nodeAtPoint(40, 40, { fullComputedStyles: true });
      expect(withStyles?.fullComputedStyles).toBeDefined();
      expect(Object.keys(withStyles?.fullComputedStyles ?? {}).length).toBeGreaterThan(0);
      expect(withStyles?.fullComputedStyles?.['display']).toBeDefined();

      const plain = await session.nodeAtPoint(40, 40);
      expect(plain?.fullComputedStyles).toBeUndefined();
    }, 30_000);

    it('setDeviceMetricsOverride / clearDeviceMetricsOverride 可解析', async () => {
      await expect(
        session.setDeviceMetricsOverride({
          width: 375,
          height: 667,
          deviceScaleFactor: 2,
          mobile: true,
        }),
      ).resolves.toBeUndefined();
      await expect(session.clearDeviceMetricsOverride()).resolves.toBeUndefined();
    }, 20_000);

    it('setDeviceMetricsOverride 在 screencast 静默后仍强制产出同尺寸新帧', async () => {
      await session.goto(
        dataUrl('<html><body style="margin:0;background:#0af"><h1>device-rearm</h1></body></html>'),
      );

      const frames: Array<Extract<BrowserLiveEvent, { type: 'screencastFrame' }>> = [];
      const detach = session.onEvent((event) => {
        if (event.type !== 'screencastFrame') return;
        frames.push(event);
        void session.ackScreencastFrame(event.frameSessionId).catch(() => {
          console.debug('[browser-live-session.test] failed to ack probe frame');
        });
      });

      try {
        await session.startScreencast({ quality: 60 });
        const first = await waitForEvent(
          session,
          (event) => event.type === 'screencastFrame',
          20_000,
        );
        if (first.type !== 'screencastFrame') throw new Error('unexpected event type');

        // 静态页且上一帧已 ack 后 screencast 静默：同尺寸覆写无视觉变化，修复前不会再有新帧。
        await new Promise((resolve) => setTimeout(resolve, 800));
        const settledCount = frames.length;

        await session.setDeviceMetricsOverride({
          width: first.deviceWidth,
          height: first.deviceHeight,
          deviceScaleFactor: 1,
          mobile: false,
        });

        const refreshed = await waitForEvent(
          session,
          (event) =>
            event.type === 'screencastFrame' &&
            event.deviceWidth === first.deviceWidth &&
            event.deviceHeight === first.deviceHeight,
          8_000,
        );
        expect(refreshed.type).toBe('screencastFrame');
        expect(frames.length).toBeGreaterThan(settledCount);
      } finally {
        detach();
        await session.stopScreencast();
        await session.clearDeviceMetricsOverride();
      }
    }, 45_000);

    it('setUserAgentOverride 覆写后按新 UA 导航，清除后恢复默认', async () => {
      const page = session.getCurrentPage();
      const original = await page.evaluate(() => navigator.userAgent);

      await expect(session.setUserAgentOverride('OpenAWorkLiveProbe/1.0')).resolves.toBeUndefined();
      await session.goto(dataUrl('<html><body>ua-override</body></html>'));
      expect(await page.evaluate(() => navigator.userAgent)).toBe('OpenAWorkLiveProbe/1.0');

      await expect(session.setUserAgentOverride(null)).resolves.toBeUndefined();
      await session.goto(dataUrl('<html><body>ua-cleared</body></html>'));
      expect(await page.evaluate(() => navigator.userAgent)).toBe(original);
    }, 30_000);

    it('dispatchInput 支持鼠标、滚轮与键盘事件', async () => {
      await expect(
        session.dispatchInput({
          kind: 'mouse',
          type: 'mousePressed',
          x: 10,
          y: 10,
          button: 'left',
          clickCount: 1,
        }),
      ).resolves.toBeUndefined();
      await expect(
        session.dispatchInput({
          kind: 'mouse',
          type: 'mouseReleased',
          x: 10,
          y: 10,
          button: 'left',
          clickCount: 1,
        }),
      ).resolves.toBeUndefined();
      await expect(
        session.dispatchInput({ kind: 'wheel', x: 10, y: 10, deltaX: 0, deltaY: 120 }),
      ).resolves.toBeUndefined();
      await expect(
        session.dispatchInput({
          kind: 'key',
          type: 'keyDown',
          key: 'a',
          code: 'KeyA',
          windowsVirtualKeyCode: 65,
        }),
      ).resolves.toBeUndefined();
      await expect(
        session.dispatchInput({
          kind: 'key',
          type: 'keyUp',
          key: 'a',
          code: 'KeyA',
          windowsVirtualKeyCode: 65,
        }),
      ).resolves.toBeUndefined();
    }, 20_000);

    it('screenshot 返回非空 Buffer', async () => {
      await session.goto(dataUrl('<html><body>screenshot</body></html>'));
      const result = await session.screenshot({ type: 'png' });
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.mimeType).toBe('image/png');
    }, 30_000);

    it('console 事件携带 CDP 原始栈，且按调用顺序关联到正确事件', async () => {
      const sourceLines = [
        '<!doctype html><html><body>',
        '<script>',
        "console.error('live-stack-alpha');",
        "console.error('live-stack-beta');",
        '</script>',
        '</body></html>',
      ];
      await withHtmlServer(sourceLines.join('\n'), async (url) => {
        const alphaPromise = waitForEvent(
          session,
          (event) => event.type === 'console' && event.text.includes('live-stack-alpha'),
        );
        const betaPromise = waitForEvent(
          session,
          (event) => event.type === 'console' && event.text.includes('live-stack-beta'),
        );

        await session.goto(url);

        const alpha = await alphaPromise;
        const beta = await betaPromise;
        if (alpha.type !== 'console' || beta.type !== 'console') {
          throw new Error('unexpected event type');
        }

        expect(alpha.stack?.length ?? 0).toBeGreaterThan(0);
        expect(beta.stack?.length ?? 0).toBeGreaterThan(0);
        // 两处 console.error 位于相邻源码行：栈顶帧行号必须各自对应，证明未错配。
        expect(alpha.stack?.[0]?.line).toBe(2);
        expect(beta.stack?.[0]?.line).toBe(3);
        expect(alpha.sourceMappedStack).toHaveLength(alpha.stack?.length ?? 0);
      });
    }, 30_000);

    it('未捕获异常经 pageerror 携带 CDP 原始栈', async () => {
      const sourceLines = [
        '<!doctype html><html><body>',
        '<script>',
        "setTimeout(() => { throw new Error('kaput'); }, 0);",
        '</script>',
        '</body></html>',
      ];
      await withHtmlServer(sourceLines.join('\n'), async (url) => {
        const errorPromise = waitForEvent(
          session,
          (event) => event.type === 'pageerror' && event.message.includes('kaput'),
        );

        await session.goto(url);

        const event = await errorPromise;
        if (event.type !== 'pageerror') throw new Error('unexpected event type');
        expect(event.stack?.length ?? 0).toBeGreaterThan(0);
        expect(event.stack?.[0]?.line).toBe(2);
        expect(event.sourceMappedStack).toHaveLength(event.stack?.length ?? 0);
      });
    }, 30_000);
  });
});
