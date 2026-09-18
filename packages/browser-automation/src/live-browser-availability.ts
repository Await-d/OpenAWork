/**
 * 浏览器实时预览（`/browser-live`）的可用性探测。
 *
 * 真实浏览器只在网关侧建立 live session 时由 Playwright 拉起；如果本机没有可用的
 * 浏览器二进制，会话会先声称可用、随后在 `launch()` 时报错。这里在会话建立之前做一次
 * 轻量探测：按**有序候选列表**解析可执行文件路径并做磁盘校验（存在 + 非零大小 +
 * posix 可执行位），**绝不启动浏览器**。
 *
 * 候选顺序（第一个可用者胜出，`browser-outdated` 只作为兜底原因）：
 * 1. `override` —— 环境变量显式覆盖：`OPENAWORK_BROWSER_PATH`（本产品专用，优先）→
 *    `CHROME_PATH`（puppeteer 等工具沿用的通用约定）。覆盖只是「优先尝试」而非「强制」：
 *    路径不可用时必须继续后面的候选，不能因为写了覆盖却没装好就让整次探测失败。
 * 2. `managed` —— Playwright 自带的 chromium。`chromium.executablePath()` 不抛错、
 *    也不做磁盘校验，所以必须由我们补一次 stat；`expectedRevision` 从路径里的
 *    `chromium-<revision>` 段推导，不引入 `browsers.json`。
 * 3. 系统浏览器 —— 依次为 `system-chrome` / `system-chromium` / `system-edge` /
 *    `system-brave` / `system-vivaldi` / `system-opera`。每个浏览器家族内部先看 PATH
 *    （用户 shell 实际能找到的），再看手写的静态安装路径（含 flatpak / snap / 各发布
 *    通道）。playwright-core 的 `exports` 映射屏蔽了内部 registry 子路径，不能直接
 *    import，因此手写路径而不是用 `channel`。
 *
 * 缓存：正向结果进程级缓存（key 为 engine，当前只有 chromium）；负向结果做 ~5s TTL
 * 缓存，既能让刚安装/刚升级的浏览器被迅速拾取，也避免状态轮询反复打盘。
 */

import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

/**
 * 可执行文件来源：Playwright 托管安装、环境变量覆盖，或某一族系统 Chromium 系浏览器。
 * 除 `managed` 外都显式传 `executablePath` 给 Playwright（见网关侧 `buildSessionOptions`）。
 */
export type BrowserLiveBrowserSource =
  | 'managed'
  | 'override'
  | 'system-chrome'
  | 'system-chromium'
  | 'system-edge'
  | 'system-brave'
  | 'system-vivaldi'
  | 'system-opera';

/** 系统浏览器来源（排除 `managed` / `override`，只由 PATH + 静态路径枚举得到）。 */
export type BrowserLiveSystemSource = Exclude<BrowserLiveBrowserSource, 'managed' | 'override'>;

/** 机器可读的探测结论。 */
export type BrowserLiveBrowserReason =
  /** 解析到了可用浏览器。 */
  | 'ready'
  /** 全部候选都不可用；可以通过安装浏览器解决（installable）。 */
  | 'browser-missing'
  /** managed 修订目录存在，但其中的可执行文件缺失/零字节；可通过重装解决（installable）。 */
  | 'browser-outdated'
  /** 探测过程出现预期外错误（例如解析路径抛错）；不属于安装问题。 */
  | 'probe-failed';

export interface BrowserLiveBrowserProbe {
  available: boolean;
  engine: 'chromium';
  source: BrowserLiveBrowserSource | null;
  executablePath: string | null;
  expectedRevision: string | null;
  reason: BrowserLiveBrowserReason;
  installable: boolean;
  /** `probe-failed` 时的原始错误消息（只放 message，绝不放堆栈）。 */
  detail?: string;
}

/** 单个候选：解析出可执行文件路径；`null` / 空串表示该候选在当前环境不适用。 */
export interface BrowserLiveBrowserCandidate {
  source: BrowserLiveBrowserSource;
  resolveExecutablePath: () => string | null;
}

export interface ProbeLiveBrowserAvailabilityOptions {
  /** 测试注入点：覆盖有序候选列表（默认值由 `buildDefaultLiveBrowserCandidates()` 生成）。 */
  candidates?: readonly BrowserLiveBrowserCandidate[];
  /** 测试注入点：覆盖「存在 + 非零大小 + 可执行」检查。 */
  isExecutableUsable?: (executablePath: string) => Promise<boolean>;
  /** 测试注入点：覆盖「目录是否存在」检查（用于区分 stale-managed 与 outright-missing）。 */
  directoryExists?: (directoryPath: string) => Promise<boolean>;
}

/** 各平台浏览器候选路径的公共注入点（不依赖宿主环境，便于测试非本机平台）。 */
export interface SystemBrowserCandidatePathOptions {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
}

/** PATH 扫描所需的最小环境（与平台路径解析共用同一套注入约定）。 */
export interface PathBrowserCandidatePathOptions {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
}

/** 展开后的系统候选路径，按浏览器家族分组；每组顺序即候选优先级。 */
export interface SystemBrowserCandidatePaths {
  readonly chrome: readonly string[];
  readonly chromium: readonly string[];
  readonly edge: readonly string[];
  readonly brave: readonly string[];
  readonly vivaldi: readonly string[];
  readonly opera: readonly string[];
}

const EMPTY_SYSTEM_BROWSER_PATHS: SystemBrowserCandidatePaths = {
  chrome: [],
  chromium: [],
  edge: [],
  brave: [],
  vivaldi: [],
  opera: [],
};

/**
 * 环境变量覆盖键，顺序即优先级：本产品专用覆盖优先于通用约定。
 * 两者都只是「优先尝试」，任一不可用都继续走正常候选。
 */
export const BROWSER_PATH_OVERRIDE_ENV_KEYS = ['OPENAWORK_BROWSER_PATH', 'CHROME_PATH'] as const;

/** PATH 上按浏览器家族搜索的可执行文件名（同一家族内按此顺序尝试）。 */
const PATH_BROWSER_EXECUTABLE_NAMES: readonly {
  readonly source: BrowserLiveSystemSource;
  readonly names: readonly string[];
}[] = [
  { source: 'system-chrome', names: ['google-chrome', 'google-chrome-stable', 'chrome'] },
  { source: 'system-chromium', names: ['chromium', 'chromium-browser'] },
  // `msedge` 是 Windows 上真正的 Edge 可执行名；`microsoft-edge` 为其他平台的命令名。
  { source: 'system-edge', names: ['microsoft-edge', 'microsoft-edge-stable', 'msedge'] },
  { source: 'system-brave', names: ['brave-browser', 'brave'] },
  { source: 'system-vivaldi', names: ['vivaldi', 'vivaldi-stable'] },
  { source: 'system-opera', names: ['opera', 'opera-stable'] },
];

/** 缺省 `PATHEXT`，仅在 Windows 且环境未提供时兜底。 */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function splitPathEntries(rawPath: string | undefined, platform: NodeJS.Platform): string[] {
  if (rawPath === undefined || rawPath.length === 0) {
    return [];
  }
  const separator = platform === 'win32' ? ';' : ':';
  return rawPath
    .split(separator)
    .map((entry) => stripSurroundingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);
}

/** Windows 的 PATH 条目偶尔带引号（目录含空格），解析前先剥掉成对引号。 */
function stripSurroundingQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/** posix 用裸名；Windows 按 `PATHEXT` 约定补扩展名。 */
function executableNameExtensions(
  platform: NodeJS.Platform,
  pathext: string | undefined,
): readonly string[] {
  if (platform !== 'win32') {
    return [''];
  }
  const raw = pathext !== undefined && pathext.trim().length > 0 ? pathext : DEFAULT_PATHEXT;
  const extensions = raw
    .split(';')
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0);
  return extensions.length > 0 ? extensions : ['.EXE'];
}

/**
 * 扫描 PATH，把每个可执行名展开成候选路径。导出为纯函数以便测试注入非本机平台与 PATH。
 * 返回结果按家族分组，组内顺序为「名字 → PATH 条目 → 扩展名」，第一处存在者优先。
 */
export function resolvePathBrowserCandidatePaths(
  options: PathBrowserCandidatePathOptions,
): SystemBrowserCandidatePaths {
  const pathEntries = splitPathEntries(options.env['PATH'], options.platform);
  if (pathEntries.length === 0) {
    return EMPTY_SYSTEM_BROWSER_PATHS;
  }
  const extensions = executableNameExtensions(options.platform, options.env['PATHEXT']);

  const bySource: Record<BrowserLiveSystemSource, string[]> = {
    'system-chrome': [],
    'system-chromium': [],
    'system-edge': [],
    'system-brave': [],
    'system-vivaldi': [],
    'system-opera': [],
  };

  for (const { source, names } of PATH_BROWSER_EXECUTABLE_NAMES) {
    const candidates = bySource[source];
    for (const name of names) {
      for (const entry of pathEntries) {
        for (const extension of extensions) {
          const candidate = join(entry, `${name}${extension}`);
          if (!candidates.includes(candidate)) {
            candidates.push(candidate);
          }
        }
      }
    }
  }

  return {
    chrome: bySource['system-chrome'],
    chromium: bySource['system-chromium'],
    edge: bySource['system-edge'],
    brave: bySource['system-brave'],
    vivaldi: bySource['system-vivaldi'],
    opera: bySource['system-opera'],
  };
}

/** 用环境变量根目录（如 `PROGRAMFILES`）拼出 Windows 安装路径，缺失的根直接跳过。 */
function windowsInstallPaths(
  roots: readonly (string | undefined)[],
  relativeSegments: readonly string[],
): string[] {
  const paths: string[] = [];
  for (const root of roots) {
    if (root === undefined || root.length === 0) {
      continue;
    }
    paths.push(join(root, ...relativeSegments));
  }
  return paths;
}

/** macOS `.app` 包内可执行文件：系统级 `/Applications` 与用户级 `~/Applications` 各一份。 */
function macOSAppExecutables(homeDir: string, relativePath: string): string[] {
  return [`/Applications/${relativePath}`, join(homeDir, 'Applications', relativePath)];
}

/**
 * 按平台展开系统 Chromium 系浏览器的候选路径（不含 PATH 扫描，见
 * `resolvePathBrowserCandidatePaths`）。导出为纯函数以便测试注入非本机平台，
 * 避免测试结果随宿主机安装情况漂移。
 */
export function resolveSystemBrowserCandidatePaths(
  options: SystemBrowserCandidatePathOptions,
): SystemBrowserCandidatePaths {
  switch (options.platform) {
    case 'linux':
      return {
        chrome: [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chrome',
          '/opt/google/chrome/chrome',
          '/usr/local/bin/google-chrome',
          '/usr/local/bin/google-chrome-stable',
          '/var/lib/flatpak/exports/bin/com.google.Chrome',
        ],
        chromium: [
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
          '/usr/local/bin/chromium',
          '/usr/local/bin/chromium-browser',
          '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
        ],
        edge: [
          '/usr/bin/microsoft-edge',
          '/usr/bin/microsoft-edge-stable',
          '/usr/local/bin/microsoft-edge',
          '/opt/microsoft/msedge/msedge',
          '/var/lib/flatpak/exports/bin/com.microsoft.Edge',
        ],
        brave: [
          '/usr/bin/brave-browser',
          '/usr/bin/brave',
          '/snap/bin/brave',
          '/usr/local/bin/brave-browser',
          '/usr/local/bin/brave',
          '/var/lib/flatpak/exports/bin/com.brave.Browser',
        ],
        vivaldi: [
          '/usr/bin/vivaldi',
          '/usr/bin/vivaldi-stable',
          '/usr/local/bin/vivaldi',
          '/var/lib/flatpak/exports/bin/com.vivaldi.Vivaldi',
        ],
        opera: [
          '/usr/bin/opera',
          '/usr/bin/opera-stable',
          '/snap/bin/opera',
          '/usr/local/bin/opera',
          '/var/lib/flatpak/exports/bin/com.opera.Opera',
        ],
      };
    case 'darwin': {
      const { homeDir } = options;
      return {
        chrome: [
          ...macOSAppExecutables(homeDir, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
          ...macOSAppExecutables(
            homeDir,
            'Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
          ),
          ...macOSAppExecutables(homeDir, 'Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'),
          ...macOSAppExecutables(
            homeDir,
            'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
          ),
        ],
        chromium: macOSAppExecutables(homeDir, 'Chromium.app/Contents/MacOS/Chromium'),
        edge: macOSAppExecutables(homeDir, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
        brave: macOSAppExecutables(homeDir, 'Brave Browser.app/Contents/MacOS/Brave Browser'),
        vivaldi: macOSAppExecutables(homeDir, 'Vivaldi.app/Contents/MacOS/Vivaldi'),
        opera: macOSAppExecutables(homeDir, 'Opera.app/Contents/MacOS/Opera'),
      };
    }
    case 'win32': {
      const localAppData = options.env['LOCALAPPDATA'];
      const programFiles = options.env['PROGRAMFILES'];
      const programFilesX86 = options.env['PROGRAMFILES(X86)'];
      const allRoots = [localAppData, programFiles, programFilesX86];
      const programRoots = [programFiles, programFilesX86];
      return {
        chrome: [
          ...windowsInstallPaths(allRoots, ['Google', 'Chrome', 'Application', 'chrome.exe']),
          ...windowsInstallPaths(allRoots, ['Google', 'Chrome Beta', 'Application', 'chrome.exe']),
          ...windowsInstallPaths(allRoots, ['Google', 'Chrome Dev', 'Application', 'chrome.exe']),
          // Canary 只做 per-user 安装，目录名为 `Chrome SxS`。
          ...windowsInstallPaths(
            [localAppData],
            ['Google', 'Chrome SxS', 'Application', 'chrome.exe'],
          ),
        ],
        chromium: windowsInstallPaths(allRoots, ['Chromium', 'Application', 'chrome.exe']),
        edge: [
          ...windowsInstallPaths(allRoots, ['Microsoft', 'Edge', 'Application', 'msedge.exe']),
          ...windowsInstallPaths(allRoots, ['Microsoft', 'Edge Beta', 'Application', 'msedge.exe']),
          ...windowsInstallPaths(allRoots, ['Microsoft', 'Edge Dev', 'Application', 'msedge.exe']),
          ...windowsInstallPaths(
            [localAppData],
            ['Microsoft', 'Edge SxS', 'Application', 'msedge.exe'],
          ),
        ],
        brave: windowsInstallPaths(allRoots, [
          'BraveSoftware',
          'Brave-Browser',
          'Application',
          'brave.exe',
        ]),
        vivaldi: windowsInstallPaths(allRoots, ['Vivaldi', 'Application', 'vivaldi.exe']),
        opera: [
          ...windowsInstallPaths(programRoots, ['Opera', 'opera.exe']),
          // Opera 的 per-user 安装落在 `%LOCALAPPDATA%\Programs\Opera`。
          ...windowsInstallPaths([localAppData], ['Programs', 'Opera', 'opera.exe']),
        ],
      };
    }
    default:
      return EMPTY_SYSTEM_BROWSER_PATHS;
  }
}

/**
 * 把环境变量覆盖解析成候选（`OPENAWORK_BROWSER_PATH` 先于 `CHROME_PATH`）。
 * 只负责列出候选；是否可用仍由统一的可执行性检查决定，失败时调用方继续后续候选。
 */
export function resolveOverrideBrowserCandidates(
  env: Readonly<Record<string, string | undefined>>,
): BrowserLiveBrowserCandidate[] {
  const candidates: BrowserLiveBrowserCandidate[] = [];
  for (const key of BROWSER_PATH_OVERRIDE_ENV_KEYS) {
    const overriddenPath = env[key]?.trim();
    if (overriddenPath === undefined || overriddenPath.length === 0) {
      continue;
    }
    candidates.push({ source: 'override', resolveExecutablePath: () => overriddenPath });
  }
  return candidates;
}

function toCandidates(
  source: BrowserLiveBrowserSource,
  executablePaths: readonly string[],
): BrowserLiveBrowserCandidate[] {
  return executablePaths.map((executablePath) => ({
    source,
    resolveExecutablePath: () => executablePath,
  }));
}

/** 默认有序候选列表：override → managed → 各系统浏览器（组内 PATH 先于静态路径）。 */
export function buildDefaultLiveBrowserCandidates(
  platformOptions: SystemBrowserCandidatePathOptions = {
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
  },
): readonly BrowserLiveBrowserCandidate[] {
  const system = resolveSystemBrowserCandidatePaths(platformOptions);
  const pathResolved = resolvePathBrowserCandidatePaths({
    platform: platformOptions.platform,
    env: platformOptions.env,
  });
  return [
    ...resolveOverrideBrowserCandidates(platformOptions.env),
    { source: 'managed', resolveExecutablePath: () => chromium.executablePath() },
    ...toCandidates('system-chrome', [...pathResolved.chrome, ...system.chrome]),
    ...toCandidates('system-chromium', [...pathResolved.chromium, ...system.chromium]),
    ...toCandidates('system-edge', [...pathResolved.edge, ...system.edge]),
    ...toCandidates('system-brave', [...pathResolved.brave, ...system.brave]),
    ...toCandidates('system-vivaldi', [...pathResolved.vivaldi, ...system.vivaldi]),
    ...toCandidates('system-opera', [...pathResolved.opera, ...system.opera]),
  ];
}

/** 校验：存在、是普通文件、非零大小、posix 下可执行。 */
async function defaultIsExecutableUsable(executablePath: string): Promise<boolean> {
  try {
    const stats = await stat(executablePath);
    if (!stats.isFile() || stats.size === 0) {
      return false;
    }
    if (process.platform !== 'win32') {
      // Windows 没有可执行位；posix 下 X_OK 同时覆盖了「存在 + 有权限执行」。
      await access(executablePath, constants.X_OK);
    }
    return true;
  } catch {
    // 不存在 / 无权限 / 不是普通文件：一律按不可用处理，由调用方决定如何降级。
    return false;
  }
}

async function defaultDirectoryExists(directoryPath: string): Promise<boolean> {
  try {
    const stats = await stat(directoryPath);
    return stats.isDirectory();
  } catch {
    // 目录不存在 / 无权限：按不存在处理。
    return false;
  }
}

const CHROMIUM_REVISION_PATTERN = /chromium-(\d+)/;

interface ManagedRevisionMatch {
  revision: string;
  /** 路径中 `chromium-<revision>` 段对应的目录（用于判定安装是否只是过期/残缺）。 */
  directory: string;
}

function matchManagedRevision(executablePath: string): ManagedRevisionMatch | null {
  const match = CHROMIUM_REVISION_PATTERN.exec(executablePath);
  const revision = match?.[1];
  if (revision === undefined) {
    return null;
  }
  const segment = `chromium-${revision}`;
  const segmentIndex = executablePath.indexOf(segment);
  if (segmentIndex < 0) {
    return null;
  }
  return { revision, directory: executablePath.slice(0, segmentIndex + segment.length) };
}

function buildReadyProbe(
  source: BrowserLiveBrowserSource,
  executablePath: string,
): BrowserLiveBrowserProbe {
  const revision = source === 'managed' ? matchManagedRevision(executablePath) : null;
  return {
    available: true,
    engine: 'chromium',
    source,
    executablePath,
    expectedRevision: revision?.revision ?? null,
    reason: 'ready',
    installable: false,
  };
}

function buildUnavailableProbe(
  reason: BrowserLiveBrowserReason,
  values: {
    source?: BrowserLiveBrowserSource | null;
    executablePath?: string | null;
    expectedRevision?: string | null;
    installable: boolean;
    detail?: string;
  },
): BrowserLiveBrowserProbe {
  const probe: BrowserLiveBrowserProbe = {
    available: false,
    engine: 'chromium',
    source: values.source ?? null,
    executablePath: values.executablePath ?? null,
    expectedRevision: values.expectedRevision ?? null,
    reason,
    installable: values.installable,
  };
  if (values.detail !== undefined) {
    probe.detail = values.detail;
  }
  return probe;
}

async function runProbe(
  options: ProbeLiveBrowserAvailabilityOptions,
): Promise<BrowserLiveBrowserProbe> {
  const isExecutableUsable = options.isExecutableUsable ?? defaultIsExecutableUsable;
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;

  try {
    const candidates = options.candidates ?? buildDefaultLiveBrowserCandidates();
    let staleManaged: { executablePath: string; revision: string } | null = null;

    for (const candidate of candidates) {
      const executablePath = candidate.resolveExecutablePath();
      if (executablePath === null || executablePath.length === 0) {
        continue;
      }
      if (await isExecutableUsable(executablePath)) {
        return buildReadyProbe(candidate.source, executablePath);
      }

      // managed 修订目录存在、但可执行文件缺失/零字节 → 版本过期/安装残缺。
      // 不能让它遮蔽可用的系统 Chrome，所以先标记、继续探测后续候选。
      if (candidate.source === 'managed') {
        const managed = matchManagedRevision(executablePath);
        if (managed && (await directoryExists(managed.directory))) {
          staleManaged = { executablePath, revision: managed.revision };
        }
      }
    }

    if (staleManaged) {
      return buildUnavailableProbe('browser-outdated', {
        source: 'managed',
        executablePath: staleManaged.executablePath,
        expectedRevision: staleManaged.revision,
        installable: true,
      });
    }

    return buildUnavailableProbe('browser-missing', { installable: true });
  } catch (error) {
    return buildUnavailableProbe('probe-failed', {
      installable: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 负向结果缓存 TTL：足够短，刚安装完的浏览器下一次轮询就能被拾取。 */
export const NEGATIVE_PROBE_CACHE_TTL_MS = 5_000;

/** 进程级正向结果缓存（key 为 engine；当前只有 chromium）。 */
const positiveProbeCache = new Map<'chromium', BrowserLiveBrowserProbe>();

interface NegativeProbeCacheEntry {
  probe: BrowserLiveBrowserProbe;
  expiresAt: number;
}

/** 短期负向结果缓存：避免状态轮询反复打盘，同时不长期压住已安装的浏览器。 */
const negativeProbeCache = new Map<'chromium', NegativeProbeCacheEntry>();

/**
 * 探测实况浏览器是否真的可用（只做路径解析 + 磁盘校验，不启动浏览器）。
 *
 * 正向结果在进程生命周期内缓存；负向结果缓存 `NEGATIVE_PROBE_CACHE_TTL_MS`。
 */
export async function probeLiveBrowserAvailability(
  engine: 'chromium' = 'chromium',
  options: ProbeLiveBrowserAvailabilityOptions = {},
): Promise<BrowserLiveBrowserProbe> {
  const cachedPositive = positiveProbeCache.get(engine);
  if (cachedPositive !== undefined) {
    return cachedPositive;
  }

  const cachedNegative = negativeProbeCache.get(engine);
  if (cachedNegative !== undefined) {
    if (cachedNegative.expiresAt > Date.now()) {
      return cachedNegative.probe;
    }
    negativeProbeCache.delete(engine);
  }

  const probe = await runProbe(options);
  if (probe.available) {
    positiveProbeCache.set(engine, probe);
    negativeProbeCache.delete(engine);
  } else {
    negativeProbeCache.set(engine, {
      probe,
      expiresAt: Date.now() + NEGATIVE_PROBE_CACHE_TTL_MS,
    });
  }
  return probe;
}

/** 清空正向与负向缓存（测试用；注入候选后需要隔离上一次探测的缓存）。 */
export function resetLiveBrowserAvailabilityCache(): void {
  positiveProbeCache.clear();
  negativeProbeCache.clear();
}
