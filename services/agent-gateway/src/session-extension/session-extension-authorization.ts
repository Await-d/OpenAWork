/**
 * 会话扩展的**独立授权门**。
 *
 * 这是本能力最关键的安全设施，位置刻意与普通工具权限**分离**：
 *
 * 1. 普通权限阶梯（`tools/sandbox/permission-ladder.ts`）里存在多个「免审批捷径」：
 *    `yolo` 档位、team 后台成员、渠道 `channel-policy` 自动批准、`auto-edit` 的文件
 *    类自动放行、以及 `ALLOW_BY_DEFAULT` / 作用域级永久授权。这些都**不得**成为
 *    扩展变更的放行依据——一次「永久允许」不该等于「此后可以随便装 skill / MCP」。
 * 2. 显式 `deny` 仍然优先：本模块只做「是否允许进入提案流程」，不覆盖 deny。
 * 3. 渠道会话只允许 `scope: 'session'`，且要求渠道配置显式开启。
 */

import type { SessionExtensionScope } from './session-extension-contract.js';
import {
  isDescendantSessionOrigin,
  type SessionExtensionOrigin,
} from './session-extension-origin.js';

export interface SessionExtensionProposalRequest {
  readonly origin: SessionExtensionOrigin;
  /** 请求的生效范围；默认按会话级处理。 */
  readonly requestedScope?: SessionExtensionScope;
}

export interface SessionExtensionProposalDecision {
  readonly allowed: boolean;
  /** 实际生效范围：渠道恒为 `session`。 */
  readonly effectiveScope: SessionExtensionScope;
  readonly denialReason: string | null;
}

/**
 * 判定「这个会话能否为扩展变更创建提案」。
 *
 * 注意语义：**允许创建提案 ≠ 变更已生效**。渠道场景下这里只是把请求送进待审批
 * 队列，真正的改动要等管理员确认。
 */
export function resolveSessionExtensionProposalDecision(
  request: SessionExtensionProposalRequest,
): SessionExtensionProposalDecision {
  const { origin } = request;
  const requestedScope = request.requestedScope ?? (origin.source === 'web' ? 'user' : 'session');

  // 派生子会话（task 子代理）只读：可以查状态，不能建提案。见
  // `isDescendantSessionOrigin` 的说明——子代理在后台无人交互，且易被用户粘贴的
  // 文本当成安装指令。
  if (isDescendantSessionOrigin(origin)) {
    return {
      allowed: false,
      effectiveScope: 'session',
      denialReason:
        '子代理会话不允许变更扩展配置。请回到发起对话的会话中操作（子代理仍可读取扩展状态）。',
    };
  }

  if (origin.source === 'team') {
    return {
      allowed: false,
      effectiveScope: 'session',
      denialReason: '团队会话后台运行、无人审批，不允许变更扩展配置。',
    };
  }

  if (origin.source === 'cron') {
    return {
      allowed: false,
      effectiveScope: 'session',
      denialReason: '定时任务会话无人审批，不允许变更扩展配置。',
    };
  }

  if (origin.source === 'unknown') {
    return {
      allowed: false,
      effectiveScope: 'session',
      denialReason: '当前会话来源不可识别，已拒绝扩展变更。',
    };
  }

  if (origin.source === 'channel') {
    if (!origin.managementEnabled) {
      return {
        allowed: false,
        effectiveScope: 'session',
        denialReason:
          '当前渠道未开启会话扩展管理。请在渠道设置中显式开启后重试（默认关闭以保护既有配置）。',
      };
    }
    if (requestedScope !== 'session') {
      return {
        allowed: false,
        effectiveScope: 'session',
        denialReason: '消息渠道只能为当前会话变更扩展，不能修改用户级配置。',
      };
    }
    return { allowed: true, effectiveScope: 'session', denialReason: null };
  }

  // 个人会话：沿用既有语义，用户级与会话级都允许（用户级仍走既有审批）。
  return { allowed: true, effectiveScope: requestedScope, denialReason: null };
}

/**
 * 提案内容一致性校验：审批时看到的摘要必须与执行时一致。
 *
 * 配置 / revision 在审批后发生变化（另一端点改了、或内容被替换）时必须重新审批，
 * 否则会出现「审批 A、执行 B」。
 */
export function isApprovedContentStillCurrent(params: {
  approvedDigest: string | null;
  currentDigest: string | null;
  approvedRevision: number | null;
  currentRevision: number;
}): boolean {
  if (params.approvedDigest !== params.currentDigest) return false;
  if (params.approvedRevision === null) return true;
  return params.approvedRevision === params.currentRevision;
}
