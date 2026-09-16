/**
 * `probeLiveBrowserAvailability` 的覆盖：
 *
 * - 本仓库环境已安装 Playwright chromium（`PLAYWRIGHT_BROWSERS_PATH`），因此正向
 *   探测可以用真实路径验证；
 * - 通过候选注入覆盖 managed 命中、stale-managed（修订目录在、可执行文件缺失）、
 *   各系统浏览器命中、环境变量覆盖、全部缺失与解析抛错等分支，不依赖宿主机安装情况；
 * - 默认磁盘校验用临时文件验证（零字节 / 可执行位），确保「解析 + stat，不启动浏览器」；
 * - 钉死缓存语义：正向结果进程级缓存，负向结果按 TTL 缓存。
 */

import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDefaultLiveBrowserCandidates,
  NEGATIVE_PROBE_CACHE_TTL_MS,
  probeLiveBrowserAvailability,
  resetLiveBrowserAvailabilityCache,
  resolveOverrideBrowserCandidates,
  resolvePathBrowserCandidatePaths,
  resolveSystemBrowserCandidatePaths,
} from './live-browser-availability.js';
import type {
  BrowserLiveBrowserCandidate,
  BrowserLiveBrowserProbe,
} from './live-browser-availability.js';

const MISSING_PATH = '/nonexistent/openawork-probe/chrome';
const MANAGED_PATH = '/home/user/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const MANAGED_REVISION_DIR = '/home/user/.cache/ms-playwright/chromium-1208';
const SYSTEM_CHROME_PATH = '/usr/bin/google-chrome';
const SYSTEM_CHROMIUM_PATH = '/usr/bin/chromium';
const SYSTEM_EDGE_PATH = '/usr/bin/microsoft-edge';
const SYSTEM_BRAVE_PATH = '/usr/bin/brave-browser';

function candidate(
  source: BrowserLiveBrowserCandidate['source'],
  executablePath: string | null,
): BrowserLiveBrowserCandidate {
  return { source, resolveExecutablePath: () => executablePath };
}

function onlySystemChrome(executablePath: string | null): BrowserLiveBrowserCandidate[] {
  return [candidate('managed', null), candidate('system-chrome', executablePath)];
}

/** 只允许指定路径可用，其余一律视为不可用。 */
function usableOnly(paths: readonly string[]): (executablePath: string) => Promise<boolean> {
  return async (executablePath) => paths.includes(executablePath);
}

beforeEach(() => {
  resetLiveBrowserAvailabilityCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probeLiveBrowserAvailability', () => {
  it('本机环境（默认候选）能解析出真实存在的浏览器可执行文件', async () => {
    const probe = await probeLiveBrowserAvailability();

    expect(probe.available).toBe(true);
    expect(probe.engine).toBe('chromium');
    expect(probe.reason).toBe('ready');
    expect(probe.installable).toBe(false);
    expect(probe.source).not.toBeNull();
    expect(typeof probe.executablePath).toBe('string');
    await expect(access(probe.executablePath ?? '')).resolves.toBeUndefined();
    if (probe.source === 'managed') {
      expect(probe.expectedRevision).toMatch(/^\d+$/);
    } else {
      expect(probe.expectedRevision).toBeNull();
    }
  });

  it('managed 命中时报告 ready，并从路径推导 expectedRevision', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [candidate('managed', MANAGED_PATH)],
      isExecutableUsable: usableOnly([MANAGED_PATH]),
    });

    expect(probe).toEqual<BrowserLiveBrowserProbe>({
      available: true,
      engine: 'chromium',
      source: 'managed',
      executablePath: MANAGED_PATH,
      expectedRevision: '1208',
      reason: 'ready',
      installable: false,
    });
  });

  it('managed 路径不含 chromium-<revision> 段时 expectedRevision 为 null', async () => {
    const customPath = '/opt/browsers/custom/chrome';
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [candidate('managed', customPath)],
      isExecutableUsable: usableOnly([customPath]),
    });

    expect(probe.available).toBe(true);
    expect(probe.source).toBe('managed');
    expect(probe.expectedRevision).toBeNull();
  });

  it('managed 修订目录存在但可执行文件缺失时报告 browser-outdated', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [candidate('managed', MANAGED_PATH), candidate('system-chrome', null)],
      isExecutableUsable: async () => false,
      directoryExists: async (directoryPath) => directoryPath === MANAGED_REVISION_DIR,
    });

    expect(probe).toEqual<BrowserLiveBrowserProbe>({
      available: false,
      engine: 'chromium',
      source: 'managed',
      executablePath: MANAGED_PATH,
      expectedRevision: '1208',
      reason: 'browser-outdated',
      installable: true,
    });
  });

  it('managed 修订目录不存在时不误报 outdated，而是 browser-missing', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [candidate('managed', MANAGED_PATH)],
      isExecutableUsable: async () => false,
      directoryExists: async () => false,
    });

    expect(probe.reason).toBe('browser-missing');
    expect(probe.source).toBeNull();
    expect(probe.executablePath).toBeNull();
    expect(probe.expectedRevision).toBeNull();
    expect(probe.installable).toBe(true);
  });

  it('stale-managed 不遮蔽可用的系统 Chrome', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [candidate('managed', MANAGED_PATH), candidate('system-chrome', SYSTEM_CHROME_PATH)],
      isExecutableUsable: usableOnly([SYSTEM_CHROME_PATH]),
      directoryExists: async (directoryPath) => directoryPath === MANAGED_REVISION_DIR,
    });

    expect(probe.available).toBe(true);
    expect(probe.source).toBe('system-chrome');
    expect(probe.executablePath).toBe(SYSTEM_CHROME_PATH);
    expect(probe.expectedRevision).toBeNull();
    expect(probe.reason).toBe('ready');
  });

  it('stale-managed 不遮蔽可用的系统 Brave（新增系统来源同样生效）', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [
        candidate('managed', MANAGED_PATH),
        candidate('system-brave', SYSTEM_BRAVE_PATH),
      ],
      isExecutableUsable: usableOnly([SYSTEM_BRAVE_PATH]),
      directoryExists: async (directoryPath) => directoryPath === MANAGED_REVISION_DIR,
    });

    expect(probe.available).toBe(true);
    expect(probe.source).toBe('system-brave');
    expect(probe.executablePath).toBe(SYSTEM_BRAVE_PATH);
  });

  it('managed 缺失时回退到系统 Chrome', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: onlySystemChrome(SYSTEM_CHROME_PATH),
      isExecutableUsable: usableOnly([SYSTEM_CHROME_PATH]),
    });

    expect(probe.available).toBe(true);
    expect(probe.source).toBe('system-chrome');
    expect(probe.executablePath).toBe(SYSTEM_CHROME_PATH);
    expect(probe.reason).toBe('ready');
  });

  it('system-chromium / system-edge / system-brave 都能作为可用来源', async () => {
    const runs: readonly [BrowserLiveBrowserCandidate['source'], string][] = [
      ['system-chromium', SYSTEM_CHROMIUM_PATH],
      ['system-edge', SYSTEM_EDGE_PATH],
      ['system-brave', SYSTEM_BRAVE_PATH],
    ];

    for (const [source, executablePath] of runs) {
      resetLiveBrowserAvailabilityCache();
      const probe = await probeLiveBrowserAvailability('chromium', {
        candidates: [candidate('managed', null), candidate(source, executablePath)],
        isExecutableUsable: usableOnly([executablePath]),
      });
      expect(probe.available).toBe(true);
      expect(probe.source).toBe(source);
      expect(probe.executablePath).toBe(executablePath);
    }
  });

  it('全部候选缺失时报告 browser-missing（可安装）', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [
        candidate('managed', MISSING_PATH),
        candidate('system-chrome', '/usr/bin/google-chrome'),
        candidate('system-edge', SYSTEM_EDGE_PATH),
      ],
      isExecutableUsable: async () => false,
      directoryExists: async () => false,
    });

    expect(probe).toEqual<BrowserLiveBrowserProbe>({
      available: false,
      engine: 'chromium',
      source: null,
      executablePath: null,
      expectedRevision: null,
      reason: 'browser-missing',
      installable: true,
    });
  });

  it('解析抛错时报告 probe-failed，原始消息放在 detail 而不是 reason', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [
        {
          source: 'managed',
          resolveExecutablePath: () => {
            throw new Error('playwright registry unavailable');
          },
        },
      ],
    });

    expect(probe.available).toBe(false);
    expect(probe.reason).toBe('probe-failed');
    expect(probe.detail).toBe('playwright registry unavailable');
    expect(probe.reason).not.toContain('playwright registry');
    expect(probe.installable).toBe(false);
    expect(probe.source).toBeNull();
    expect(probe.executablePath).toBeNull();
    expect(probe.expectedRevision).toBeNull();
  });

  it('默认磁盘校验拒绝零字节文件（不启动浏览器，只 stat）', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openawork-probe-'));
    const emptyPath = join(directory, 'chrome');
    try {
      await writeFile(emptyPath, '');
      const probe = await probeLiveBrowserAvailability('chromium', {
        candidates: onlySystemChrome(emptyPath),
      });

      expect(probe.available).toBe(false);
      expect(probe.reason).toBe('browser-missing');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    '默认磁盘校验要求 posix 可执行位',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'openawork-probe-'));
      const scriptPath = join(directory, 'chrome');
      try {
        await writeFile(scriptPath, '#!/bin/sh\nexit 0\n');
        await chmod(scriptPath, 0o644);
        const notExecutable = await probeLiveBrowserAvailability('chromium', {
          candidates: onlySystemChrome(scriptPath),
        });
        expect(notExecutable.available).toBe(false);

        resetLiveBrowserAvailabilityCache();
        await chmod(scriptPath, 0o755);
        const executable = await probeLiveBrowserAvailability('chromium', {
          candidates: onlySystemChrome(scriptPath),
        });
        expect(executable.available).toBe(true);
        expect(executable.source).toBe('system-chrome');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('默认候选顺序为 override → managed → 各系统浏览器', () => {
    const candidates = buildDefaultLiveBrowserCandidates({
      platform: 'linux',
      env: { OPENAWORK_BROWSER_PATH: '/opt/custom/chrome', PATH: '/usr/bin' },
      homeDir: '/home/tester',
    });
    const sources = candidates.map((entry) => entry.source);

    expect(sources[0]).toBe('override');
    expect(sources[1]).toBe('managed');
    expect(sources.slice(2).every((sourceName) => sourceName.startsWith('system-'))).toBe(true);
    expect(sources.slice(2)).not.toContain('override');
  });

  it('正向结果进程级缓存：解析与磁盘检查各只做一次', async () => {
    let checks = 0;
    const candidates = onlySystemChrome(SYSTEM_CHROME_PATH);
    const probeOnce = () =>
      probeLiveBrowserAvailability('chromium', {
        candidates,
        isExecutableUsable: async () => {
          checks += 1;
          return true;
        },
      });

    const first = await probeOnce();
    const second = await probeOnce();

    expect(first.available).toBe(true);
    expect(second).toEqual(first);
    expect(checks).toBe(1);
  });

  it('正向缓存不因候选列表变化而失效（进程生命周期）', async () => {
    const first = await probeLiveBrowserAvailability('chromium', {
      candidates: onlySystemChrome(SYSTEM_CHROME_PATH),
      isExecutableUsable: usableOnly([SYSTEM_CHROME_PATH]),
    });
    const second = await probeLiveBrowserAvailability('chromium', {
      candidates: [candidate('managed', null)],
      isExecutableUsable: async () => false,
    });

    expect(first.available).toBe(true);
    expect(second).toEqual(first);
  });

  it('负向结果按 TTL 缓存，超时后重新探测', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    let resolutions = 0;
    const candidates: BrowserLiveBrowserCandidate[] = [
      {
        source: 'managed',
        resolveExecutablePath: () => {
          resolutions += 1;
          return MISSING_PATH;
        },
      },
    ];

    const first = await probeLiveBrowserAvailability('chromium', { candidates });
    const second = await probeLiveBrowserAvailability('chromium', { candidates });

    expect(first.reason).toBe('browser-missing');
    expect(second).toEqual(first);
    expect(resolutions).toBe(1);

    now += NEGATIVE_PROBE_CACHE_TTL_MS + 1;
    const third = await probeLiveBrowserAvailability('chromium', { candidates });

    expect(third.reason).toBe('browser-missing');
    expect(resolutions).toBe(2);
  });

  it('resetLiveBrowserAvailabilityCache 同时清空正向与负向缓存', async () => {
    let checks = 0;
    const positiveProbe = () =>
      probeLiveBrowserAvailability('chromium', {
        candidates: onlySystemChrome(SYSTEM_CHROME_PATH),
        isExecutableUsable: async () => {
          checks += 1;
          return true;
        },
      });

    await positiveProbe();
    await positiveProbe();
    expect(checks).toBe(1);
    resetLiveBrowserAvailabilityCache();
    await positiveProbe();
    expect(checks).toBe(2);

    resetLiveBrowserAvailabilityCache();
    let resolutions = 0;
    const negativeCandidates: BrowserLiveBrowserCandidate[] = [
      {
        source: 'system-chrome',
        resolveExecutablePath: () => {
          resolutions += 1;
          return MISSING_PATH;
        },
      },
    ];
    await probeLiveBrowserAvailability('chromium', { candidates: negativeCandidates });
    expect(resolutions).toBe(1);
    resetLiveBrowserAvailabilityCache();
    await probeLiveBrowserAvailability('chromium', { candidates: negativeCandidates });
    expect(resolutions).toBe(2);
  });
});

describe('环境变量覆盖', () => {
  it('resolveOverrideBrowserCandidates 按 OPENAWORK_BROWSER_PATH → CHROME_PATH 排序', () => {
    const candidates = resolveOverrideBrowserCandidates({
      OPENAWORK_BROWSER_PATH: '/opt/custom/chrome',
      CHROME_PATH: '/usr/bin/google-chrome',
    });

    expect(candidates.map((entry) => entry.source)).toEqual(['override', 'override']);
    expect(candidates.map((entry) => entry.resolveExecutablePath())).toEqual([
      '/opt/custom/chrome',
      '/usr/bin/google-chrome',
    ]);
  });

  it('resolveOverrideBrowserCandidates 忽略缺失与空白的覆盖', () => {
    expect(resolveOverrideBrowserCandidates({})).toEqual([]);
    expect(resolveOverrideBrowserCandidates({ OPENAWORK_BROWSER_PATH: '   ' })).toEqual([]);
    expect(resolveOverrideBrowserCandidates({ CHROME_PATH: '' })).toEqual([]);
  });

  it('OPENAWORK_BROWSER_PATH 命中时优先于 managed 与系统浏览器', async () => {
    const overridePath = '/opt/custom/brave';
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [
        ...resolveOverrideBrowserCandidates({ OPENAWORK_BROWSER_PATH: overridePath }),
        candidate('managed', MANAGED_PATH),
        candidate('system-chrome', SYSTEM_CHROME_PATH),
      ],
      isExecutableUsable: usableOnly([overridePath, MANAGED_PATH, SYSTEM_CHROME_PATH]),
    });

    expect(probe.available).toBe(true);
    expect(probe.source).toBe('override');
    expect(probe.executablePath).toBe(overridePath);
    expect(probe.expectedRevision).toBeNull();
  });

  it('OPENAWORK_BROWSER_PATH 缺失时 CHROME_PATH 生效', async () => {
    const overridePath = '/usr/bin/google-chrome';
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [
        ...resolveOverrideBrowserCandidates({ CHROME_PATH: overridePath }),
        candidate('managed', MANAGED_PATH),
      ],
      isExecutableUsable: usableOnly([overridePath]),
    });

    expect(probe.source).toBe('override');
    expect(probe.executablePath).toBe(overridePath);
  });

  it('无效的 override 不中止搜索，继续回退到 managed', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [
        ...resolveOverrideBrowserCandidates({ OPENAWORK_BROWSER_PATH: MISSING_PATH }),
        candidate('managed', MANAGED_PATH),
      ],
      isExecutableUsable: usableOnly([MANAGED_PATH]),
    });

    expect(probe.available).toBe(true);
    expect(probe.source).toBe('managed');
    expect(probe.executablePath).toBe(MANAGED_PATH);
  });

  it('第一个 override 无效时仍会尝试第二个 override', async () => {
    const overridePath = '/opt/custom/chrome';
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: resolveOverrideBrowserCandidates({
        OPENAWORK_BROWSER_PATH: MISSING_PATH,
        CHROME_PATH: overridePath,
      }),
      isExecutableUsable: usableOnly([overridePath]),
    });

    expect(probe.source).toBe('override');
    expect(probe.executablePath).toBe(overridePath);
  });

  it('无效的 override 且无其他候选时诚实地报告 browser-missing', async () => {
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates: [
        ...resolveOverrideBrowserCandidates({ OPENAWORK_BROWSER_PATH: MISSING_PATH }),
        candidate('managed', MISSING_PATH),
      ],
      isExecutableUsable: async () => false,
      directoryExists: async () => false,
    });

    expect(probe.available).toBe(false);
    expect(probe.reason).toBe('browser-missing');
    expect(probe.source).toBeNull();
    expect(probe.executablePath).toBeNull();
    expect(probe.installable).toBe(true);
  });
});

describe('PATH 解析', () => {
  it('resolvePathBrowserCandidatePaths 按 PATH 展开各家族（posix）', () => {
    const resolved = resolvePathBrowserCandidatePaths({
      platform: 'linux',
      env: { PATH: '/opt/bin:/usr/local/bin' },
    });

    expect(resolved.chrome).toEqual([
      join('/opt/bin', 'google-chrome'),
      join('/usr/local/bin', 'google-chrome'),
      join('/opt/bin', 'google-chrome-stable'),
      join('/usr/local/bin', 'google-chrome-stable'),
      join('/opt/bin', 'chrome'),
      join('/usr/local/bin', 'chrome'),
    ]);
    expect(resolved.chromium).toEqual([
      join('/opt/bin', 'chromium'),
      join('/usr/local/bin', 'chromium'),
      join('/opt/bin', 'chromium-browser'),
      join('/usr/local/bin', 'chromium-browser'),
    ]);
    expect(resolved.brave).toContain(join('/opt/bin', 'brave-browser'));
    expect(resolved.vivaldi).toContain(join('/usr/local/bin', 'vivaldi'));
    expect(resolved.opera).toContain(join('/opt/bin', 'opera'));
    expect(resolved.edge).toContain(join('/opt/bin', 'microsoft-edge'));
  });

  it('resolvePathBrowserCandidatePaths 在 Windows 上遵循 PATHEXT', () => {
    const resolved = resolvePathBrowserCandidatePaths({
      platform: 'win32',
      env: { PATH: 'C:\\tools;C:\\other', PATHEXT: '.EXE;.CMD' },
    });

    expect(resolved.chrome).toContain(join('C:\\tools', 'google-chrome.EXE'));
    expect(resolved.chrome).toContain(join('C:\\tools', 'chrome.CMD'));
    expect(resolved.edge).toContain(join('C:\\other', 'msedge.EXE'));
    expect(resolved.brave).toContain(join('C:\\other', 'brave.EXE'));
  });

  it('resolvePathBrowserCandidatePaths 在 Windows 缺省 PATHEXT 时使用系统默认扩展名', () => {
    const resolved = resolvePathBrowserCandidatePaths({
      platform: 'win32',
      env: { PATH: 'C:\\tools' },
    });

    expect(resolved.chrome).toContain(join('C:\\tools', 'chrome.EXE'));
  });

  it('resolvePathBrowserCandidatePaths 无 PATH 时返回空分组', () => {
    const resolved = resolvePathBrowserCandidatePaths({ platform: 'linux', env: {} });

    expect(resolved).toEqual({
      chrome: [],
      chromium: [],
      edge: [],
      brave: [],
      vivaldi: [],
      opera: [],
    });
  });

  it('PATH 命中 brave-browser 时经默认候选解析为 system-brave', async () => {
    const bravePath = join('/custom/bin', 'brave-browser');
    const candidates = buildDefaultLiveBrowserCandidates({
      platform: 'linux',
      env: { PATH: '/custom/bin' },
      homeDir: '/home/tester',
    });
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates,
      isExecutableUsable: usableOnly([bravePath]),
    });

    expect(probe.available).toBe(true);
    expect(probe.source).toBe('system-brave');
    expect(probe.executablePath).toBe(bravePath);
  });

  it('Windows PATH + PATHEXT 命中 chrome 时经默认候选解析为 system-chrome', async () => {
    const chromePath = join('C:\\tools', 'chrome.EXE');
    const candidates = buildDefaultLiveBrowserCandidates({
      platform: 'win32',
      env: { PATH: 'C:\\tools', PATHEXT: '.EXE' },
      homeDir: 'C:\\Users\\tester',
    });
    const probe = await probeLiveBrowserAvailability('chromium', {
      candidates,
      isExecutableUsable: usableOnly([chromePath]),
    });

    expect(probe.available).toBe(true);
    expect(probe.source).toBe('system-chrome');
    expect(probe.executablePath).toBe(chromePath);
  });
});

describe('resolveSystemBrowserCandidatePaths', () => {
  it('linux 覆盖 Chrome / Chromium / Edge / Brave / Vivaldi / Opera（含 flatpak / snap）', () => {
    const resolved = resolveSystemBrowserCandidatePaths({
      platform: 'linux',
      env: {},
      homeDir: '/home/tester',
    });

    expect(resolved.chrome).toEqual([
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chrome',
      '/opt/google/chrome/chrome',
      '/usr/local/bin/google-chrome',
      '/usr/local/bin/google-chrome-stable',
      '/var/lib/flatpak/exports/bin/com.google.Chrome',
    ]);
    expect(resolved.chromium).toEqual([
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/local/bin/chromium',
      '/usr/local/bin/chromium-browser',
      '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
    ]);
    expect(resolved.edge).toEqual([
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/local/bin/microsoft-edge',
      '/opt/microsoft/msedge/msedge',
      '/var/lib/flatpak/exports/bin/com.microsoft.Edge',
    ]);
    expect(resolved.brave).toContain('/snap/bin/brave');
    expect(resolved.brave).toContain('/var/lib/flatpak/exports/bin/com.brave.Browser');
    expect(resolved.vivaldi).toContain('/var/lib/flatpak/exports/bin/com.vivaldi.Vivaldi');
    expect(resolved.opera).toContain('/snap/bin/opera');
    expect(resolved.opera).toContain('/var/lib/flatpak/exports/bin/com.opera.Opera');
  });

  it('darwin 同时覆盖系统级与用户级安装目录，以及 Chrome 各发布通道', () => {
    const resolved = resolveSystemBrowserCandidatePaths({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/tester',
    });
    const userApplications = (relativePath: string) =>
      join('/Users/tester', 'Applications', relativePath);

    expect(resolved.chrome).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      userApplications('Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      userApplications('Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'),
      '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
      userApplications('Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'),
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      userApplications('Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'),
    ]);
    expect(resolved.chromium).toEqual([
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      userApplications('Chromium.app/Contents/MacOS/Chromium'),
    ]);
    expect(resolved.brave).toEqual([
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      userApplications('Brave Browser.app/Contents/MacOS/Brave Browser'),
    ]);
    expect(resolved.vivaldi).toEqual([
      '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
      userApplications('Vivaldi.app/Contents/MacOS/Vivaldi'),
    ]);
    expect(resolved.opera).toEqual([
      '/Applications/Opera.app/Contents/MacOS/Opera',
      userApplications('Opera.app/Contents/MacOS/Opera'),
    ]);
  });

  it('win32 按环境变量展开各家族路径与发布通道', () => {
    const localAppData = 'C:\\Users\\tester\\AppData\\Local';
    const programFiles = 'C:\\Program Files';
    const programFilesX86 = 'C:\\Program Files (x86)';
    const resolved = resolveSystemBrowserCandidatePaths({
      platform: 'win32',
      env: {
        LOCALAPPDATA: localAppData,
        PROGRAMFILES: programFiles,
        'PROGRAMFILES(X86)': programFilesX86,
      },
      homeDir: 'C:\\Users\\tester',
    });
    const roots = [localAppData, programFiles, programFilesX86];

    expect(resolved.chrome).toEqual([
      ...roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((root) => join(root, 'Google', 'Chrome Beta', 'Application', 'chrome.exe')),
      ...roots.map((root) => join(root, 'Google', 'Chrome Dev', 'Application', 'chrome.exe')),
      join(localAppData, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
    ]);
    expect(resolved.edge).toEqual([
      ...roots.map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...roots.map((root) => join(root, 'Microsoft', 'Edge Beta', 'Application', 'msedge.exe')),
      ...roots.map((root) => join(root, 'Microsoft', 'Edge Dev', 'Application', 'msedge.exe')),
      join(localAppData, 'Microsoft', 'Edge SxS', 'Application', 'msedge.exe'),
    ]);
    expect(resolved.brave).toEqual(
      roots.map((root) =>
        join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      ),
    );
    expect(resolved.vivaldi).toEqual(
      roots.map((root) => join(root, 'Vivaldi', 'Application', 'vivaldi.exe')),
    );
    expect(resolved.opera).toEqual([
      ...[programFiles, programFilesX86].map((root) => join(root, 'Opera', 'opera.exe')),
      join(localAppData, 'Programs', 'Opera', 'opera.exe'),
    ]);
  });

  it('win32 缺少环境变量时跳过对应候选', () => {
    const resolved = resolveSystemBrowserCandidatePaths({
      platform: 'win32',
      env: {},
      homeDir: 'C:\\Users\\tester',
    });

    expect(resolved.chrome).toEqual([]);
    expect(resolved.chromium).toEqual([]);
    expect(resolved.edge).toEqual([]);
    expect(resolved.brave).toEqual([]);
    expect(resolved.vivaldi).toEqual([]);
    expect(resolved.opera).toEqual([]);
  });

  it('未知平台返回空列表（不猜测路径）', () => {
    const resolved = resolveSystemBrowserCandidatePaths({
      platform: 'freebsd',
      env: {},
      homeDir: '/home/tester',
    });

    expect(resolved).toEqual({
      chrome: [],
      chromium: [],
      edge: [],
      brave: [],
      vivaldi: [],
      opera: [],
    });
  });
});
