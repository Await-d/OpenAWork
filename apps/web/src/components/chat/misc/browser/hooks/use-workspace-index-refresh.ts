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
import { HttpError, createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../../stores/auth/auth.js';

/** 默认轮询间隔：兼顾「接近实时」与请求量，2500ms 足以覆盖常见的写盘节奏。 */
export const WORKSPACE_INDEX_REFRESH_DEFAULT_INTERVAL_MS = 2500;

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
}

/**
 * 轮询工作区索引版本，变化时触发 `onChange`。
 *
 * 首次成功读取只用于建立基线，不视为变化（避免挂载即刷新）；之后每次读取若版本
 * 不同则回调一次。请求进行中会跳过本轮，避免重叠请求堆积。
 */
export function useWorkspaceIndexRefresh({
  enabled,
  workspacePath,
  onChange,
  intervalMs = WORKSPACE_INDEX_REFRESH_DEFAULT_INTERVAL_MS,
}: UseWorkspaceIndexRefreshOptions): void {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  // 用 ref 持有最新回调，避免调用方每次渲染传入新函数导致轮询被反复重建。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

    const stop = (): void => {
      disposed = true;
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const poll = async (): Promise<void> => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const { version } = await client.getFileIndexVersion(accessToken, path);
        if (disposed) return;
        if (lastVersion === null) {
          // 首次成功读取只建立基线，不触发刷新。
          lastVersion = version;
          return;
        }
        if (version !== lastVersion) {
          // 网关版本是进程内计数器，重启后会归零；「变小」同样视为变化。
          lastVersion = version;
          onChangeRef.current();
        }
      } catch (error) {
        if (disposed) return;
        // 400 / 403 = 网关已判定该路径不可访问（跨主机 / 不在允许范围 / 当前账号无权）。
        // 路径本身不会变化，继续轮询只会持续刷失败日志，因此直接停止。
        if (error instanceof HttpError && (error.status === 400 || error.status === 403)) {
          console.warn('[use-workspace-index-refresh] 工作区路径被网关拒绝，停止轮询：', pathLabel);
          stop();
          return;
        }
        // 其它失败静默降级：下一轮重试，绝不抛出 unhandled rejection。
        console.warn('[use-workspace-index-refresh] 读取索引版本失败：', String(error));
      } finally {
        inFlight = false;
      }
    };

    void poll();
    timer = window.setInterval(() => void poll(), intervalMs);
    return stop;
  }, [enabled, workspacePath, accessToken, gatewayUrl, intervalMs]);
}
