import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  BROWSER_LIVE_DISABLED_MESSAGE,
  BROWSER_LIVE_UNAVAILABLE_MESSAGE,
  buildBrowserLiveUnavailableMessage,
  createBrowserLiveManager,
  isBrowserLiveEnabled,
} from '../../browser-live/manager.js';
import type {
  BrowserLiveManagerOptions,
  BrowserLiveProbeLike,
  BrowserLiveProbeResultLike,
  BrowserLiveSessionLike,
} from '../../browser-live/manager.js';

const MANAGED_EXECUTABLE_PATH =
  '/home/user/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const SYSTEM_CHROME_EXECUTABLE_PATH = '/usr/bin/google-chrome';

const AVAILABLE_PROBE: BrowserLiveProbeResultLike = {
  available: true,
  engine: 'chromium',
  source: 'managed',
  executablePath: MANAGED_EXECUTABLE_PATH,
  expectedRevision: '1208',
  reason: 'ready',
  installable: false,
};

const SYSTEM_CHROME_PROBE: BrowserLiveProbeResultLike = {
  available: true,
  engine: 'chromium',
  source: 'system-chrome',
  executablePath: SYSTEM_CHROME_EXECUTABLE_PATH,
  expectedRevision: null,
  reason: 'ready',
  installable: false,
};

const MISSING_PROBE: BrowserLiveProbeResultLike = {
  available: false,
  engine: 'chromium',
  source: null,
  executablePath: null,
  expectedRevision: null,
  reason: 'browser-missing',
  installable: true,
};

const SYSTEM_BRAVE_EXECUTABLE_PATH = '/usr/bin/brave-browser';

const SYSTEM_BRAVE_PROBE: BrowserLiveProbeResultLike = {
  available: true,
  engine: 'chromium',
  source: 'system-brave',
  executablePath: SYSTEM_BRAVE_EXECUTABLE_PATH,
  expectedRevision: null,
  reason: 'ready',
  installable: false,
};

const OVERRIDE_EXECUTABLE_PATH = '/opt/custom/chrome';

const OVERRIDE_PROBE: BrowserLiveProbeResultLike = {
  available: true,
  engine: 'chromium',
  source: 'override',
  executablePath: OVERRIDE_EXECUTABLE_PATH,
  expectedRevision: null,
  reason: 'ready',
  installable: false,
};

function createProbe(result: BrowserLiveProbeResultLike): Mock<BrowserLiveProbeLike> {
  return vi.fn(async () => result);
}

function createManager(
  options: Partial<BrowserLiveManagerOptions> & { enabled: boolean },
  probe: BrowserLiveProbeResultLike = AVAILABLE_PROBE,
) {
  return createBrowserLiveManager({ probeBrowserAvailability: createProbe(probe), ...options });
}

function createFakeSession(): {
  session: BrowserLiveSessionLike;
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const start = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const session: BrowserLiveSessionLike = {
    start,
    close,
    isStarted: () => true,
    getEngine: () => 'chromium',
    supportsScreencast: () => true,
    onEvent: vi.fn().mockReturnValue(() => undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    currentUrl: vi.fn().mockResolvedValue('https://example.com/'),
    currentTitle: vi.fn().mockResolvedValue('Example'),
    startScreencast: vi.fn().mockResolvedValue(undefined),
    ackScreencastFrame: vi.fn().mockResolvedValue(undefined),
    stopScreencast: vi.fn().mockResolvedValue(undefined),
    setDeviceMetricsOverride: vi.fn().mockResolvedValue(undefined),
    clearDeviceMetricsOverride: vi.fn().mockResolvedValue(undefined),
    setUserAgentOverride: vi.fn().mockResolvedValue(undefined),
    dispatchInput: vi.fn().mockResolvedValue(undefined),
    nodeAtPoint: vi.fn().mockResolvedValue(null),
    domTree: vi.fn().mockResolvedValue({
      root: { nodeId: 1, backendNodeId: 1, nodeName: 'HTML', attributes: {}, childCount: 0 },
      truncated: false,
    }),
    accessibilitySnapshot: vi.fn().mockResolvedValue({ root: null, nodeCount: 0 }),
    screenshot: vi.fn().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'image/png' }),
  };
  return { session, start, close };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createBrowserLiveManager', () => {
  it('reports the disabled availability shape and throws on acquire without probing', async () => {
    const probe = createProbe(AVAILABLE_PROBE);
    const manager = createBrowserLiveManager({
      enabled: false,
      probeBrowserAvailability: probe,
    });

    await expect(manager.availability()).resolves.toEqual({
      available: false,
      engine: null,
      screencast: false,
      reason: BROWSER_LIVE_DISABLED_MESSAGE,
    });
    await expect(manager.acquire('u-1')).rejects.toThrow(BROWSER_LIVE_DISABLED_MESSAGE);
    expect(probe).not.toHaveBeenCalled();
  });

  it('derives engine/screencast from the probe before any session is warm and is idempotent', async () => {
    const fake = createFakeSession();
    const manager = createManager({
      enabled: true,
      createSession: () => fake.session,
    });

    const first = await manager.availability();
    const second = await manager.availability();
    expect(first).toEqual({ available: true, engine: 'chromium', screencast: true });
    expect(second).toEqual(first);

    const handle = await manager.acquire('u-1');
    expect(handle.session).toBe(fake.session);
    await expect(manager.availability()).resolves.toEqual({
      available: true,
      engine: 'chromium',
      screencast: true,
    });
  });

  it('reports browser-missing and refuses acquire when the probe cannot find a browser', async () => {
    const fake = createFakeSession();
    const manager = createManager(
      {
        enabled: true,
        createSession: () => fake.session,
      },
      MISSING_PROBE,
    );

    await expect(manager.availability()).resolves.toEqual({
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser-missing',
      installable: true,
      source: null,
      expectedRevision: null,
      executablePath: null,
    });
    await expect(manager.acquire('u-1')).rejects.toThrow(
      buildBrowserLiveUnavailableMessage('browser-missing'),
    );
    await expect(manager.acquire('u-1')).rejects.toThrow(BROWSER_LIVE_UNAVAILABLE_MESSAGE);
    expect(fake.start).not.toHaveBeenCalled();
  });

  it('reports browser-outdated with the stale managed revision as installable', async () => {
    const manager = createManager(
      { enabled: true },
      {
        available: false,
        engine: 'chromium',
        source: 'managed',
        executablePath: MANAGED_EXECUTABLE_PATH,
        expectedRevision: '1208',
        reason: 'browser-outdated',
        installable: true,
      },
    );

    await expect(manager.availability()).resolves.toEqual({
      available: false,
      engine: 'chromium',
      screencast: false,
      reason: 'browser-outdated',
      installable: true,
      source: 'managed',
      expectedRevision: '1208',
      executablePath: MANAGED_EXECUTABLE_PATH,
    });
  });

  it('keeps engine null when the probe fails before resolving any executable path', async () => {
    const manager = createManager(
      { enabled: true },
      {
        available: false,
        engine: 'chromium',
        source: null,
        executablePath: null,
        expectedRevision: null,
        reason: 'probe-failed',
        installable: false,
      },
    );

    await expect(manager.availability()).resolves.toEqual({
      available: false,
      engine: null,
      screencast: false,
      reason: 'probe-failed',
      installable: false,
      source: null,
      expectedRevision: null,
      executablePath: null,
    });
  });

  it('passes the system-chrome executablePath into the session launch options', async () => {
    const createSession = vi.fn(() => createFakeSession().session);
    const manager = createBrowserLiveManager({
      enabled: true,
      probeBrowserAvailability: createProbe(SYSTEM_CHROME_PROBE),
      createSession,
    });

    const handle = await manager.acquire('u-1');

    expect(handle.session).toBeTruthy();
    expect(createSession).toHaveBeenCalledWith({
      launchOptions: { executablePath: SYSTEM_CHROME_EXECUTABLE_PATH },
    });
  });

  it('passes the system-brave executablePath into the session launch options', async () => {
    const createSession = vi.fn(() => createFakeSession().session);
    const manager = createBrowserLiveManager({
      enabled: true,
      probeBrowserAvailability: createProbe(SYSTEM_BRAVE_PROBE),
      createSession,
    });

    await manager.acquire('u-1');

    expect(createSession).toHaveBeenCalledWith({
      launchOptions: { executablePath: SYSTEM_BRAVE_EXECUTABLE_PATH },
    });
  });

  it('passes the override executablePath into the session launch options', async () => {
    const createSession = vi.fn(() => createFakeSession().session);
    const manager = createBrowserLiveManager({
      enabled: true,
      probeBrowserAvailability: createProbe(OVERRIDE_PROBE),
      createSession,
    });

    await manager.acquire('u-1');

    expect(createSession).toHaveBeenCalledWith({
      launchOptions: { executablePath: OVERRIDE_EXECUTABLE_PATH },
    });
  });

  it('omits executablePath for managed installs so Playwright validates the revision', async () => {
    const createSession = vi.fn(() => createFakeSession().session);
    const manager = createBrowserLiveManager({
      enabled: true,
      probeBrowserAvailability: createProbe(AVAILABLE_PROBE),
      createSession,
    });

    await manager.acquire('u-1');

    expect(createSession).toHaveBeenCalledWith({});
  });

  it('returns the same handle to concurrent acquirers and starts the session once', async () => {
    const fake = createFakeSession();
    const manager = createManager({
      enabled: true,
      createSession: () => fake.session,
    });

    const [first, second] = await Promise.all([manager.acquire('u-1'), manager.acquire('u-1')]);

    expect(first).toBe(second);
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(fake.close).not.toHaveBeenCalled();
  });

  it('keeps the session warm through the idle TTL and reuses it on re-acquire', async () => {
    vi.useFakeTimers();
    const fake = createFakeSession();
    const manager = createManager({
      enabled: true,
      idleTtlMs: 100,
      createSession: () => fake.session,
    });

    const handle = await manager.acquire('u-1');
    manager.release(handle);

    await vi.advanceTimersByTimeAsync(50);
    expect(fake.close).not.toHaveBeenCalled();

    const reacquired = await manager.acquire('u-1');
    expect(reacquired).toBe(handle);
    expect(fake.start).toHaveBeenCalledTimes(1);

    manager.release(reacquired);
    await vi.advanceTimersByTimeAsync(120);

    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(manager.handleFor('u-1')).toBeNull();
  });

  it('reaps the session once the idle TTL elapses', async () => {
    vi.useFakeTimers();
    const fake = createFakeSession();
    const manager = createManager({
      enabled: true,
      idleTtlMs: 100,
      createSession: () => fake.session,
    });

    const handle = await manager.acquire('u-1');
    manager.release(handle);
    await vi.advanceTimersByTimeAsync(120);

    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(manager.handleFor('u-1')).toBeNull();
  });

  it('clears timers and closes every session on close()', async () => {
    vi.useFakeTimers();
    const fake = createFakeSession();
    const manager = createManager({
      enabled: true,
      idleTtlMs: 100,
      createSession: () => fake.session,
    });

    const handle = await manager.acquire('u-1');
    manager.release(handle);

    await manager.close();
    expect(fake.close).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(fake.close).toHaveBeenCalledTimes(1);
  });
});

describe('isBrowserLiveEnabled', () => {
  it('stays disabled when no switch is set', () => {
    expect(isBrowserLiveEnabled({})).toBe(false);
    expect(isBrowserLiveEnabled({ DESKTOP_AUTOMATION: '0' })).toBe(false);
    expect(isBrowserLiveEnabled({ OPENAWORK_BROWSER_LIVE: 'true' })).toBe(false);
  });

  it('turns on via the dedicated switch without enabling desktop automation', () => {
    expect(isBrowserLiveEnabled({ OPENAWORK_BROWSER_LIVE: '1' })).toBe(true);
  });

  it('keeps DESKTOP_AUTOMATION working as the legacy alias', () => {
    expect(isBrowserLiveEnabled({ DESKTOP_AUTOMATION: '1' })).toBe(true);
  });
});
