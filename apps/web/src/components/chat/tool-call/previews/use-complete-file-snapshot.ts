import { useEffect, useRef, useState } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { matchFileDiff, toCompleteSnapshot, type CompleteFileSnapshot } from './match-file-diff.js';

/**
 * 「按需加载完整文件快照」的状态机。
 *
 * ## 为什么需要它
 *
 * 网关 `/recovery` 会把每个字符串叶子瘦到 `SLIM_STRING_MAX`（8000）并追加
 * `…[truncated, N chars omitted]`。对写入类工具来说，`before` / `after` 双双被截成
 * 前缀，于是 `+1/-1` 的真实改动在 UI 上可能显示成 `+0/-0`——「文件根本没变」。
 * 前端的既有策略是「用可用前缀画部分 diff + 标注省略了多少字符」，但它**永远
 * 拿不到完整内容**。
 *
 * 完整数据通道本来就有：`GET /sessions/:id/file-changes?includeText=true` 返回
 * `fileDiffs[]` 的完整 `before` / `after`（读 `session_file_diffs` + 备份文件，不裁剪）。
 * 这个 hook 就是那条通道的**显式**入口。
 *
 * ## 硬约束
 *
 * - **绝不在挂载时自动取数**。一个会话的完整 diff 可能是几 MB，自动拉等于把
 *   「打开历史消息」变成「下载全部文件内容」。只有用户点按钮才发请求。
 * - 同一个 `filePath` 只请求一次（`cache` 命中即直接切到 `loaded`）。
 * - 卸载 / 重新加载时中止在途请求，并**吞掉 abort**（它不是错误）；真实错误必须
 *   冒到 UI，不能让按钮永远转圈。
 */
export type CompleteFileSnapshotStatus = 'idle' | 'loading' | 'error' | 'loaded';

export interface UseCompleteFileSnapshotResult {
  /** 当前 `filePath` 对应的完整快照；仅 `status === 'loaded'` 时非空。 */
  snapshot: CompleteFileSnapshot | null;
  error: string | null;
  status: CompleteFileSnapshotStatus;
  /**
   * 显式触发一次加载（缓存命中时不发请求）。
   *
   * `toolCallId` 用于**消歧**：同一会话里反复编辑同一文件会产生多条同 `file` 的
   * `session_file_diffs` 记录（实测 37.4% 的记录处于这种组里），只按路径匹配会
   * 判成歧义并失败。带上工具调用 id 才能精确归位到「这一次写入」。
   */
  load: (filePath: string, toolCallId?: string) => void;
  /** 回到初始态（中止在途请求，保留缓存）。 */
  reset: () => void;
}

interface SnapshotState {
  error: string | null;
  snapshot: CompleteFileSnapshot | null;
  status: CompleteFileSnapshotStatus;
}

const INITIAL_STATE: SnapshotState = {
  error: null,
  snapshot: null,
  status: 'idle',
};

/** 定位失败 / 内容缺失用独立错误类型，便于把文案与网络错误区分开。 */
class CompleteSnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompleteSnapshotUnavailableError';
  }
}

export function useCompleteFileSnapshot(
  sessionId: string | undefined,
): UseCompleteFileSnapshotResult {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const [state, setState] = useState<SnapshotState>(INITIAL_STATE);
  const [cache, setCache] = useState<Record<string, CompleteFileSnapshot>>({});
  const abortRef = useRef<AbortController | null>(null);

  // 卸载即中止：否则用户切走会话后回调仍会 setState（React 会告警，且白占连接）。
  useEffect(() => () => abortRef.current?.abort(), []);

  const load = (filePath: string, toolCallId?: string) => {
    const cacheKey = `${toolCallId ?? ''}\u0000${filePath}`;
    const cached = cache[cacheKey];
    if (cached) {
      setState({ error: null, snapshot: cached, status: 'loaded' });
      return;
    }
    if (!sessionId || !token) {
      setState({
        error: '缺少会话上下文，无法加载完整内容',
        snapshot: null,
        status: 'error',
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ error: null, snapshot: null, status: 'loading' });
    void runCompleteSnapshotLoad({
      filePath,
      toolCallId,
      gatewayUrl,
      sessionId,
      token,
      signal: controller.signal,
      onLoaded: (snapshot) => {
        setCache((prev) => ({ ...prev, [cacheKey]: snapshot }));
        setState({ error: null, snapshot, status: 'loaded' });
      },
      onFailed: (message) => {
        setState({ error: message, snapshot: null, status: 'error' });
      },
    });
  };

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  };

  return { snapshot: state.snapshot, error: state.error, status: state.status, load, reset };
}

/**
 * 取数与错误归一的整段逻辑刻意放在**模块级普通函数**里：`try/catch` 是 React
 * Compiler 的能力缺口，留在组件 / hook 内会让整个函数退出优化（见 `apps/web/AGENTS.md`）。
 */
async function runCompleteSnapshotLoad(args: {
  filePath: string;
  toolCallId?: string | undefined;
  gatewayUrl: string;
  sessionId: string;
  token: string;
  signal: AbortSignal;
  onLoaded: (snapshot: CompleteFileSnapshot) => void;
  onFailed: (message: string) => void;
}): Promise<void> {
  try {
    const snapshot = await fetchCompleteSnapshot(args);
    if (args.signal.aborted) return;
    args.onLoaded(snapshot);
  } catch (error) {
    if (args.signal.aborted || isAbortError(error)) return;
    const message = describeLoadError(error);
    args.onFailed(message);
  }
}

async function fetchCompleteSnapshot(args: {
  filePath: string;
  toolCallId?: string | undefined;
  gatewayUrl: string;
  sessionId: string;
  token: string;
  signal: AbortSignal;
}): Promise<CompleteFileSnapshot> {
  const projection = await createSessionsClient(args.gatewayUrl).getFileChanges(
    args.token,
    args.sessionId,
    { includeText: true, signal: args.signal },
  );
  const entry = matchFileDiff(projection.fileDiffs, args.filePath, args.toolCallId);
  if (!entry) {
    throw new CompleteSnapshotUnavailableError('未能定位该文件的完整快照');
  }
  const snapshot = toCompleteSnapshot(entry);
  if (!snapshot) {
    throw new CompleteSnapshotUnavailableError('网关未返回该文件的完整内容');
  }
  return snapshot;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError';
  return error instanceof Error && error.name === 'AbortError';
}

function describeLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return '加载完整内容失败';
}
