import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructedOptions: [] as unknown[],
  probeMock: vi.fn(),
  startMock: vi.fn(),
  gotoMock: vi.fn(),
  evaluateMock: vi.fn(),
  /** 供 mock 的 `isStarted()` 反映「已启动」,让状态流转更贴近真实。 */
  started: false,
}));

vi.mock('@openAwork/browser-automation', () => ({
  DesktopBrowserAutomation: class {
    public constructor(options?: unknown) {
      mocks.constructedOptions.push(options);
    }
    public isStarted(): boolean {
      return mocks.started;
    }
    public start = mocks.startMock;
    public goto = mocks.gotoMock;
    public goBack = vi.fn(async () => undefined);
    public goForward = vi.fn(async () => undefined);
    public reload = vi.fn(async () => undefined);
    public click = vi.fn(async () => undefined);
    public type = vi.fn(async () => undefined);
    public press = vi.fn(async () => undefined);
    public evaluate = mocks.evaluateMock;
    public waitForSelector = vi.fn(async () => undefined);
    public waitForTimeout = vi.fn(async () => undefined);
    public content = vi.fn(async () => '');
    public snapshot = vi.fn(async () => ({
      currentPageId: 'page-1',
      openPages: ['page-1'],
      url: 'about:blank',
      title: '',
    }));
    public screenshot = vi.fn(async () => new Uint8Array());
  },
  probeLiveBrowserAvailability: mocks.probeMock,
}));

import { createDesktopAutomationManager } from '../../tools/desktop-automation.js';

const SYSTEM_EDGE_EXECUTABLE_PATH =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MANAGED_EXECUTABLE_PATH =
  'C:\\Users\\user\\.openAwork\\browsers\\chromium-1208\\chrome-win\\chrome.exe';

const SYSTEM_EDGE_PROBE = {
  available: true,
  source: 'system-edge',
  executablePath: SYSTEM_EDGE_EXECUTABLE_PATH,
  reason: 'ready',
  installable: false,
};

const MANAGED_PROBE = {
  available: true,
  source: 'managed',
  executablePath: MANAGED_EXECUTABLE_PATH,
  reason: 'ready',
  installable: false,
};

const MISSING_PROBE = {
  available: false,
  source: null,
  executablePath: null,
  reason: 'browser-missing',
  installable: true,
};

function createManager() {
  return createDesktopAutomationManager({ enabled: true });
}

beforeEach(() => {
  mocks.constructedOptions.length = 0;
  mocks.started = false;
  mocks.probeMock.mockReset();
  mocks.startMock.mockReset();
  mocks.startMock.mockImplementation(async () => {
    mocks.started = true;
  });
  mocks.gotoMock.mockReset();
  mocks.gotoMock.mockResolvedValue(undefined);
  mocks.evaluateMock.mockReset();
  mocks.evaluateMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('desktop_automation browser availability guard', () => {
  it('回退到系统浏览器：托管 Chromium 不可用时用 executablePath 构造', async () => {
    mocks.probeMock.mockResolvedValue(SYSTEM_EDGE_PROBE);

    await createManager().start('https://example.test/');

    expect(mocks.constructedOptions).toEqual([
      { launchOptions: { executablePath: SYSTEM_EDGE_EXECUTABLE_PATH } },
    ]);
    expect(mocks.startMock).toHaveBeenCalledWith('https://example.test/');
  });

  it('完全无可用浏览器时抛出可操作的引导错误，且不构造也不启动', async () => {
    mocks.probeMock.mockResolvedValue(MISSING_PROBE);

    await expect(createManager().start()).rejects.toThrow(/安装调试浏览器/);

    expect(mocks.constructedOptions).toHaveLength(0);
    expect(mocks.startMock).not.toHaveBeenCalled();
  });

  it('托管浏览器可用时不传 executablePath，交给 Playwright 解析修订号', async () => {
    mocks.probeMock.mockResolvedValue(MANAGED_PROBE);

    await createManager().start();

    expect(mocks.constructedOptions).toEqual([{}]);
  });

  it('把 Playwright 原始安装提示替换为可操作错误', async () => {
    mocks.probeMock.mockResolvedValue(MANAGED_PROBE);
    mocks.startMock.mockRejectedValue(
      new Error(
        "browserType.launch: Executable doesn't exist at C:\\browsers\\chromium_headless_shell-1208\\chrome-headless-shell.exe\nPlease run the following command to download new browsers: npx playwright install",
      ),
    );

    await expect(createManager().start()).rejects.toThrow(/安装调试浏览器/);
  });

  it('非托管缺失类启动错误保持原样抛出', async () => {
    mocks.probeMock.mockResolvedValue(MANAGED_PROBE);
    mocks.startMock.mockRejectedValue(new Error('Target page, context or browser has been closed'));

    await expect(createManager().start()).rejects.toThrow(
      'Target page, context or browser has been closed',
    );
  });
});

describe('desktop_automation 页面动作自动启动', () => {
  it('goto 未启动时直接把目标 URL 交给 start,不再抛 No active page', async () => {
    mocks.probeMock.mockResolvedValue(MANAGED_PROBE);

    await createManager().goto('https://example.test/auto');

    expect(mocks.startMock).toHaveBeenCalledTimes(1);
    expect(mocks.startMock).toHaveBeenCalledWith('https://example.test/auto');
    expect(mocks.gotoMock).not.toHaveBeenCalled();
  });

  it('evaluate 未启动时先用空白页启动再执行', async () => {
    mocks.probeMock.mockResolvedValue(MANAGED_PROBE);

    await createManager().evaluate('() => 1');

    expect(mocks.startMock).toHaveBeenCalledTimes(1);
    expect(mocks.startMock.mock.calls[0]?.[0]).toBeUndefined();
    expect(mocks.evaluateMock).toHaveBeenCalledTimes(1);
  });

  it('无可用浏览器时自动启动仍抛出可操作错误', async () => {
    mocks.probeMock.mockResolvedValue(MISSING_PROBE);

    await expect(createManager().goto('https://example.test/auto')).rejects.toThrow(
      /安装调试浏览器/,
    );

    expect(mocks.startMock).not.toHaveBeenCalled();
  });
});

describe('desktop_automation 并发懒启动串行化', () => {
  it('并发页面动作只真正 start 一次(复用同一 in-flight)', async () => {
    mocks.probeMock.mockResolvedValue(MANAGED_PROBE);
    let resolveStart: (() => void) | undefined;
    mocks.startMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );

    const manager = createManager();
    const first = manager.goto('https://example.test/a');
    const second = manager.goto('https://example.test/b');

    await vi.waitFor(() => expect(mocks.startMock).toHaveBeenCalledTimes(1));
    resolveStart?.();
    await Promise.all([first, second]);

    // 核心不变量:无论谁先进入,都只 start 一次(第二次不会再 launch)。
    expect(mocks.startMock).toHaveBeenCalledTimes(1);
    // 另一个调用等待 in-flight 后补一次导航;两个 URL 各用一次。
    expect(mocks.gotoMock).toHaveBeenCalledTimes(1);
    const startUrl = mocks.startMock.mock.calls[0]?.[0];
    const gotoUrl = mocks.gotoMock.mock.calls[0]?.[0];
    expect([startUrl, gotoUrl].sort()).toEqual([
      'https://example.test/a',
      'https://example.test/b',
    ]);
  });

  it('并发懒访问只探测/构造一次', async () => {
    let resolveProbe: ((value: unknown) => void) | undefined;
    mocks.probeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
    );

    const manager = createManager();
    const first = manager.goto('https://example.test/a');
    const second = manager.evaluate('() => 1');

    await vi.waitFor(() => expect(mocks.probeMock).toHaveBeenCalledTimes(1));
    resolveProbe?.(MANAGED_PROBE);
    await Promise.all([first, second]);

    expect(mocks.probeMock).toHaveBeenCalledTimes(1);
    expect(mocks.constructedOptions).toHaveLength(1);
  });
});
