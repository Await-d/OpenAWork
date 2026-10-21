/**
 * 工作区文件索引版本轮询：把「工作区文件是否变化」变成一个可消费的信号。
 *
 * 网关侧的文件索引版本是进程内单调计数器——Agent 写盘、用户保存文件、目录增删
 * 都会让它前进。这里在预览可见时轻量轮询该版本（O(1)，不触发索引构建），一旦
 * 版本与上次读到的不同（网关重启导致版本变小也算变化），就调用 `onChange`，
 * 由宿主（内置浏览器）走既有的刷新机制重载预览。
 *
 * 全程 best-effort：任何读取失败都只记录日志、绝不抛出，更不会产生 unhandled
 * rejection；禁停用、无 workspace 作用域、无 token 时完全不轮询，并在卸载 / 依赖
 * 变化时清理定时器。作用域不是绝对路径时（无工作目录的会话）交给网关回退到未绑定
 * 会话默认工作区。
 */

import { useEffect, useRef } from 'react';
import {
  HttpError,
  createWorkspaceClient,
  type WorkspaceFileReadOptions,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { WORKSPACE_INDEX_CHANGED_EVENT } from '../../../../../utils/file/file-preview.js';

/** 默认轮询间隔：兼顾「接近实时」与请求量，2500ms 足以覆盖常见的写盘节奏。 */
export const WORKSPACE_INDEX_REFRESH_DEFAULT_INTERVAL_MS = 2500;

/**
 * 自动刷新之间的最小间隔（毫秒）。
 *
 * Agent 连续写盘时索引版本几乎每轮都在变，不加间隔就等于每 2.5s 把预览整页 reload
 * 一次（实时引擎还要重新产帧）。冷却期内的变化合并成一次**尾随**刷新，保证最后一次
 * 写盘不会被吞掉。
 */
export const WORKSPACE_INDEX_REFRESH_MIN_INTERVAL_MS = 8_000;

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

/**
 * 解析轮询应发给网关的 `path`。
 *
 * 宿主传入的 `workspacePath` 语义上是「按 workspace 隔离 UI 状态的持久化 key」，
 * 无工作目录的会话会落成 `__session__:<id>` / `__default__` 这类纯 UI 作用域键。
 * 这类值（以及相对路径、空值）不是可索引的绝对文件系统路径，返回空串交给网关
 * 回退到「未绑定会话默认工作区」，让无工作目录的会话也能拿到预览刷新信号。
 */
export function resolveWorkspaceIndexWatchPath(workspacePath: string | null | undefined): string {
  const trimmed = workspacePath?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  const isAbsolutePath =
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\\\') ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed);
  return isAbsolutePath ? trimmed : '';
}

export interface UseWorkspaceIndexRefreshOptions {
  /** 是否启用轮询（宿主通常传「预览可见」）。 */
  enabled: boolean;
  /**
   * 要监视的工作区作用域。绝对文件系统路径会原样轮询；空值、纯 UI 作用域键
   * （`__session__:<id>` / `__default__`）或相对路径则请求网关的「未绑定会话默认
   * 工作区」（见 {@link resolveWorkspaceIndexWatchPath}）。完全为空时不发请求。
   */
  workspacePath: string | null;
  /** 版本发生变化（含变小）时回调，宿主据此刷新预览。 */
  onChange: () => void;
  /** 轮询间隔毫秒数，缺省 2500。 */
  intervalMs?: number;
  /**
   * 两次自动刷新之间的最小间隔（毫秒），缺省
   * {@link WORKSPACE_INDEX_REFRESH_MIN_INTERVAL_MS}。
   */
  minIntervalMs?: number;
  /**
   * SSH 读取身份。
   *
   * 缺失时网关按本机路径查索引版本，远端 POSIX 路径会得到 400；而本hook 对
   * 400/403 是**直接 stop() 永久停轮询**的 —— 结果是 SSH 远端会话下内置浏览器
   * 预览的自动刷新与 `WORKSPACE_INDEX_CHANGED_EVENT` 广播永久失效。
   */
  readIdentity?: WorkspaceFileReadOptions;
}

/**
 * 轮询工作区索引版本，变化时触发 `onChange`。
 *
 * 首次成功读取只用于建立基线，不视为变化（避免挂载即刷新）；之后每次读取若版本
 * 不同则回调一次，但两次回调之间至少隔 `minIntervalMs`（冷却期内的变化合并成一次
 * 尾随回调）。请求进行中会跳过本轮，避免重叠请求堆积。
 */
/**
 * 工作区索引版本轮询的统一包装：try → catch 交给 `onError` → finally 收尾（复位 inFlight）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，也不支持 try 内
 * 的值块（`...(cond ?? {})`）。语义逐字照搬。
 */
async function runIndexPollOnce(ctx: {
  onError: (error: unknown) => void;
  onFinally: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.onFinally();
  }
}

export function useWorkspaceIndexRefresh({
  enabled,
  workspacePath,
  onChange,
  intervalMs = WORKSPACE_INDEX_REFRESH_DEFAULT_INTERVAL_MS,
  minIntervalMs = WORKSPACE_INDEX_REFRESH_MIN_INTERVAL_MS,
  readIdentity,
}: UseWorkspaceIndexRefreshOptions): void {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  // 用 ref 持有最新回调，避免调用方每次渲染传入新函数导致轮询被反复重建。
  const onChangeRef = useRef(onChange);
  // 渲染期直接写 ref 会被编译器判为 "Cannot update ref during render" 并放弃优化整个 hook，
  // 故改为 effect 同步（读取点全在事件 / 异步回调与轮询里，晚于提交）。
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // 身份同样走 ref：轮询 effect 不应因身份对象重建而反复重启。
  const readIdentityRef = useRef(readIdentity);
  // 同上：渲染期写 ref 会让整个 hook 脱靶，改为 effect 同步。
  useEffect(() => {
    readIdentityRef.current = readIdentity;
  }, [readIdentity]);

  useEffect(() => {
    if (!enabled) return;
    const workspaceScope = workspacePath?.trim() ?? '';
    if (!workspaceScope || !accessToken || !gatewayUrl) return;
    // 非绝对路径（UI 作用域键）→ 空串，让网关回退到未绑定会话默认工作区。
    const path = resolveWorkspaceIndexWatchPath(workspaceScope);
    const pathLabel = path || '(默认工作区)';

    let client: ReturnType<typeof createWorkspaceClient> | null = null;
    try {
      client = createWorkspaceClient(gatewayUrl);
    } catch (error) {
      console.warn('[use-workspace-index-refresh] 创建工作区客户端失败，停止轮询：', String(error));
      return;
    }
    if (!client) return;

    let disposed = false;
    let inFlight = false;
    let lastVersion: number | null = null;
    let timer: number | null = null;
    /** 上次真正触发刷新的时刻；冷却期内的变化合并成一次尾随刷新。 */
    let lastNotifiedAt: number | null = null;
    let pendingNotify: number | null = null;

    const stop = (): void => {
      disposed = true;
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      if (pendingNotify !== null) {
        window.clearTimeout(pendingNotify);
        pendingNotify = null;
      }
    };

    const notify = (version: number): void => {
      lastNotifiedAt = Date.now();
      // 广播给 hover 文件预览等内容缓存：此前这些缓存没有任何生产代码会
      // 失效，Agent 写盘后重复 hover 仍显示旧内容。
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(WORKSPACE_INDEX_CHANGED_EVENT, { detail: { version } }),
        );
      }
      onChangeRef.current();
    };

    /**
     * 冷却期（Agent 连续写盘）内不立刻刷新，但必须排一次尾随刷新——否则最后一次
     * 写盘会被吞掉，预览永远停在旧内容上。
     */
    const scheduleNotify = (version: number): void => {
      const elapsed =
        lastNotifiedAt === null ? Number.POSITIVE_INFINITY : Date.now() - lastNotifiedAt;
      if (elapsed >= minIntervalMs) {
        notify(version);
        return;
      }
      if (pendingNotify !== null) return;
      pendingNotify = window.setTimeout(() => {
        pendingNotify = null;
        notify(version);
      }, minIntervalMs - elapsed);
    };

    const poll = async (): Promise<void> => {
      if (disposed || inFlight) return;
      inFlight = true;
      // try/catch/finally 下沉到模块级 `runIndexPollOnce`（见其注释）。
      await runIndexPollOnce({
        onError: (error) => {
          if (disposed) return;
          // 400 / 403 = 网关已判定该路径不可访问（跨主机 / 不在允许范围 / 当前账号无权）。
          // 路径本身不会变化，继续轮询只会持续刷失败日志，因此直接停止。
          if (error instanceof HttpError && (error.status === 400 || error.status === 403)) {
            console.warn(
              '[use-workspace-index-refresh] 工作区路径被网关拒绝，停止轮询：',
              pathLabel,
            );
            stop();
            return;
          }
          // 其它失败静默降级：下一轮重试，绝不抛出 unhandled rejection。
          console.warn('[use-workspace-index-refresh] 读取索引版本失败：', String(error));
        },
        onFinally: () => {
          inFlight = false;
        },
        run: async () => {
          const { version } = await client.getFileIndexVersion(accessToken, path, {
            ...(readIdentityRef.current ?? {}),
          });
          if (disposed) return;
          if (lastVersion === null) {
            // 首次成功读取只建立基线，不触发刷新。
            lastVersion = version;
            return;
          }
          if (version !== lastVersion) {
            // 网关版本是进程内计数器，重启后会归零；「变小」同样视为变化。
            lastVersion = version;
            scheduleNotify(version);
          }
        },
      });
    };

    void poll();
    timer = window.setInterval(() => void poll(), intervalMs);
    return stop;
  }, [enabled, workspacePath, accessToken, gatewayUrl, intervalMs, minIntervalMs]);
}
