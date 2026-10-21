import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import type { SessionTab } from '../../stores/ui/uiState.js';
import { readPersistedActiveStreamSessionId } from '../gateway/useGatewayClient.js';
import {
  createSessionsClient,
  withTokenRefresh,
  HttpError,
  SESSIONS_LIST_PAGE_LIMIT,
} from '@openAwork/web-client';
import type { TokenStore, SessionsClient, SessionsListOptions } from '@openAwork/web-client';
import { toast } from '../../components/common/feedback/ToastNotification.js';
import { exportSession } from '../../utils/session/session-transfer.js';
import {
  buildWorkspaceSessionCollections,
  filterSessionTreeGroupsByQuery,
  listWorkspaceIdentitiesFromSessions,
} from '../../utils/session/session-grouping.js';
import { resolveNewSessionWorkspace } from '../../utils/session/new-session-workspace.js';
import {
  subscribeSessionListRefresh,
  subscribeSessionRunState,
  type SessionRunState,
} from '../../utils/session/session-list-events.js';
import {
  getSessionDeleteErrorMessage,
  isSessionAlreadyDeletedError,
} from '../../utils/session/session-delete.js';
import { extractParentSessionId, hasTeamWorkspace } from '../../utils/session/session-metadata.js';
import { logger } from '../../utils/log/logger.js';

export interface Session {
  id: string;
  state_status?: 'idle' | 'running' | 'paused';
  title: string | null;
  updated_at: string;
  metadata_json?: string;
  /** 团队会话的父会话 ID（team_parent_session_id 列），chat 会话为 null/缺失 */
  team_parent_session_id?: string | null;
  /** 团队会话语义层级（reception/pm1/pm2/executor/reviewer），chat 会话为 null/缺失 */
  role_layer?: string | null;
}

function resolveDeletedSessionIds(
  result: { deletedSessionIds?: string[] } | void,
  fallbackSessionId: string,
): string[] {
  if (Array.isArray(result?.deletedSessionIds) && result.deletedSessionIds.length > 0) {
    return result.deletedSessionIds;
  }

  return [fallbackSessionId];
}

/**
 * 会话被删除后决定路由落点：优先跟随「关闭后应激活」的标签页，
 * 无可用标签页则回到首页——与顶部标签栏关闭标签的落点保持一致。
 */
function navigateToClosedSessionTarget(
  nextActiveTab: SessionTab | null,
  navigate: (path: string) => void,
): void {
  if (nextActiveTab?.type === 'session' && nextActiveTab.sessionId) {
    navigate(`/chat/${nextActiveTab.sessionId}`);
    return;
  }

  navigate('/chat');
}

const MISSING_PARENT_SESSION_CACHE_TTL_MS = 60_000;

/**
 * 会话列表加载遇到「瞬时传输失败」时的重试退避（ms），共 3 次、累计约 4.2s。
 *
 * 为什么需要：桌面端**每次页面加载**都会由原生侧执行 `start_gateway`
 * （`apps/web/src/App.tsx` 的 useDesktopGatewayBootstrap → Tauri start_gateway）。
 * 一旦该调用落在「本实例已持有的健康网关」上，原生侧会先请它优雅退出再重新 spawn，
 * 端口会关闭约 1-3s（sidecar 是 134MB 的 Bun 单文件二进制，冷启动不便宜）。
 * 而本页首帧就会发出 `/sessions`，正好撞进这个窗口 —— 收到 ECONNREFUSED，
 * Chromium / WebView2 抛 `TypeError: Failed to fetch`，经 web-client 归一成
 * 非 HttpError 的中文网络文案「网络异常，读取会话列表失败。」。
 *
 * 原生侧已修成幂等（`spawn_gateway_sidecar` 对「已持有 + 健康 + host 未变」的
 * sidecar 直接短路），这里的重试是第二道防线：任何瞬时抖动都不应把侧边栏
 * 永久按在「会话列表加载失败」的错误态上。
 */
const SESSION_LIST_TRANSIENT_RETRY_DELAYS_MS = [400, 1200, 2600];

/**
 * 只有「快速失败」的传输错误才值得重试（阈值 ms）。
 *
 * 连接被拒 / 被重置（网关正在重启）是毫秒级返回的，重试能立刻自愈；
 * 而 `fetchWithTimeout` 的 20s 墙钟超时代表「网关接受了连接却卡住」，
 * 重试 3 次会把骨架屏拖到 80s 以上 —— 那种情况应当尽快把错误暴露给用户，
 * 而不是默默重试。
 */
const SESSION_LIST_TRANSIENT_FAILURE_MAX_ELAPSED_MS = 5_000;

/**
 * 会话列表请求的**并发同参合并**(在途单飞)。
 *
 * 为什么需要:本 hook 在工作台里是**多实例常驻**的 —— 融合布局下
 * `FusionSidebar` + `TitlebarTabStrip` 各一个,外加被无上限
 * `CachedRouteOutlet` 永久缓存的 `HomePage`,最多 3 个;经典布局则是
 * `AppSidebar` + `SessionSidebar`。而刷新总线
 * (`requestSessionListRefresh` / `refreshSessionListsNow`)会在**同一个
 * 微任务里同步通知所有实例**,挂载 effect 也会在同一提交内跑完 —— 于是这些
 * 实例对完全相同的 `GET /sessions?limit=100&excludeTeam=true` 天然并发,
 * 一次刷新广播就是 N 次一模一样的网络往返。
 *
 * 这里让同参请求共享同一个在途 Promise,把 N 次压成 1 次。只合并「并发在途」,
 * 落定即摘除键,**不缓存已完成结果**,因此不引入任何陈旧窗口;各实例的 state、
 * 请求 ID 与错误处理仍完全独立(共享的只是 Promise)。
 */
type SessionListSnapshot = Awaited<ReturnType<SessionsClient['list']>>;

const inFlightSessionLists = new Map<string, Promise<SessionListSnapshot>>();

function resolveSessionListRequestKey(
  gatewayUrl: string,
  token: string,
  options: SessionsListOptions,
): string {
  // 键必须覆盖所有影响请求结果的输入:网关地址、令牌、路径过滤开关。
  // (`excludeTeam` 恒为 true,无需参与。)
  return [
    gatewayUrl,
    token,
    options.path ?? '',
    options.includeDescendants === false ? '0' : '1',
    // 键必须覆盖 host 维度:两台 SSH 主机上的同名 `/srv/app` 请求参数完全一致,
    // 漏掉连接 id 会让它们命中同一份在途 Promise,A 主机的列表被当成 B 主机的结果。
    options.sshConnectionId ?? '',
  ].join('\u0000');
}

function loadSessionListSingleFlight(
  key: string,
  load: () => Promise<SessionListSnapshot>,
): Promise<SessionListSnapshot> {
  const existing = inFlightSessionLists.get(key);
  if (existing) {
    return existing;
  }

  const pending = load().finally(() => {
    if (inFlightSessionLists.get(key) === pending) {
      inFlightSessionLists.delete(key);
    }
  });
  inFlightSessionLists.set(key, pending);
  return pending;
}

/**
 * 统一的「try/catch」导出动作包装（无 busy 标志）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 try/catch 内的值块（条件 / 逻辑 /
 * 三元），也不支持 finally 子句，本 hook 内多处 try/catch/finally 会让它整体脱靶
 * （实测）。语义逐字照搬：`run` 的全流程仍在 try 内，catch 只记日志。
 */
async function runSessionExportOnce(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (err) {
    ctx.onError(err);
  }
}

/**
 * 重命名会话（含本地缓存 / 列表同步与 finally 清理）。
 *
 * 同 `runSessionExportOnce`：try/catch/finally 必须留在模块级，否则整个 hook 脱靶。
 * 语义逐字照搬：成功时同步父会话缓存与列表，失败只记日志，finally 无条件退出重命名态。
 */
async function runSessionRenameOnce(ctx: {
  sessionId: string;
  nextTitle: string;
  gatewayUrl: string;
  tokenStore: TokenStore;
  parentSessionCacheRef: { current: Map<string, { title?: string | null }> };
  setSessions: (updater: (prev: Session[]) => Session[]) => void;
  setRenamingSessionId: (value: string | null) => void;
  setRenameValue: (value: string) => void;
}): Promise<void> {
  try {
    await withTokenRefresh(ctx.gatewayUrl, ctx.tokenStore, (token) =>
      createSessionsClient(ctx.gatewayUrl).rename(token, ctx.sessionId, ctx.nextTitle),
    );
    const cachedParentSession = ctx.parentSessionCacheRef.current.get(ctx.sessionId);
    if (cachedParentSession) {
      ctx.parentSessionCacheRef.current.set(ctx.sessionId, {
        ...cachedParentSession,
        title: ctx.nextTitle,
      });
    }
    ctx.setSessions((prev) =>
      prev.map((s) => (s.id === ctx.sessionId ? { ...s, title: ctx.nextTitle } : s)),
    );
  } catch (err) {
    logger.error('Failed to rename session:', err);
  } finally {
    ctx.setRenamingSessionId(null);
    ctx.setRenameValue('');
  }
}

/**
 * 会话动作的通用「try/catch/finally」包装：`run` 全流程留在 try 内，catch 交给
 * `onError`（不传＝异常继续向上抛，不得静默吞掉），finally 跑清理。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块与 `throw`，本 hook 多处 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runSessionsFetchOnce<T>(ctx: {
  /** catch 处理；返回值即本函数返回值（用来保留原 catch 里的 `return true/false`）。 */
  onError?: (error: unknown) => T | Promise<T>;
  onFinally?: () => void;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await ctx.run();
  } catch (error) {
    if (!ctx.onError) {
      throw error;
    }
    return await ctx.onError(error);
  } finally {
    ctx.onFinally?.();
  }
}

/**
 * 会话列表的「瞬时传输失败重试」循环。
 *
 * 同样必须留在模块级：循环内的 try/catch 与两处 `throw`，会被 React Compiler 判为
 * "Support ThrowStatement inside of try/catch" 并放弃优化整个 hook。语义逐字照搬：
 * 重试预算耗尽（`undefined` 档位）、`HttpError`（服务端确定性结果）、单次尝试超时、
 * 请求已过期——四种情况都直接抛出原错误；只有「快速失败的传输层错误」才退避重试。
 */
async function loadSessionsWithTransientRetry(ctx: {
  loadSessionList: () => Promise<Session[]>;
  /** 当前请求是否已被更新的请求取代（取代即放弃重试并抛出）。 */
  isStale: () => boolean;
}): Promise<Session[]> {
  let attempt = 0;
  while (true) {
    const attemptStartedAt = Date.now();
    try {
      return await ctx.loadSessionList();
    } catch (error) {
      const retryDelayMs = SESSION_LIST_TRANSIENT_RETRY_DELAYS_MS[attempt];
      if (
        retryDelayMs === undefined ||
        error instanceof HttpError ||
        Date.now() - attemptStartedAt > SESSION_LIST_TRANSIENT_FAILURE_MAX_ELAPSED_MS ||
        ctx.isStale()
      ) {
        throw error;
      }
      logger.warn(`Failed to fetch sessions, retrying in ${retryDelayMs}ms`, error);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, retryDelayMs);
      });
    }
    attempt += 1;
  }
}

export function useSessions() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  /**
   * `navigate` 的稳定读取入口，刻意**不**把 `navigate` 列入任何 useCallback 依赖。
   *
   * 原因：应用挂在 `<BrowserRouter>` 下（非 data router，见 `main.tsx`），
   * react-router 的 `useNavigateUnstable` 把 `locationPathname` 放进了
   * `useCallback` 依赖，因此**每次路由跳转都会返回新的 navigate 引用**。
   * 一旦把它写进 `fetchSessions` 依赖，依赖 `fetchSessions` 的挂载 effect
   * 就会在每次路由跳转时重跑——而本 hook 在 fusion 布局下有 3 个常驻实例
   * （`TitlebarTabStrip`、`FusionSidebar`、以及被无上限 `CachedRouteOutlet`
   * 永久缓存的 `HomePage`），结果是每次切会话发 3 次 `/sessions`。
   *
   * `navigate` 在请求路径上只用于 401 跳登录（见 fetchSessions 的 catch），
   * 完全可以用 ref 读取最新值，不该参与请求回调的依赖计算。
   */
  const navigateRef = useRef(navigate);
  // 渲染期直接写 ref 会被 React Compiler 判为 "Cannot update ref during render" 并放弃
  // 优化整个 hook，故改为 effect 同步。读取点全在异步回调（401 跳登录）里，晚于提交，
  // 拿到的一直是最新 navigate；`navigate` 依旧**不进**任何请求回调的依赖（上述取舍不变）。
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const savedWorkspaces = useUIStateStore((s) => s.savedWorkspaces);
  const mergeSavedWorkspaces = useUIStateStore((s) => s.mergeSavedWorkspaces);
  const sessionListPathFilterEnabled = useUIStateStore((s) => s.sessionListPathFilterEnabled);
  const sessionListPathFilterFeatureEnabled = useUIStateStore(
    (s) => s.sessionListPathFilterFeatureEnabled,
  );
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const selectedSshConnectionId = useUIStateStore((s) => s.selectedSshConnectionId);
  const collapsedSessionGroups = useUIStateStore((s) => s.collapsedSessionGroups);
  const toggleGroupCollapsed = useUIStateStore((s) => s.toggleSessionGroupCollapsed);
  const retainSubagentCollapsed = useUIStateStore((s) => s.retainSubagentCollapsed);
  const tokenStore: TokenStore = useMemo(
    () => ({
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () => useAuthStore.getState().refreshToken,
      setTokens: (at: string, rt: string, exp: string) =>
        useAuthStore.getState().setAuth(at, useAuthStore.getState().email ?? '', rt, exp),
      clearAuth: () => useAuthStore.getState().clearAuth(),
    }),
    [],
  );

  const [sessions, setSessions] = useState<Session[]>([]);
  // 初始即为加载中：首帧就渲染骨架，避免先闪一帧空态再切到骨架。
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(() => new Set());
  const [sessionSearch, setSessionSearch] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fetchRequestIdRef = useRef(0);
  const deletingSessionIdsRef = useRef<Set<string>>(new Set());
  const parentSessionCacheRef = useRef<Map<string, Session>>(new Map());
  const parentSessionInFlightRef = useRef<Map<string, Promise<Session | null>>>(new Map());
  const missingParentSessionExpiryRef = useRef<Map<string, number>>(new Map());
  const runStateOverridesRef = useRef<Map<string, SessionRunState>>(new Map());
  const parentSessionCacheScopeRef = useRef('');

  const parentSessionCacheScope = `${accessToken ?? ''}:${gatewayUrl}`;
  // 渲染期读写 ref 会被 React Compiler 判为 "Cannot access refs during render" /
  // "Passing a ref to a function may read its value during render" 并放弃优化整个 hook，
  // 故改为 effect 里比对 scope 再清空。这些缓存只服务于异步请求路径（fetchSessions /
  // hydrate），而本 effect 声明在挂载/重取 effect 之前、同一次提交里先执行，行为等价。
  useEffect(() => {
    if (parentSessionCacheScopeRef.current === parentSessionCacheScope) {
      return;
    }
    parentSessionCacheRef.current.clear();
    parentSessionInFlightRef.current.clear();
    missingParentSessionExpiryRef.current.clear();
    runStateOverridesRef.current.clear();
    parentSessionCacheScopeRef.current = parentSessionCacheScope;
  }, [parentSessionCacheScope]);

  const fetchSessions = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!accessToken) {
        setIsLoadingSessions(false);
        return;
      }
      const requestId = fetchRequestIdRef.current + 1;
      fetchRequestIdRef.current = requestId;
      if (!options?.silent) {
        setIsLoadingSessions(true);
      }
      // `loadSessionList` 定义本身不需要被 try 包着（它只是闭包），移出来便于把外层
      // try/catch/finally 整体下沉（见下方 `runSessionsFetchOnce`）。
      const loadSessionList = async (): Promise<Session[]> =>
        withTokenRefresh(gatewayUrl, tokenStore, async (token) => {
          const activeStreamSessionId = readPersistedActiveStreamSessionId();
          // P3-PATH: when the user opted into "scope sidebar to current
          // workspace", thread the selected path through the list call.
          // We only forward it when both (a) the toggle is on AND (b) the
          // user has actually picked a workspace, otherwise we keep the
          // legacy global list behaviour.
          // T-PATH-04: the feature flag in settings short-circuits the
          // toggle entirely so an admin can pin the legacy global
          // listing for the whole user without forcing them to clear
          // the per-tab toggle they may have already enabled.
          const listOptions: SessionsListOptions = { excludeTeam: true };
          if (
            sessionListPathFilterFeatureEnabled &&
            sessionListPathFilterEnabled &&
            selectedWorkspacePath
          ) {
            listOptions.path = selectedWorkspacePath;
            // 远端工作区必须带上连接 id：路径在跨主机时并不唯一，
            // 只按路径过滤会把其它服务器同名目录的会话一起捞进来。
            listOptions.sshConnectionId = selectedSshConnectionId;
          }
          // 多实例并发时合并为一次网络往返(见 loadSessionListSingleFlight)。
          const listedSessions = (await loadSessionListSingleFlight(
            resolveSessionListRequestKey(gatewayUrl, token, listOptions),
            () => createSessionsClient(gatewayUrl).list(token, listOptions),
          )) as unknown as Session[];
          const hydratedSessions = await hydrateMissingParentSessions(
            listedSessions,
            gatewayUrl,
            tokenStore,
            parentSessionCacheRef.current,
            parentSessionInFlightRef.current,
            missingParentSessionExpiryRef.current,
          );

          // 剪除失效的折叠父会话 ID。仅在列表完整时执行：路径过滤或触达页大小
          // 上限时列表可能残缺，「未出现」不等于「已删除」，此时剪除会误删其它
          // 工作区的折叠偏好。keep 集合 = 当前仍作为父会话出现的 ID。
          if (!listOptions.path && listedSessions.length < SESSIONS_LIST_PAGE_LIMIT) {
            const liveParentSessionIds = new Set<string>();
            for (const session of hydratedSessions) {
              const parentSessionId = extractParentSessionId(session.metadata_json);
              if (parentSessionId) {
                liveParentSessionIds.add(parentSessionId);
              }
            }
            retainSubagentCollapsed([...liveParentSessionIds]);
          }

          for (const session of hydratedSessions) {
            const overrideState = runStateOverridesRef.current.get(session.id);
            if (!overrideState) {
              continue;
            }

            if (session.state_status === overrideState) {
              runStateOverridesRef.current.delete(session.id);
              continue;
            }

            if (
              session.state_status === 'idle' &&
              overrideState !== 'idle' &&
              session.id !== activeStreamSessionId
            ) {
              runStateOverridesRef.current.delete(session.id);
            }
          }

          const nonTeamSessions = hydratedSessions.filter((session) => !isTeamSession(session));
          return applySessionRunStateOverrides(nonTeamSessions, runStateOverridesRef.current);
        });

      // 瞬时传输失败重试：见 SESSION_LIST_TRANSIENT_RETRY_DELAYS_MS 的常量注释。
      // 只对「非 HttpError」（即 fetch 直接被拒、被归一成中文网络文案的传输层失败）
      // 且「快速失败」的尝试重试；HttpError 是服务端给出的确定性结果，慢失败
      // （墙钟超时）见 SESSION_LIST_TRANSIENT_FAILURE_MAX_ELAPSED_MS 的说明。
      // 外层 try/catch/finally 下沉到模块级 `runSessionsFetchOnce`（见其注释）。
      await runSessionsFetchOnce({
        onError: (err) => {
          if (fetchRequestIdRef.current !== requestId) {
            return;
          }
          if (err instanceof HttpError && err.status === 401) {
            clearAuth();
            void navigateRef.current('/');
            return;
          }
          logger.error('Failed to fetch sessions:', err);
          if (!options?.silent) {
            setSessionsError('会话列表加载失败');
          }
        },
        onFinally: () => {
          if (fetchRequestIdRef.current === requestId) {
            setIsLoadingSessions(false);
          }
        },
        run: async () => {
          const loadedSessions = await loadSessionsWithTransientRetry({
            loadSessionList,
            isStale: () => fetchRequestIdRef.current !== requestId,
          });
          if (fetchRequestIdRef.current !== requestId) {
            return;
          }
          const nextSessions = loadedSessions;
          mergeSavedWorkspaces(listWorkspaceIdentitiesFromSessions(nextSessions));
          setSessions((previous) =>
            isSessionListSemanticallyEqual(previous, nextSessions) ? previous : nextSessions,
          );
          setSessionsError(null);
        },
      });
    },
    [
      accessToken,
      gatewayUrl,
      tokenStore,
      clearAuth,
      mergeSavedWorkspaces,
      retainSubagentCollapsed,
      sessionListPathFilterEnabled,
      sessionListPathFilterFeatureEnabled,
      selectedWorkspacePath,
      selectedSshConnectionId,
      // 刻意不含 navigate —— 见 navigateRef 处的说明。移除后每次路由跳转
      // 不再重跑挂载 effect，常驻的多个实例也不会各发一次 /sessions。
    ],
  );

  /**
   * 进入「草稿会话」：只切到 /chat 空白态，不在服务端落库空会话。
   *
   * 真正的会话由 ChatPage 在用户发出首条消息时惰性创建（`ensureSession`），
   * 因此连续点击「新建会话」不会堆积空对话；已处于草稿态时只会复用同一个草稿
   * （草稿标签由 uiState 去重），不会无限新建。
   *
   * 工作区按「点击来源」解析（见 `resolveNewSessionWorkspacePath`）：显式传入的
   * 分组 / 项目 / 文件树路径优先；否则继承当前正在查看的会话（或激活会话标签）
   * 的工作区；都不可解析时才回落全局选中值——避免沿用陈旧选中值导致新建后
   * 还要手动调整工作区。
   */
  const newSession = useCallback(
    async (workspacePath?: string | null, sshConnectionId?: string | null) => {
      if (!accessToken) return;

      const uiState = useUIStateStore.getState();
      const activeTab = uiState.tabs.find((tab) => tab.id === uiState.activeTabId) ?? null;
      // 侧栏 / 标题栏渲染在布局路由下，`useParams` 拿不到子路由的 sessionId，
      // 只能从 location 解析当前正在查看的会话（与各侧栏既有做法一致）。
      const routeSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] || null;
      const contextSessionId =
        routeSessionId ?? (activeTab?.type === 'session' ? activeTab.sessionId : null);
      const resolvedWorkspace = resolveNewSessionWorkspace({
        ...(workspacePath !== undefined
          ? { explicitWorkspacePath: workspacePath, explicitSshConnectionId: sshConnectionId }
          : {}),
        contextSessionId,
        activeSessionWorkspace: uiState.activeSessionWorkspace,
        sessions,
        fallbackWorkspacePath: uiState.selectedWorkspacePath,
        // 全局选中工作区是「路径 + 连接」成对的选中值，路径回落时连接一起回落；
        // 缺失这一步会让远端工作区的新会话退化成裸路径，丢掉 SSH 标识。
        fallbackSshConnectionId: uiState.selectedSshConnectionId,
      });

      uiState.openDraftSession(resolvedWorkspace.workspacePath, resolvedWorkspace.sshConnectionId);
      void navigateRef.current('/chat');
    },
    // 同样走 navigateRef：`navigate` 的引用随路由变化会让本回调（及其下游子组件）
    // 无谓地重建。location.pathname 是解析当前会话的真实输入，保留。
    [accessToken, location.pathname, sessions],
  );

  const startRename = useCallback((session: Session) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title ?? '');
  }, []);

  const commitRename = useCallback(
    async (sessionIdToRename: string) => {
      if (!accessToken) return;
      const nextTitle = renameValue.trim();
      if (!nextTitle) {
        setRenamingSessionId(null);
        return;
      }
      // 含 try/catch/finally 的动作体下沉到模块级 `runSessionRenameOnce`（见其注释）。
      await runSessionRenameOnce({
        sessionId: sessionIdToRename,
        nextTitle,
        gatewayUrl,
        tokenStore,
        parentSessionCacheRef,
        setSessions,
        setRenamingSessionId,
        setRenameValue,
      });
    },
    [accessToken, gatewayUrl, tokenStore, renameValue],
  );

  const cancelRename = useCallback(() => {
    setRenamingSessionId(null);
    setRenameValue('');
  }, []);

  const quickDeleteSession = useCallback(
    async (sessionIdToDelete: string, options?: { suppressToast?: boolean }) => {
      if (!accessToken) return false;
      if (deletingSessionIdsRef.current.has(sessionIdToDelete)) {
        return false;
      }

      deletingSessionIdsRef.current.add(sessionIdToDelete);
      setDeletingSessionIds((previous) => {
        const next = new Set(previous);
        next.add(sessionIdToDelete);
        return next;
      });

      // try/catch/finally 下沉到模块级 `runSessionsFetchOnce`；其 `onError` 的返回值
      // 就是本回调的返回值，用来保留原 catch 里的 `return true / false`。
      return runSessionsFetchOnce<boolean>({
        onError: (err) => {
          if (isSessionAlreadyDeletedError(err)) {
            parentSessionCacheRef.current.delete(sessionIdToDelete);
            parentSessionInFlightRef.current.delete(sessionIdToDelete);
            missingParentSessionExpiryRef.current.set(
              sessionIdToDelete,
              Date.now() + MISSING_PARENT_SESSION_CACHE_TTL_MS,
            );
            setSessions((prev) => prev.filter((s) => s.id !== sessionIdToDelete));
            // 会话确已不存在：注销它的子视图现场（折叠态 / 记住的子会话）。
            useUIStateStore.getState().forgetSessionSubviews([sessionIdToDelete]);
            const nextActiveTab = useUIStateStore.getState().closeSessionTabs([sessionIdToDelete]);
            if (sessionId === sessionIdToDelete) {
              navigateToClosedSessionTarget(nextActiveTab, navigate);
            }
            void fetchSessions();
            return true;
          }

          logger.error('Failed to delete session:', err);
          if (!options?.suppressToast) {
            toast(getSessionDeleteErrorMessage(err), 'error', 4200);
          }
          return false;
        },
        onFinally: () => {
          deletingSessionIdsRef.current.delete(sessionIdToDelete);
          setDeletingSessionIds((previous) => {
            if (!previous.has(sessionIdToDelete)) {
              return previous;
            }

            const next = new Set(previous);
            next.delete(sessionIdToDelete);
            return next;
          });
        },
        run: async () => {
          const result = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
            createSessionsClient(gatewayUrl).delete(token, sessionIdToDelete),
          );
          const deletedSessionIds = new Set(resolveDeletedSessionIds(result, sessionIdToDelete));
          for (const deletedSessionId of deletedSessionIds) {
            parentSessionCacheRef.current.delete(deletedSessionId);
            parentSessionInFlightRef.current.delete(deletedSessionId);
            missingParentSessionExpiryRef.current.set(
              deletedSessionId,
              Date.now() + MISSING_PARENT_SESSION_CACHE_TTL_MS,
            );
          }
          setSessions((prev) => prev.filter((s) => !deletedSessionIds.has(s.id)));
          // 子视图现场随会话一起注销（含级联删除出的关联会话）。
          useUIStateStore.getState().forgetSessionSubviews(Array.from(deletedSessionIds));
          // 顶部会话标签（融合布局）与列表联动：删除后同步关闭对应标签页，
          // 若被删会话正是当前路由，则改跳到关闭后应激活的标签页。
          const nextActiveTab = useUIStateStore
            .getState()
            .closeSessionTabs(Array.from(deletedSessionIds));
          if (sessionId && deletedSessionIds.has(sessionId)) {
            navigateToClosedSessionTarget(nextActiveTab, navigate);
          }
          // 从服务器刷新完整列表——删除可能触发关联会话的级联删除
          // （如 team session 的子会话），本地过滤可能遗漏。
          void fetchSessions();
          return true;
        },
      });
    },
    [accessToken, gatewayUrl, tokenStore, sessionId, navigate, fetchSessions],
  );

  const isDeletingSession = useCallback(
    (sessionIdToCheck: string) => deletingSessionIds.has(sessionIdToCheck),
    [deletingSessionIds],
  );

  const quickExportSession = useCallback(
    async (sessionIdToExport: string) => {
      if (!accessToken) return;
      await runSessionExportOnce({
        onError: (err) => {
          logger.error('Failed to export session:', err);
        },
        run: async () => {
          const session = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
            createSessionsClient(gatewayUrl).get(token, sessionIdToExport),
          );
          exportSession(sessionIdToExport, session.messages ?? []);
        },
      });
    },
    [accessToken, gatewayUrl, tokenStore],
  );

  const exportSessionAsMarkdown = useCallback(
    async (sId: string) => {
      if (!accessToken) return;
      await runSessionExportOnce({
        onError: (err) => {
          logger.error('Failed to export markdown:', err);
        },
        run: async () => {
          const session = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
            createSessionsClient(gatewayUrl).get(token, sId),
          );
          exportSession(sId, session.messages ?? []);
        },
      });
    },
    [accessToken, gatewayUrl, tokenStore],
  );

  const exportSessionAsJson = useCallback(
    async (sId: string) => {
      if (!accessToken) return;
      await runSessionExportOnce({
        onError: (err) => {
          logger.error('Failed to export json:', err);
        },
        run: async () => {
          const session = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
            createSessionsClient(gatewayUrl).get(token, sId),
          );
          const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${
            (session.title ?? 'session')
              .replace(/[^a-zA-Z0-9\-_ ]/g, '')
              .trim()
              .slice(0, 50) || 'session'
          }.json`;
          a.click();
          URL.revokeObjectURL(url);
        },
      });
    },
    [accessToken, gatewayUrl, tokenStore],
  );

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    return subscribeSessionListRefresh(() => fetchSessions({ silent: true }));
  }, [fetchSessions]);

  useEffect(() => {
    return subscribeSessionRunState((sessionId, state) => {
      runStateOverridesRef.current.set(sessionId, state);

      const cachedParentSession = parentSessionCacheRef.current.get(sessionId);
      if (cachedParentSession) {
        parentSessionCacheRef.current.set(sessionId, {
          ...cachedParentSession,
          state_status: state,
        });
      }

      setSessions((previous) =>
        applySessionRunStateOverrides(previous, runStateOverridesRef.current),
      );
    });
  }, []);

  const deferredSessionSearch = useDeferredValue(sessionSearch);
  const normalizedSessionSearch = deferredSessionSearch.trim().toLowerCase();
  const pinnedSessions = useUIStateStore((s) => s.pinnedSessions);
  const collapsedGroups = useMemo(() => new Set(collapsedSessionGroups), [collapsedSessionGroups]);
  const workspaceCollections = useMemo(
    () => buildWorkspaceSessionCollections(sessions, savedWorkspaces, pinnedSessions),
    [savedWorkspaces, sessions, pinnedSessions],
  );

  const groupedSessionTrees = useMemo(
    () =>
      filterSessionTreeGroupsByQuery(
        workspaceCollections.treeGroups,
        normalizedSessionSearch,
      ).filter((group) => group.sessions.length > 0),
    [normalizedSessionSearch, workspaceCollections.treeGroups],
  );

  return {
    sessions,
    filteredSessions: sessions,
    groupedSessions: workspaceCollections.groups,
    groupedSessionTrees,
    sessionTreeGroups: workspaceCollections.treeGroups,
    sessionCountByWorkspace: workspaceCollections.sessionCountByWorkspace,
    workspaceSessionIdsByGroupKey: workspaceCollections.sessionIdsByGroupKey,
    isLoadingSessions,
    sessionsError,
    renamingSessionId,
    renameValue,
    setRenameValue,
    hoveredSessionId,
    setHoveredSessionId,
    isDeletingSession,
    collapsedGroups,
    toggleGroupCollapsed,
    sessionSearch,
    setSessionSearch,
    renameInputRef,
    fetchSessions,
    newSession,
    startRename,
    commitRename,
    cancelRename,
    quickDeleteSession,
    quickExportSession,
    exportSessionAsMarkdown,
    exportSessionAsJson,
  };
}

async function hydrateMissingParentSessions(
  sessions: Session[],
  gatewayUrl: string,
  tokenStore: TokenStore,
  parentSessionCache: Map<string, Session>,
  parentSessionInFlight: Map<string, Promise<Session | null>>,
  missingParentSessionExpiry: Map<string, number>,
): Promise<Session[]> {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const pendingParentIds: string[] = [];
  const queuedParentIds = new Set<string>();

  const enqueueParentId = (parentSessionId: string | null) => {
    if (
      !parentSessionId ||
      sessionById.has(parentSessionId) ||
      queuedParentIds.has(parentSessionId)
    ) {
      return;
    }

    queuedParentIds.add(parentSessionId);
    pendingParentIds.push(parentSessionId);
  };

  for (const session of sessions) {
    enqueueParentId(extractParentSessionId(session.metadata_json));
  }

  while (pendingParentIds.length > 0) {
    const currentParentBatch = pendingParentIds.splice(0);
    const fetchedParents = await Promise.all(
      currentParentBatch.map(async (parentSessionId) => {
        const missingParentExpiry = missingParentSessionExpiry.get(parentSessionId);
        if (missingParentExpiry && missingParentExpiry > Date.now()) {
          return null;
        }
        if (missingParentExpiry) {
          missingParentSessionExpiry.delete(parentSessionId);
        }

        const cachedParent = parentSessionCache.get(parentSessionId);
        if (cachedParent) {
          return cachedParent;
        }

        const pendingRequest = parentSessionInFlight.get(parentSessionId);
        if (pendingRequest) {
          return pendingRequest;
        }

        const fetchParentRequest = (async () => {
          try {
            const parentSession = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
              createSessionsClient(gatewayUrl).get(token, parentSessionId),
            );
            const blockedParentExpiry = missingParentSessionExpiry.get(parentSessionId);
            if (blockedParentExpiry && blockedParentExpiry > Date.now()) {
              return null;
            }
            const normalizedParentSession = normalizeSessionSummary(parentSession, parentSessionId);
            parentSessionCache.set(normalizedParentSession.id, normalizedParentSession);
            missingParentSessionExpiry.delete(parentSessionId);
            return normalizedParentSession;
          } catch (error) {
            if (error instanceof HttpError && error.status === 401) {
              throw error;
            }

            if (error instanceof HttpError && error.status === 404) {
              missingParentSessionExpiry.set(
                parentSessionId,
                Date.now() + MISSING_PARENT_SESSION_CACHE_TTL_MS,
              );
              return null;
            }

            logger.error('Failed to hydrate parent session:', parentSessionId, error);
            return null;
          } finally {
            parentSessionInFlight.delete(parentSessionId);
          }
        })();
        parentSessionInFlight.set(parentSessionId, fetchParentRequest);
        return fetchParentRequest;
      }),
    );

    for (const parentSession of fetchedParents) {
      if (!parentSession) {
        continue;
      }

      sessionById.set(parentSession.id, parentSession);
      enqueueParentId(extractParentSessionId(parentSession.metadata_json));
    }
  }

  return Array.from(sessionById.values());
}

function normalizeSessionSummary(
  session: Partial<Session> & {
    id: string;
    metadata_json?: string;
    title?: string | null;
    updatedAt?: number;
  },
  fallbackId: string,
): Session {
  const updatedAt =
    typeof session.updated_at === 'string'
      ? session.updated_at
      : typeof session.updatedAt === 'number'
        ? new Date(session.updatedAt).toISOString()
        : new Date(0).toISOString();

  return {
    id: session.id || fallbackId,
    state_status: session.state_status,
    title: session.title ?? null,
    metadata_json: session.metadata_json,
    updated_at: updatedAt,
    ...(session.team_parent_session_id != null
      ? { team_parent_session_id: session.team_parent_session_id }
      : {}),
    ...(session.role_layer != null ? { role_layer: session.role_layer } : {}),
  };
}

function applySessionRunStateOverrides(
  sessions: Session[],
  runStateOverrides: Map<string, SessionRunState>,
): Session[] {
  let hasChanges = false;
  const nextSessions = sessions.map((session) => {
    const overrideState = runStateOverrides.get(session.id);
    if (!overrideState || session.state_status === overrideState) {
      return session;
    }

    hasChanges = true;
    return {
      ...session,
      state_status: overrideState,
    };
  });

  return hasChanges ? nextSessions : sessions;
}

/**
 * 列表等值判断：轮询返回完全相同的数据时保留旧数组引用，
 * 避免每拍都产生新引用触发侧栏无谓重渲染。
 */
function isSessionListSemanticallyEqual(
  previous: readonly Session[],
  next: readonly Session[],
): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < next.length; index += 1) {
    const left = previous[index];
    const right = next[index];
    if (!left || !right) {
      return false;
    }
    if (
      left.id !== right.id ||
      left.state_status !== right.state_status ||
      left.title !== right.title ||
      left.updated_at !== right.updated_at ||
      left.metadata_json !== right.metadata_json ||
      left.team_parent_session_id !== right.team_parent_session_id ||
      left.role_layer !== right.role_layer
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 判断一个会话是否属于 team 会话。
 *
 * Team 会话通过以下任一标识识别：
 * 1. metadata_json 中包含 teamWorkspaceId 字段（reception 根会话）
 * 2. team_parent_session_id 列有值（pm1/pm2/executor/reviewer 子会话）
 * 3. role_layer 列有值（所有 team 层级会话）
 *
 * 仅检查 metadata_json 中的 teamWorkspaceId 是不够的——某些 team 子会话
 * 通过 team_parent_session_id 列关联到 team，而非 metadata_json。
 */
function isTeamSession(session: Session): boolean {
  return (
    hasTeamWorkspace(session.metadata_json) ||
    session.team_parent_session_id != null ||
    session.role_layer != null
  );
}
