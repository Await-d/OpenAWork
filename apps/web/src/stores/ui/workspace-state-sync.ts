/**
 * 工作台现场（打开记录 + 面板布局）的跨设备同步。
 *
 * 背景：本地 `localStorage` 只在「同一台机器 + 同一个存储目录」里可靠。换设备、清缓存、
 * 桌面端 WebView 数据目录变化都会让「上次打开的预览页面 / 文件 / 面板布局」消失。
 * 这里把整份现场推到网关 `user_settings`（`/settings/workspace-state`），启动时再拉回来。
 *
 * 同步范围：
 * - UI store 的持久化载荷（预览地址、编辑器打开的文件、面板开关 / 宽度、标题栏标签…）；
 * - 内置浏览器书签；
 * - **按工作区**的浏览器标签与历史（服务端不再只有一份全局记录）。
 *
 * 冲突策略（刻意简单、可预期）：
 * 1. 启动时 GET；服务端有快照且本会话没有未推成功的改动 → 以服务端为准回灌
 *    （换设备 / 清缓存后「接着上次继续」正是这条路径）；
 * 2. 服务端无记录 / 上次推送失败 / 本会话有未推改动 → 以本地为准推上去；
 * 3. 之后任何本地改动都进入 800ms 去抖推送，内容未变则不发请求。
 *
 * 副作用收敛：回灌期间置 `applyingRemote`，让 store 订阅与浏览器现场事件都不再触发
 * 推送（否则刚拉下来的状态会被立刻原样推回去，甚至形成循环）。
 */
import { useEffect } from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import type { SettingsWorkspaceStatePayload } from '@openAwork/web-client';

import { useAuthStore } from '../auth/auth.js';
import {
  BROWSER_STATE_CHANGED_EVENT,
  STORAGE_KEY_PREFIX,
  loadBookmarks,
  loadPersistedState,
  persistState,
  saveBookmarks,
  type BrowserTab,
} from '../../components/chat/misc/browser/browser-storage.js';
import {
  applyPersistedUiStateSnapshot,
  readPersistedUiStateSnapshot,
  useUIStateStore,
} from './uiState.js';

/** 同步元信息：记在本地，用于「上次推送失败 → 下次本地优先自愈」。 */
const SYNC_META_KEY = 'openAwork-workspace-state-sync';
/** 推送去抖：连续拖拽面板 / 连开标签时合并成一次 PUT。 */
export const WORKSPACE_STATE_PUSH_DEBOUNCE_MS = 800;
/** 快照结构版本（服务端只透传，客户端用于兼容）。 */
const SNAPSHOT_VERSION = 1;
/** 与服务端 `WORKSPACE_STATE_MAX_WORKSPACES` 对齐。 */
const MAX_WORKSPACES = 50;

interface SyncScope {
  gatewayUrl: string;
  email: string;
}

interface SyncMeta {
  ownerEmail?: string;
  pendingPush?: boolean;
}

let currentScope: SyncScope | null = null;
let accessToken: string | null = null;
let remoteReady = false;
let applyingRemote = false;
/**
 * 本会话内存在尚未成功推送的本地改动。
 *
 * 不能只看「GET 在途期间有没有变化」：token 刷新会重跑 bootstrap，此刻本地改动
 * 已经发生在捕获点之前，若直接回灌远端就会把用户刚做的操作回滚掉。
 */
let localDirty = false;
let lastPushed = '';
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushSeq = 0;
/**
 * 推送串行队列。
 *
 * 去抖计时器、pagehide 补推、bootstrap 决策三条路径都可能在同一时刻发起 PUT；
 * 并发时后发的旧载荷可能覆盖先发的新载荷（服务端只做整体替换）。串行化后
 * 「最后写入」一定是最新内容。
 */
let pushQueue: Promise<void> = Promise.resolve();
/**
 * scope 代次：登出 / 切换账号时自增。
 *
 * 队列里可能还压着上一个账号的推送；等它执行时 `currentScope` 已经指向新账号，
 * 若不校验代次，就会把旧账号的本地现场写到新账号的服务端记录上。
 */
let scopeGeneration = 0;

function readMeta(): SyncMeta {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SYNC_META_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record['ownerEmail'] === 'string' ? { ownerEmail: record['ownerEmail'] } : {}),
      ...(typeof record['pendingPush'] === 'boolean' ? { pendingPush: record['pendingPush'] } : {}),
    };
  } catch {
    return {};
  }
}

function writeMeta(meta: SyncMeta): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // 元信息写不进去只影响自愈策略，不阻塞同步本身。
  }
}

/**
 * 收集所有工作区的浏览器现场。
 *
 * 标签页没有独立 store，唯一真相是 localStorage；同步模块直接按统一前缀枚举，
 * 避免再为「当前打开了哪些工作区」维护一份会漂移的索引。
 */
export function collectBrowserTabsByWorkspace(): SettingsWorkspaceStatePayload['browserTabsByWorkspace'] {
  const result: SettingsWorkspaceStatePayload['browserTabsByWorkspace'] = {};
  if (typeof window === 'undefined') return result;
  const prefix = `${STORAGE_KEY_PREFIX}:`;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key === null || !key.startsWith(prefix)) continue;
      const scope = key.slice(prefix.length);
      const persisted = loadPersistedState(scope);
      if (persisted === null) continue;
      result[scope] = { tabs: persisted.tabs, activeTabId: persisted.activeTabId };
      if (Object.keys(result).length >= MAX_WORKSPACES) break;
    }
  } catch {
    return result;
  }
  return result;
}

/** 把服务端的工作区现场写回本地快照（只写服务端给出的工作区，不删本地多出来的）。 */
function applyBrowserTabsByWorkspace(
  workspaces: SettingsWorkspaceStatePayload['browserTabsByWorkspace'],
): void {
  for (const [scope, snapshot] of Object.entries(workspaces)) {
    persistState(scope, snapshot.tabs as BrowserTab[], snapshot.activeTabId);
  }
}

function buildSnapshot(): SettingsWorkspaceStatePayload {
  const { state, version } = readPersistedUiStateSnapshot();
  return {
    version: SNAPSHOT_VERSION,
    uiStateVersion: version,
    uiState: state,
    bookmarks: loadBookmarks(),
    browserTabsByWorkspace: collectBrowserTabsByWorkspace(),
  };
}

async function applySnapshot(payload: SettingsWorkspaceStatePayload): Promise<void> {
  applyingRemote = true;
  try {
    saveBookmarks(payload.bookmarks);
    applyBrowserTabsByWorkspace(payload.browserTabsByWorkspace);
    await applyPersistedUiStateSnapshot(payload.uiState, payload.uiStateVersion);
  } finally {
    applyingRemote = false;
  }
}

function resetModuleState(): void {
  if (pushTimer !== null) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  remoteReady = false;
  applyingRemote = false;
  localDirty = false;
  lastPushed = '';
  pushSeq = 0;
  accessToken = null;
  // 让队列里尚未执行的推送失效（它们属于上一个 scope，执行时不能读新账号的状态）。
  scopeGeneration += 1;
}

function schedulePush(): void {
  if (applyingRemote) return;
  if (currentScope === null) return;
  // 首次 GET 完成前的改动可能只是应用启动自身写入的状态，是否算「用户意图」交给
  // bootstrap 的内容对比判定；只有决策完成后的改动才无条件标记 dirty。
  if (remoteReady) localDirty = true;
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void enqueuePush();
  }, WORKSPACE_STATE_PUSH_DEBOUNCE_MS);
}

/** 把一次推送排进串行队列（无论前一次成功还是失败都继续下一次）。 */
function enqueuePush(): Promise<void> {
  const generation = scopeGeneration;
  const next = pushQueue.then(
    () => pushNow(generation),
    () => pushNow(generation),
  );
  pushQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function pushNow(generation: number): Promise<void> {
  // 排队期间发生了登出 / 换账号：这次推送属于旧 scope，直接丢弃。
  if (generation !== scopeGeneration) return;
  const scope = currentScope;
  const token = accessToken;
  if (!remoteReady || scope === null || token === null) return;

  const payload = buildSnapshot();
  // 动作函数已被 `readPersistedUiStateSnapshot` 剔除；这里比较的是真正会落库的内容。
  const serialized = JSON.stringify(payload);
  if (serialized === lastPushed) {
    // 内容与上次成功推送一致：此前因「非持久化字段变化」而置脏的标记可以清掉了，
    // 否则下次 token 刷新会把这条无意义的 dirty 当成「本地有未推改动」而拒绝回灌。
    localDirty = false;
    writeMeta({ ownerEmail: scope.email, pendingPush: false });
    return;
  }

  const requestSeq = pushSeq + 1;
  pushSeq = requestSeq;
  try {
    await createSettingsClient(scope.gatewayUrl).putWorkspaceState(token, payload);
    if (requestSeq !== pushSeq || currentScope !== scope) return;
    lastPushed = serialized;
    // 推送在途期间又改过本地：内容已经不同，dirty 要保留到下一次推送成功。
    if (JSON.stringify(buildSnapshot()) === serialized) {
      localDirty = false;
    }
    writeMeta({ ownerEmail: scope.email, pendingPush: false });
  } catch (error) {
    if (requestSeq !== pushSeq || currentScope !== scope) return;
    // 失败后保持 dirty：下次 token 刷新 / 重新 bootstrap 时以本地为准自愈，
    // 不再拿远端旧值覆盖这次没推上去的改动。
    localDirty = true;
    writeMeta({ ownerEmail: scope.email, pendingPush: true });
    console.warn('[workspace-state-sync] 工作台状态推送失败，将在下次变更或启动时重试:', error);
  }
}

function flushPendingPush(): void {
  if (pushTimer !== null) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  void enqueuePush();
}

async function bootstrapRemoteSync(
  ctx: SyncScope & {
    accessToken: string;
    signal: AbortSignal;
  },
): Promise<void> {
  const scopeChanged =
    currentScope === null ||
    currentScope.gatewayUrl !== ctx.gatewayUrl ||
    currentScope.email !== ctx.email;
  if (scopeChanged) {
    resetModuleState();
    currentScope = { gatewayUrl: ctx.gatewayUrl, email: ctx.email };
  }
  accessToken = ctx.accessToken;

  const meta = readMeta();
  const ownerMismatch = meta.ownerEmail !== undefined && meta.ownerEmail !== ctx.email;

  // 上次推送失败：跳过 GET，以本地为准直接推（对齐显示偏好的本地优先自愈语义）。
  if (meta.pendingPush === true && meta.ownerEmail === ctx.email) {
    remoteReady = true;
    await enqueuePush();
    return;
  }

  try {
    const result = await createSettingsClient(ctx.gatewayUrl).getWorkspaceState(ctx.accessToken, {
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) return;
    remoteReady = true;

    if (result.state !== null) {
      // 本会话已有未推成功的本地改动（token 刷新重跑 bootstrap 时会走到这里）：
      // 以本地为准推上去，不用远端把用户刚做的操作回滚掉。
      if (localDirty) {
        await enqueuePush();
        return;
      }
      // 内容已经一致（常见于 token 刷新重跑 bootstrap）：不必整棵 UI 重新水合。
      if (JSON.stringify(result.state) === JSON.stringify(buildSnapshot())) {
        lastPushed = JSON.stringify(result.state);
        writeMeta({ ownerEmail: ctx.email, pendingPush: false });
        return;
      }
      await applySnapshot(result.state);
      // 刚回灌的内容不回推：否则每次启动都会白打一次 PUT。
      lastPushed = JSON.stringify(buildSnapshot());
      writeMeta({ ownerEmail: ctx.email, pendingPush: false });
      return;
    }

    // 服务端无记录：首次迁移，把本机现场作为种子推上去。
    // 账号刚切换时本机可能是上一个账号的现场，不能推给新账号。
    if (ownerMismatch) {
      writeMeta({ ownerEmail: ctx.email, pendingPush: false });
      return;
    }
    await enqueuePush();
  } catch (error) {
    if (ctx.signal.aborted) return;
    // 拉取失败时同步方向未知：不覆盖远端，标记待推送，下次启动本地优先自愈。
    writeMeta({ ownerEmail: ctx.email, pendingPush: true });
    console.warn('[workspace-state-sync] 读取工作台状态失败，本次以本地为准:', error);
  }
}

/**
 * 挂到 App 顶层（与显示偏好同步同一时机：认证与桌面网关都就绪后）。
 */
export function useWorkspaceStateSyncBootstrap(enabled: boolean): void {
  const token = useAuthStore((state) => state.accessToken);
  const email = useAuthStore((state) => state.email);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);

  useEffect(() => {
    if (!enabled) return;
    if (!token || !email || !gatewayUrl) {
      resetModuleState();
      currentScope = null;
      return;
    }
    const controller = new AbortController();
    void bootstrapRemoteSync({ accessToken: token, email, gatewayUrl, signal: controller.signal });
    return () => controller.abort();
  }, [enabled, token, email, gatewayUrl]);
}

// ── 订阅：任何本地现场变化都进入去抖推送 ────────────────────────────

useUIStateStore.subscribe(() => {
  schedulePush();
});

if (typeof window !== 'undefined') {
  window.addEventListener(BROWSER_STATE_CHANGED_EVENT, () => {
    schedulePush();
  });
  window.addEventListener('pagehide', flushPendingPush);
  window.addEventListener('beforeunload', flushPendingPush);
}
