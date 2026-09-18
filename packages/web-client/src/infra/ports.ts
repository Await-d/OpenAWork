/**
 * `/sessions/ports/listening` 客户端：列出网关网络命名空间内的 TCP 监听端口。
 *
 * 路径刻意挂在 `/sessions/` 前缀下：`apps/web/nginx.conf` 只把 `/api/`、`/auth/`、
 * `/sessions/` 转发给网关，裸 `/ports/...` 会被 SPA 回退
 * （`location /` → `try_files ... /index.html`）吃掉。后续代理阶段新增
 * `location /ports/` 时再评估迁移。
 *
 * 枚举本身是只读的：调用方拿到 `strategy === null` 或带 `reason` 的快照时，
 * 应当把它当「当前环境不支持/降级」而不是错误。
 */

import {
  authHeader,
  extractJsonErrorMessage,
  fetchWithTimeout,
  HttpError,
  isGenericFetchErrorMessage,
  readJsonErrorData,
} from '../gateway/http.js';

export type ListeningPortSource = 'procfs' | 'lsof' | 'powershell';

/** 端口 → 终端归属引用；只有归属成功时才有值。 */
export interface ListeningPortTerminalRef {
  sessionId: string;
  terminalId: string;
}

export interface ListeningPortView {
  port: number;
  protocol: 'tcp' | 'tcp6';
  /** `127.0.0.1` / `0.0.0.0` / `::1` / `::` —— UI 据此标注「仅本机 / 全网可达」。 */
  bindAddress: string;
  /** best-effort：读不到进程信息时为 null，不是错误。 */
  pid: number | null;
  processName: string | null;
  source: ListeningPortSource;
  /**
   * 该监听端口的 ESTABLISHED 连接数；`null` = 当前策略无法统计（非 linux/procfs），
   * **不是 0**。非 null 时也是网关最近一次快照（≤5s 缓存，与轮询间隔同源）的时点值，
   * 不是实时值 —— UI 不得据此宣称「当前有 N 条连接」。
   */
  establishedConnections: number | null;
  /**
   * 监听进程是否仍存在；`null` = 无法判断（pid 未知 / 权限不足 / 瞬时 IO 失败），
   * **不是 false**。消费方只在 `=== false` 时提示「已退出」，`null` 什么都不显示
   * （原因放 title）—— 把活着的进程渲染成已退出比不显示更糟。
   */
  processAlive: boolean | null;
  /**
   * 该监听进程归属的终端；`null` = 「无法归属到你的终端」（不是错误）。
   *
   * 只有非 null 时才允许走既有的
   * `POST /sessions/:sessionId/terminals/:terminalId/kill`（该路由自带用户与会话
   * 双重校验）。`null` 的常见原因：进程不是本网关为当前用户拉起的终端的后代、
   * pid 未知、平台不支持归属（非 linux/procfs）——消费方不得回退成「按 pid 终止」。
   */
  terminal: ListeningPortTerminalRef | null;
}

export interface ListeningPortsSnapshotView {
  ports: ListeningPortView[];
  /** 本次枚举实际使用的策略；不可用时为 null 并提供 reason。 */
  strategy: ListeningPortSource | null;
  /**
   * 服务端本次快照是否真的做过归属判定（仅 linux/procfs + 登录用户为 true）。
   * 这是「`terminal === null` 能不能解读为外部进程」的唯一权威判据：**不得**用
   * `strategy` 名称自行推断；为 false 时那些行只能显示「归属不可用」，绝不能说成
   * 外部进程。
   */
  attributionSupported: boolean;
  /** 降级原因（超时 / 无权限 / 平台不支持），供 UI 说明。 */
  reason?: string;
  collectedAtMs: number;
}

export interface ListeningPortsClient {
  list(token: string, options?: { signal?: AbortSignal }): Promise<ListeningPortsSnapshotView>;
}

interface ListeningPortsErrorData {
  error?: string;
  message?: string;
}

function buildListErrorMessage(status: number, data: ListeningPortsErrorData | undefined): string {
  if (status === 401 || status === 403 || data?.error === 'unauthorized') {
    return '认证失效或当前账号无权读取监听端口。';
  }
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 404) {
    return '目标网关不支持端口枚举接口，请升级网关后重试。';
  }
  return `读取监听端口失败（HTTP ${status}）。`;
}

function normalizeListError(error: unknown): Error {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericFetchErrorMessage(message)) {
      return error;
    }
  }
  return new Error('网络异常，读取监听端口失败。');
}

export function createListeningPortsClient(baseUrl: string): ListeningPortsClient {
  return {
    async list(token, options) {
      const init: RequestInit = { headers: authHeader(token) };
      if (options?.signal) init.signal = options.signal;
      try {
        const response = await fetchWithTimeout(`${baseUrl}/sessions/ports/listening`, init);
        if (!response.ok) {
          const data = await readJsonErrorData<ListeningPortsErrorData>(response);
          throw new HttpError(buildListErrorMessage(response.status, data), response.status, data);
        }
        return (await response.json()) as ListeningPortsSnapshotView;
      } catch (error) {
        throw normalizeListError(error);
      }
    },
  };
}
