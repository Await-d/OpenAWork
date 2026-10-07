/**
 * 文件预览的 SSH 读取身份：把「单一身份」升级为「有序候选 + 跨主机回退」。
 *
 * 背景（SSH 开发场景）：网关运行在 Windows，而会话工作区是 SSH 远端的
 * POSIX 路径。网关解析预览身份时 `sessionId` 优先、`sshConnectionId` 次之，
 * 二者同时出现时只看 `sessionId`；一旦该会话的 SSH 绑定解析为 `unbound`，
 * 网关就回落到本地路径校验，对 POSIX 路径直接 400
 * （「当前网关运行在 Windows，无法访问 POSIX 路径：…」），预览彻底打不开，
 * 且客户端没有任何退路。
 *
 * 因此前端按优先级给出身份候选列表：先按会话身份读，**只有**在确认失败是
 * 「跨主机路径不兼容」（而不是 404 / 403 这类确定性失败）时，才换用 SSH 连接
 * 身份重试一次。既恢复了 SSH 远端预览，又不会把真实故障重试成噪音。
 */

import { HttpError, type WorkspaceFileReadOptions } from '@openAwork/web-client';
import type { WorkspaceReadIdentity } from '../../stores/ui/uiState.js';

/**
 * 是否为「网关与路径不在同一操作系统」的失败。
 *
 * 与 `WorkspaceFileTreePanel` 的 `isPathIncompatibleError` 同一判据（依赖网关
 * `assertWorkspacePathSupportedByCurrentHost` 的稳定文案），额外在拿到
 * `HttpError` 时收紧为 400，避免把其它 4xx 误判成可回退的身份问题。
 */
export function isCrossHostPathError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  if (!message.includes('无法访问') || !message.includes('路径')) {
    return false;
  }
  return error instanceof HttpError ? error.status === 400 : true;
}

/**
 * 按优先级构造预览读取候选：会话身份优先，其次 SSH 连接身份。
 *
 * 恒返回至少一个候选——身份全为空时就是「纯本地读取」，请求参数与改动前
 * 逐字节一致。
 */
export function buildPreviewReadAttempts(
  workspaceRoot: string | null | undefined,
  identity: WorkspaceReadIdentity | null | undefined,
): WorkspaceFileReadOptions[] {
  const trimmedRoot = workspaceRoot?.trim() ?? '';
  const base: WorkspaceFileReadOptions =
    trimmedRoot.length > 0 ? { workspaceRoot: trimmedRoot } : {};

  const sessionId = identity?.sessionId ?? null;
  const sshConnectionId = identity?.sshConnectionId ?? null;

  const attempts: WorkspaceFileReadOptions[] = [];
  if (sessionId !== null) {
    attempts.push({ ...base, sessionId });
    // 会话 SSH 绑定解析为 unbound 时的退路：换用连接身份直接读远端。
    if (sshConnectionId !== null && sshConnectionId !== sessionId) {
      attempts.push({ ...base, sshConnectionId });
    }
    return attempts;
  }

  if (sshConnectionId !== null) {
    attempts.push({ ...base, sshConnectionId });
    return attempts;
  }

  attempts.push({ ...base });
  return attempts;
}

/**
 * 依次尝试候选身份执行读取，仅在「跨主机路径不兼容」时换用下一个候选。
 *
 * 错误归属分两种情况：
 * - 主路径就确定性失败（404 / 403 等，未发生回退）：直接上抛该错误。
 * - 主路径因跨主机失败而回退过：此后无论回退候选怎么失败，都上抛**首个跨主机
 *   错误**。那是用户操作失效的根因（连接断线之类只是退路也不通，不该覆盖它）。
 */
export async function runWithReadIdentityFallback<T>(
  attempts: readonly WorkspaceFileReadOptions[],
  run: (options: WorkspaceFileReadOptions) => Promise<T>,
): Promise<T> {
  let crossHostError: unknown;
  let hasCrossHostError = false;

  for (const options of attempts) {
    try {
      return await run(options);
    } catch (error) {
      if (!isCrossHostPathError(error)) {
        if (hasCrossHostError) {
          throw crossHostError;
        }
        throw error;
      }
      if (!hasCrossHostError) {
        crossHostError = error;
        hasCrossHostError = true;
      }
    }
  }

  throw crossHostError;
}
