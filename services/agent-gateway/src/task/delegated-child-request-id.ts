import { createHash } from 'node:crypto';

/**
 * 子会话请求键构造（task 委派路径共用）。
 *
 * 历史上定义在 `tools/call-omo-agent-output.ts`，但与 `call_omo_agent` 工具无关：
 * `task` / `subagent` 派发（`tools/sandbox/task-reference.ts`）同样依赖它。因此
 * 在移除 `call_omo_agent` 入口时，该函数必须**搬迁**到 task 域，而非随文件删除。
 *
 * 键形状恒为 `task:<parentClientRequestId>:child:<childSessionId>`；一旦超过
 * 128 字符即收敛为摘要，保证结果恒 <= 128。
 */

const MAX_CLIENT_REQUEST_ID_LENGTH = 128;
const DIGEST_LENGTH = 32;

function digestPrefix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, DIGEST_LENGTH);
}

export function buildDelegatedChildClientRequestId(input: {
  childSessionId: string;
  parentClientRequestId?: string;
}): string {
  const parentClientRequestId = input.parentClientRequestId ?? 'child';
  const legacyId = `task:${parentClientRequestId}:child:${input.childSessionId}`;
  if (legacyId.length <= MAX_CLIENT_REQUEST_ID_LENGTH) {
    return legacyId;
  }

  const parentDigest = digestPrefix(`${parentClientRequestId}\u0000${input.childSessionId}`);
  const hashedParentId = `task:${parentDigest}:child:${input.childSessionId}`;
  if (hashedParentId.length <= MAX_CLIENT_REQUEST_ID_LENGTH) {
    return hashedParentId;
  }

  // 最终兜底：childSessionId 本身超长时同样收敛为摘要，保证结果恒 <= 128。
  return `task:${parentDigest}:child:${digestPrefix(input.childSessionId)}`;
}
