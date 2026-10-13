import { useEffect } from 'react';
import { create } from 'zustand';
import type { DialogueMode } from '@openAwork/shared';
import { isFileIconThemeId } from '@openAwork/shared-ui';
import { createSettingsClient } from '@openAwork/web-client';
import { useAuthStore } from '../auth/auth.js';
import { useUIStateStore, type WorkbenchLayoutMode } from '../ui/uiState.js';
import {
  BOOLEAN_DISPLAY_PREFERENCE_KEYS,
  pickDisplayPreferenceValues,
  TOOL_EXPAND_CATEGORY_LABELS,
  useDisplayPreferencesStore,
  type MessageLayoutMode,
  type ToolExpandCategory,
  type ToolExpandOverrides,
} from './display-preferences.js';
import { isValidMode, isValidStyle } from './theme-storage.js';

/**
 * 显示偏好的远端同步（网关 `user_display_preferences_v1`）。
 *
 * 设计（与 `use-buddy-voice-preferences` / `current-user-profile` 同一套语义）：
 * - localStorage 仍是本地即时缓存；远端是权威，负责跨设备 / 换 origin 恢复；
 * - 变更 → 500ms 防抖 + 串行队列 + 序号守卫，全量 PUT；
 * - 启动：有 `pendingPush` 标记 → 本地优先推上去；否则 GET——有记录以服务端为准，
 *   无记录把本机设置作为种子推上去；GET 失败保留本地并提示，下次启动重试；
 * - 失败自愈：PUT 失败写 `pendingPush`，下次编辑或下次启动用全量 PUT 覆盖；
 * - 冲突（多端 / 多标签页）last-write-wins。
 *
 * 同步方向由「订阅」触发而不是改 store 的 setter：订阅同时覆盖 `setState` 旁路，
 * 也避免 `display-preferences.ts` 反向 import 本模块形成循环依赖。
 */

const SYNC_META_STORAGE_KEY = 'openAwork-display-preferences-sync';
const REMOTE_SAVE_DEBOUNCE_MS = 500;

const MESSAGE_LAYOUT_MODES = ['unified', 'split'] as const satisfies readonly MessageLayoutMode[];
const DIALOGUE_MODES = [
  'clarify',
  'coding',
  'programmer',
] as const satisfies readonly DialogueMode[];
const WORKBENCH_LAYOUT_MODES = [
  'classic',
  'fusion',
] as const satisfies readonly WorkbenchLayoutMode[];

const TOOL_EXPAND_CATEGORIES = Object.keys(TOOL_EXPAND_CATEGORY_LABELS) as ToolExpandCategory[];

export type DisplayPreferencesSyncStatus = 'local' | 'loading' | 'synced' | 'error';

interface DisplayPreferencesSyncState {
  status: DisplayPreferencesSyncStatus;
  errorMessage: string | null;
  lastSyncedAt: string | null;
  retry: () => void;
}

export const useDisplayPreferencesSyncStore = create<DisplayPreferencesSyncState>()(() => ({
  status: 'local',
  errorMessage: null,
  lastSyncedAt: null,
  retry: () => {
    void bootstrapRemoteSyncFromAuth().catch((error: unknown) => {
      console.warn('[display-sync] 重试同步失败', error);
    });
  },
}));

interface DisplayPreferencesSyncMeta {
  ownerEmail?: string;
  pendingPush?: boolean;
  lastSyncedAt?: string;
}

interface BootstrapContext {
  accessToken: string;
  email: string;
  gatewayUrl: string;
  signal?: AbortSignal;
}

interface SyncScope {
  gatewayUrl: string;
  email: string;
}

/** 模块级同步状态（组件生命周期之外，随 scope 重置）。 */
let currentScope: SyncScope | null = null;
/** 已与远端对齐的载荷快照；null = 未知（任何推送都会照发）。 */
let lastKnownRemoteSnapshot: string | null = null;
/** 本次 scope 的同步方向是否已确定（GET 成功 / pendingPush 直推 / 种子 / 重置）。 */
let remoteSyncReady = false;
/** 用户本地是否有未推送的改动。 */
let localDirty = false;
/** 正在应用远端值期间为 true，抑制订阅触发的回推。 */
let isApplyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueue: Promise<void> = Promise.resolve();
let saveSeq = 0;

function readSyncMeta(): DisplayPreferencesSyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const meta: DisplayPreferencesSyncMeta = {};
    if (typeof record['ownerEmail'] === 'string') meta.ownerEmail = record['ownerEmail'];
    if (typeof record['pendingPush'] === 'boolean') meta.pendingPush = record['pendingPush'];
    if (typeof record['lastSyncedAt'] === 'string') meta.lastSyncedAt = record['lastSyncedAt'];
    return meta;
  } catch {
    return {};
  }
}

function writeSyncMeta(patch: DisplayPreferencesSyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify({ ...readSyncMeta(), ...patch }));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级：同步能力失效但不影响本地使用。
  }
}

function setSyncStatus(
  status: DisplayPreferencesSyncStatus,
  errorMessage: string | null = null,
  lastSyncedAt?: string,
): void {
  useDisplayPreferencesSyncStore.setState((state) => ({
    status,
    errorMessage,
    lastSyncedAt: lastSyncedAt ?? state.lastSyncedAt,
  }));
}

function buildCurrentPayload(): Record<string, unknown> {
  return {
    ...pickDisplayPreferenceValues(useDisplayPreferencesStore.getState()),
    workbenchLayoutMode: useUIStateStore.getState().workbenchLayoutMode,
  };
}

function serializeCurrentPayload(): string {
  return JSON.stringify(buildCurrentPayload());
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function sanitizeToolExpandOverrides(value: unknown): ToolExpandOverrides | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const overrides = {} as ToolExpandOverrides;
  for (const category of TOOL_EXPAND_CATEGORIES) {
    const entry = record[category];
    if (typeof entry !== 'boolean') {
      return null;
    }
    overrides[category] = entry;
  }
  return overrides;
}

/**
 * 逐个字段校验并应用远端值：未知 / 非法字段一律忽略（保留本机值），
 * 保证前后端版本错位时不损坏本机状态。主题两项必须走 setter，
 * 以同步写 `theme-style` / `theme-mode` 镜像 key。
 */
function applyRemoteValues(raw: Record<string, unknown>): void {
  isApplyingRemote = true;
  try {
    const store = useDisplayPreferencesStore.getState();

    const booleanUpdates: Partial<ReturnType<typeof pickDisplayPreferenceValues>> = {};
    for (const key of BOOLEAN_DISPLAY_PREFERENCE_KEYS) {
      const value = raw[key];
      if (typeof value === 'boolean') {
        booleanUpdates[key] = value;
      }
    }
    if (Object.keys(booleanUpdates).length > 0) {
      useDisplayPreferencesStore.setState(booleanUpdates);
    }

    if (isOneOf(raw['messageLayout'], MESSAGE_LAYOUT_MODES)) {
      store.setMessageLayout(raw['messageLayout']);
    }
    const overrides = sanitizeToolExpandOverrides(raw['toolExpandedOverrides']);
    if (overrides) {
      for (const category of TOOL_EXPAND_CATEGORIES) {
        store.setToolExpandedOverride(category, overrides[category]);
      }
    }
    if (isOneOf(raw['defaultDialogueMode'], DIALOGUE_MODES)) {
      store.setDefaultDialogueMode(raw['defaultDialogueMode']);
    }
    if (isValidMode(raw['themeMode'])) {
      store.setThemeMode(raw['themeMode']);
    }
    if (isValidStyle(raw['themeStyle'])) {
      store.setThemeStyle(raw['themeStyle']);
    }
    if (isFileIconThemeId(raw['fileIconTheme'])) {
      store.setFileIconTheme(raw['fileIconTheme']);
    }
    if (isOneOf(raw['workbenchLayoutMode'], WORKBENCH_LAYOUT_MODES)) {
      useUIStateStore.getState().setWorkbenchLayoutMode(raw['workbenchLayoutMode']);
    }
  } finally {
    isApplyingRemote = false;
  }
}

/**
 * 换账号重置：把显示偏好恢复为出厂默认。
 * `resetToDefaults` 里的 theme 两项是从 localStorage 动态读取的（首屏防闪设计），
 * 换账号场景必须显式覆盖为硬编码默认值；工作台布局默认 `fusion`。
 */
function applyFactoryDefaults(): void {
  isApplyingRemote = true;
  try {
    const store = useDisplayPreferencesStore.getState();
    store.resetToDefaults();
    store.setThemeMode('system');
    store.setThemeStyle('carbon');
    useUIStateStore.getState().setWorkbenchLayoutMode('fusion');
  } finally {
    isApplyingRemote = false;
  }
}

function resetModuleState(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  saveSeq += 1; // 作废在途推送的结果
  remoteSyncReady = false;
  localDirty = false;
  lastKnownRemoteSnapshot = null;
  isApplyingRemote = false;
}

function schedulePush(): void {
  if (isApplyingRemote) {
    return;
  }
  localDirty = true;
  if (pushTimer) {
    clearTimeout(pushTimer);
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void flushPush().catch((error: unknown) => {
      console.warn('[display-sync] 推送显示偏好失败', error);
    });
  }, REMOTE_SAVE_DEBOUNCE_MS);
}

/**
 * 全量推送当前偏好。串行队列 + 序号守卫保证乱序响应不会回写过期状态；
 * 同步方向未确定（`remoteSyncReady`）前不发请求，避免和启动 GET 竞态。
 */
async function flushPush(): Promise<void> {
  const authState = useAuthStore.getState();
  const accessToken = authState.accessToken;
  const email = authState.email;
  const gatewayUrl = authState.gatewayUrl;
  if (!accessToken || !email || !gatewayUrl) {
    setSyncStatus('local');
    return;
  }
  if (!remoteSyncReady) {
    return;
  }

  const payload = buildCurrentPayload();
  const serializedPayload = JSON.stringify(payload);
  if (serializedPayload === lastKnownRemoteSnapshot) {
    localDirty = false;
    // 载荷已与已知远端一致：之前失败的推送已无待办，清掉标记，
    // 避免下次启动盲目跳过 GET 用旧值覆盖服务端的更新。
    writeSyncMeta({ ownerEmail: email, pendingPush: false });
    setSyncStatus('synced');
    return;
  }

  const requestSeq = saveSeq + 1;
  saveSeq = requestSeq;

  const queuedSave = saveQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const result = await createSettingsClient(gatewayUrl).putDisplayPreferences(
          accessToken,
          payload,
        );
        if (requestSeq !== saveSeq) {
          return;
        }
        lastKnownRemoteSnapshot = serializedPayload;
        localDirty = false;
        const syncedAt = result.updatedAt ?? new Date().toISOString();
        writeSyncMeta({ ownerEmail: email, pendingPush: false, lastSyncedAt: syncedAt });
        setSyncStatus('synced', null, syncedAt);
      } catch (error) {
        if (requestSeq !== saveSeq) {
          return;
        }
        localDirty = true;
        writeSyncMeta({ ownerEmail: email, pendingPush: true });
        setSyncStatus('error', error instanceof Error ? error.message : '同步显示偏好失败。');
      }
    });
  saveQueue = queuedSave.then(
    () => undefined,
    () => undefined,
  );
  await queuedSave;
}

function isCurrentScope(ctx: BootstrapContext): boolean {
  return currentScope?.gatewayUrl === ctx.gatewayUrl && currentScope.email === ctx.email;
}

async function bootstrapRemoteSync(ctx: BootstrapContext): Promise<void> {
  const scopeChanged =
    currentScope === null ||
    currentScope.gatewayUrl !== ctx.gatewayUrl ||
    currentScope.email !== ctx.email;
  if (scopeChanged) {
    resetModuleState();
    currentScope = { gatewayUrl: ctx.gatewayUrl, email: ctx.email };
  }

  const meta = readSyncMeta();
  const ownerMismatch = meta.ownerEmail !== undefined && meta.ownerEmail !== ctx.email;

  // 上次推送失败留下的本地改动：跳过 GET，以本地为准直接推上去（本地优先自愈）。
  if (meta.pendingPush === true && meta.ownerEmail === ctx.email) {
    remoteSyncReady = true;
    localDirty = true;
    await flushPush();
    return;
  }

  setSyncStatus('loading');
  try {
    const seqBeforeGet = saveSeq;
    const result = await createSettingsClient(ctx.gatewayUrl).getDisplayPreferences(
      ctx.accessToken,
      ctx.signal ? { signal: ctx.signal } : {},
    );
    if (ctx.signal?.aborted || !isCurrentScope(ctx)) {
      return;
    }
    // GET 在途期间已有推送落地（如 token 刷新触发的重跑 + 用户此刻的修改）：
    // 响应对应的可能是推送前的旧数据，必须按「本地优先」处理，防止回滚用户改动。
    const hadPushDuringGet = saveSeq !== seqBeforeGet;

    const remotePreferences = result.preferences;
    if (remotePreferences && Object.keys(remotePreferences).length > 0) {
      remoteSyncReady = true;
      // 账号归属必须先于「本地优先」分支清理：若后置，GET 在途期间的编辑会把旧账号
      // 残留的本地值整包推到当前账号的服务端记录，造成跨账号污染。
      if (ownerMismatch) {
        // 本机残留的是另一个账号的值：先回落出厂默认，再叠加远端已有字段，
        // 避免旧账号的字段被当成新账号的设置继续同步。
        applyFactoryDefaults();
        // reset 已抹掉本地值（含 GET 在途期间的编辑），本地不再有可信的用户意图：
        // 清掉 dirty 标记，让流程落到 applyRemoteValues，避免把纯出厂默认值
        // 整包推上去覆盖远端已有偏好。
        localDirty = false;
      }
      if (localDirty || hadPushDuringGet) {
        // 用户在 GET 返回前改过本地：保留本地并推上去自愈（对齐 buddy 的 hasLocalOverride）。
        await flushPush();
        return;
      }
      applyRemoteValues(remotePreferences);
      lastKnownRemoteSnapshot = serializeCurrentPayload();
      const syncedAt = result.updatedAt ?? new Date().toISOString();
      writeSyncMeta({ ownerEmail: ctx.email, pendingPush: false, lastSyncedAt: syncedAt });
      setSyncStatus('synced', null, syncedAt);
      return;
    }

    // 服务端无记录。
    remoteSyncReady = true;
    if (ownerMismatch) {
      // 本机 localStorage 属于另一个账号：重置为工厂默认，且不作为本账号的种子。
      applyFactoryDefaults();
      lastKnownRemoteSnapshot = serializeCurrentPayload();
      localDirty = false;
      writeSyncMeta({ ownerEmail: ctx.email, pendingPush: false });
      setSyncStatus('synced');
      return;
    }

    // 首次迁移：把本机现有设置作为种子推给服务端。
    localDirty = true;
    await flushPush();
  } catch (error) {
    if (ctx.signal?.aborted || !isCurrentScope(ctx)) {
      return;
    }
    // GET 失败时同步方向未知：标记 pendingPush，下次启动跳过 GET 以本地为准推送，
    // 与 flushPush 失败路径同一「本地优先」自愈语义。无条件标记——失败之后的本地
    // 编辑不会再触发成功同步，若只在 localDirty 时标记，离线编辑会在下次成功 GET
    // 后被远端值静默覆盖；代价是无本地编辑时多一次幂等 PUT（内容与远端一致）。
    writeSyncMeta({ ownerEmail: ctx.email, pendingPush: true });
    setSyncStatus('error', error instanceof Error ? error.message : '读取云端显示偏好失败。');
  }
}

async function bootstrapRemoteSyncFromAuth(): Promise<void> {
  const { accessToken, email, gatewayUrl } = useAuthStore.getState();
  if (!accessToken || !email || !gatewayUrl) {
    setSyncStatus('local');
    return;
  }
  await bootstrapRemoteSync({ accessToken, email, gatewayUrl });
}

/**
 * 挂到各端 App 顶层（Web：`authHydrated && desktopGatewayReady`；桌面端：`Boolean(accessToken)`）。
 * 认证就绪后触发一次远端方向决策；未登录时回到「仅本地」状态。
 */
export function useDisplayPreferencesSyncBootstrap(enabled: boolean): void {
  const accessToken = useAuthStore((state) => state.accessToken);
  const email = useAuthStore((state) => state.email);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (!accessToken || !email || !gatewayUrl) {
      resetModuleState();
      currentScope = null;
      setSyncStatus('local');
      return;
    }

    const controller = new AbortController();
    void bootstrapRemoteSync({ accessToken, email, gatewayUrl, signal: controller.signal });
    return () => controller.abort();
  }, [accessToken, email, enabled, gatewayUrl]);
}

// ── 订阅：任何本地偏好变化都进入防抖推送（含 setState 旁路）──────────

useDisplayPreferencesStore.subscribe((state, prevState) => {
  if (isApplyingRemote) {
    return;
  }
  if (
    JSON.stringify(pickDisplayPreferenceValues(state)) ===
    JSON.stringify(pickDisplayPreferenceValues(prevState))
  ) {
    return;
  }
  schedulePush();
});

useUIStateStore.subscribe((state, prevState) => {
  if (isApplyingRemote) {
    return;
  }
  if (state.workbenchLayoutMode !== prevState.workbenchLayoutMode) {
    schedulePush();
  }
});
