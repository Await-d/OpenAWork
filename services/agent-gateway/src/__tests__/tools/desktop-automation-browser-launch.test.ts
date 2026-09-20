import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructedOptions: [] as unknown[],
  probeMock: vi.fn(),
  startMock: vi.fn(),
}));

vi.mock('@openAwork/browser-automation', () => ({
  DesktopBrowserAutomation: class {
    public constructor(options?: unknown) {
      mocks.constructedOptions.push(options);
    }
    public isStarted(): boolean {
      return false;
    }
    public start = mocks.startMock;
    public goto = vi.fn(async () => undefined);
    public goBack = vi.fn(async () => undefined);
    public goForward = vi.fn(async () => undefined);
    public reload = vi.fn(async () => undefined);
    public click = vi.fn(async () => undefined);
    public type = vi.fn(async () => undefined);
    public press = vi.fn(async () => undefined);
    public evaluate = vi.fn(async () => undefined);
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
  mocks.probeMock.mockReset();
  mocks.startMock.mockReset();
  mocks.startMock.mockResolvedValue(undefined);
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

    await expect(createManager().start()).rejects.toThrow(/安装托管 Playwright 浏览器/);

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

    await expect(createManager().start()).rejects.toThrow(/安装后重试/);
  });

  it('非托管缺失类启动错误保持原样抛出', async () => {
    mocks.probeMock.mockResolvedValue(MANAGED_PROBE);
    mocks.startMock.mockRejectedValue(new Error('Target page, context or browser has been closed'));

    await expect(createManager().start()).rejects.toThrow(
      'Target page, context or browser has been closed',
    );
  });
});
