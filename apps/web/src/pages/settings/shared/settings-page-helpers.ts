import type {
  ActiveSelectionRef,
  AIProviderRef,
  ImageGenerationDefaultsRef,
} from '@openAwork/shared-ui';
import { getProviderUiList } from '@openAwork/shared-ui';
import { DEFAULT_IMAGE_GENERATION_SIZE, normalizeImageGenerationSize } from '@openAwork/shared';
import type {
  ReasoningEffortRef,
  ThinkingDefaultsRef,
  ThinkingModeRef,
} from '../state/settings-types.js';

export const TABS = [
  { id: 'connection', label: '连接与模型' },
  { id: 'display', label: '显示设置' },
  { id: 'desktop', label: '桌面端' },
  { id: 'channels', label: '消息频道' },
  { id: 'companion', label: 'Buddy 伴侣' },
  { id: 'memory', label: '记忆管理' },
  { id: 'templates', label: '模板配置' },
  { id: 'agents', label: '智能体' },
  { id: 'skills', label: '技能库' },
  { id: 'workflows', label: '工作流' },
  { id: 'schedules', label: '定时任务' },
  { id: 'artifacts', label: '产物中心' },
  { id: 'images', label: '图片' },
  { id: 'sessions', label: '会话列表' },
  { id: 'usage', label: '用量与账单' },
  { id: 'security', label: '安全与权限' },
  { id: 'workspace', label: '工作区' },
  { id: 'resources', label: '资源中心' },
  { id: 'plugins', label: '插件' },
  { id: 'devtools', label: '开发者工具' },
  { id: 'about', label: '关于' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

/**
 * 仅在 Tauri 桌面端运行时可见的 tab 列表。Web/移动端不渲染。
 * 由 SettingsPage 在 nav 与路由切换处共同过滤。
 */
export const TAURI_ONLY_TAB_IDS: ReadonlySet<TabId> = new Set(['desktop']);

export const TAB_CATEGORIES: ReadonlyArray<{
  id: string;
  label: string;
  tabIds: readonly TabId[];
}> = [
  { id: 'general', label: '常规', tabIds: ['connection', 'display', 'desktop'] },
  {
    id: 'assistant',
    label: '助理',
    tabIds: ['companion', 'memory', 'templates', 'agents', 'channels'],
  },
  {
    id: 'automation',
    label: '自动化',
    tabIds: ['workflows', 'schedules', 'skills'],
  },
  { id: 'account', label: '账户', tabIds: ['usage', 'security'] },
  {
    id: 'extensions',
    label: '扩展与集成',
    tabIds: ['resources', 'plugins'],
  },
  {
    id: 'tools',
    label: '工具',
    tabIds: ['workspace', 'artifacts', 'images', 'sessions', 'devtools'],
  },
  { id: 'about', label: '关于', tabIds: ['about'] },
];

export const SETTINGS_TAB_NAV_WIDTH = 192;
export const SETTINGS_TAB_CONTENT_GAP = 28;
// 左侧 nav + gap 宽度，用于把内容列盒子相对于「非装饰 gutter」部分的外边距。
// 旧实现在 grid 里额外保留了一条等宽的右侧装饰列（SIDE_GUTTER），用来在宽屏
// 下让内容视觉居中；但在 ≤1100px 的窄屏下这条列会白白占掉 220px，使内容
// 列被挤窄一半，右侧一大片空白。现在改为只用 `margin: 0 auto` 对 nav+content
// 整体居中，丢掉额外右列，窄屏下把所有可用宽度都让给内容。
export const SETTINGS_LAYOUT_SIDE_GUTTER = SETTINGS_TAB_NAV_WIDTH + SETTINGS_TAB_CONTENT_GAP;
export const SETTINGS_LAYOUT_MAX_WIDTH = `calc(var(--content-max-width) + ${SETTINGS_LAYOUT_SIDE_GUTTER}px)`;

export function isEmbeddedRouteTab(tab: TabId): boolean {
  switch (tab) {
    case 'templates':
    case 'agents':
    case 'skills':
    case 'workflows':
    case 'schedules':
    case 'artifacts':
    case 'images':
    case 'sessions':
    case 'resources':
      return true;
    case 'connection':
    case 'display':
    case 'desktop':
    case 'channels':
    case 'companion':
    case 'memory':
    case 'usage':
    case 'security':
    case 'workspace':
    case 'plugins':
    case 'devtools':
    case 'about':
      return false;
  }
}

export const DEFAULT_THINKING_DEFAULTS: ThinkingDefaultsRef = {
  chat: { enabled: false, effort: 'medium' },
  fast: { enabled: false, effort: 'medium' },
};

export const DEFAULT_IMAGE_GENERATION_DEFAULTS: ImageGenerationDefaultsRef = {
  size: DEFAULT_IMAGE_GENERATION_SIZE,
  quality: 'medium',
  outputFormat: 'png',
  background: 'auto',
};

// 由 catalog 派生内置平台类型集合 + 'custom'，新增平台自动包含，无需改这里。
export const BUILTIN_PROVIDER_TYPE_SET = new Set<string>([
  ...getProviderUiList().map((entry) => entry.type),
  'custom',
]);

export function normalizeReasoningEffort(value: unknown): ReasoningEffortRef {
  return value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : 'medium';
}

export function normalizeThinkingMode(value: unknown): ThinkingModeRef {
  if (!value || typeof value !== 'object') {
    return { enabled: false, effort: 'medium' };
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: record['enabled'] === true,
    effort: normalizeReasoningEffort(record['effort']),
  };
}

export function normalizeThinkingDefaults(value: unknown): ThinkingDefaultsRef {
  if (!value || typeof value !== 'object') {
    return {
      chat: { ...DEFAULT_THINKING_DEFAULTS.chat },
      fast: { ...DEFAULT_THINKING_DEFAULTS.fast },
    };
  }

  const record = value as Record<string, unknown>;
  return {
    chat: normalizeThinkingMode(record['chat']),
    fast: normalizeThinkingMode(record['fast']),
  };
}

export function normalizeImageGenerationDefaults(value: unknown): ImageGenerationDefaultsRef {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_IMAGE_GENERATION_DEFAULTS };
  }

  const record = value as Record<string, unknown>;
  return {
    size: normalizeImageGenerationSize(record['size'], DEFAULT_IMAGE_GENERATION_DEFAULTS.size),
    quality:
      record['quality'] === 'low' || record['quality'] === 'high' ? record['quality'] : 'medium',
    outputFormat:
      record['outputFormat'] === 'jpeg' || record['outputFormat'] === 'webp'
        ? record['outputFormat']
        : 'png',
    background: record['background'] === 'opaque' ? 'opaque' : 'auto',
  };
}

export function parseStructuredPayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch (_error) {
    return value;
  }
}

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
    if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
      return payload.message;
    }
  } catch (_error) {
    return fallback;
  }

  return fallback;
}

export function normalizeActiveSelectionProviders(
  selection: ActiveSelectionRef,
  providers: AIProviderRef[],
): ActiveSelectionRef {
  const enabledProviders = providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      ...provider,
      defaultModels: provider.defaultModels.filter((model) => model.enabled),
    }))
    .filter((provider) => provider.defaultModels.length > 0);

  const normalizeEntry = (
    entry: ActiveSelectionRef['chat'],
    capability?: 'supportsImageGeneration',
  ): ActiveSelectionRef['chat'] => {
    const candidateProviders = enabledProviders
      .map((provider) => ({
        ...provider,
        defaultModels: provider.defaultModels.filter((model) =>
          capability ? model[capability] === true : true,
        ),
      }))
      .filter((provider) => provider.defaultModels.length > 0);
    const provider =
      candidateProviders.find((item) => item.id === entry.providerId) ?? candidateProviders[0];

    if (!provider) {
      return entry;
    }

    const model =
      provider.defaultModels.find((item) => item.id === entry.modelId) ?? provider.defaultModels[0];

    return {
      providerId: provider.id,
      modelId: model?.id ?? entry.modelId,
    };
  };

  return {
    ...selection,
    chat: normalizeEntry(selection.chat),
    fast: normalizeEntry(selection.fast),
    image: normalizeEntry(selection.image ?? selection.chat, 'supportsImageGeneration'),
    ...(selection.compaction ? { compaction: normalizeEntry(selection.compaction) } : {}),
  };
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const runtime = window as Window & {
    isTauri?: boolean;
    __TAURI__?: {
      core: { invoke: (name: string, value?: Record<string, unknown>) => Promise<T> };
    };
    __TAURI_INTERNALS__?: {
      invoke: (name: string, value?: Record<string, unknown>) => Promise<T>;
    };
  };

  if (runtime.__TAURI__) {
    return runtime.__TAURI__.core.invoke(cmd, args);
  }

  if (runtime.__TAURI_INTERNALS__) {
    return runtime.__TAURI_INTERNALS__.invoke(cmd, args);
  }

  if (runtime.isTauri) {
    throw new Error('Tauri IPC 尚未就绪。');
  }

  throw new Error('当前不在 Tauri 桌面环境中运行。');
}

export const isTauri =
  typeof window !== 'undefined' &&
  Boolean(
    (
      window as Window & {
        isTauri?: boolean;
        __TAURI__?: unknown;
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI__ ||
    (
      window as Window & {
        isTauri?: boolean;
        __TAURI__?: unknown;
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__ ||
    (
      window as Window & {
        isTauri?: boolean;
        __TAURI__?: unknown;
        __TAURI_INTERNALS__?: unknown;
      }
    ).isTauri,
  );

// ─── SSH 面板恢复 ───────────────────────────────────────────────────────────

/** `resolveSshDialogRestore` 需要的最小连接形状（避免耦合完整的 SSHConnectionEntry）。 */
export interface SshRestoreConnection {
  id: string;
  status: string;
}

/** `resolveSshDialogRestore` 需要的最小对话形状。 */
export interface SshRestoreDialog {
  connectionId: string;
  cwd: string;
}

export interface SshRestoreDecision {
  connectionId: string;
  /** 命中对话的 cwd；fallback 时为 '/'. */
  cwd: string;
  /** 仅当目标连接已 connected 时为 true——未就绪的连接只高亮、不拉文件。 */
  shouldLoadFiles: boolean;
}

/**
 * 纯函数：根据「最近 SSH 对话」列表与当前连接列表，算出重启后应恢复到哪个连接。
 *
 * `dialogs` 约定已按 `pinned DESC, lastOpenedAt DESC` 排好（与网关 `/ssh/dialogs`
 * 一致），因此这里直接取第一个「连接仍存在」的对话即可；连接已被删除的历史
 * 对话会被跳过，避免把面板恢复到一个不存在的连接上。
 *
 * 1. 命中对话：选该连接，`shouldLoadFiles` 取决于连接是否已 connected；
 * 2. 无可用对话：退化为第一个 connected 的连接（cwd 归 '/'）；
 * 3. 都没有：返回 null，面板保持空白。
 */
export function resolveSshDialogRestore(
  dialogs: readonly SshRestoreDialog[],
  connections: readonly SshRestoreConnection[],
): SshRestoreDecision | null {
  const findConnection = (id: string) => connections.find((connection) => connection.id === id);

  const dialog = dialogs.find((entry) => findConnection(entry.connectionId) !== undefined);
  if (dialog) {
    return {
      connectionId: dialog.connectionId,
      cwd: dialog.cwd || '/',
      shouldLoadFiles: findConnection(dialog.connectionId)?.status === 'connected',
    };
  }

  const firstConnected = connections.find((connection) => connection.status === 'connected');
  if (firstConnected) {
    return { connectionId: firstConnected.id, cwd: '/', shouldLoadFiles: true };
  }

  return null;
}
