import type { SubagentNoticeMetadata } from '@openAwork/shared';
import { appendSessionMessageV2, findMessageV2 } from '../message/message-v2-adapter.js';

/**
 * 合成消息注入（opencode `sessions.synthetic` 的对应物）。
 *
 * 语义严格对齐上游 `session/session.ts` 的 `synthetic`：
 *   - **只入库，不唤醒执行体**（唤醒由独立的 `wakeSession` 负责）；
 *   - **按通知身份幂等**：`notificationId` 直接作为消息 id，重复投递是空操作；
 *   - 消息角色为 `'synthetic'`，对模型可见（下发上游时降级为 `user`），
 *     但客户端不得按用户输入渲染。
 */

export interface InjectSyntheticSessionMessageInput {
  sessionId: string;
  userId: string;
  /** 通知身份；同时作为消息 id 保证幂等（对齐上游 `id: notificationID`）。 */
  notificationId: string;
  /** 通知正文；空正文会让消息在读取侧被过滤，调用方应保证非空。 */
  text: string;
  /** 通知短标签；`failed` 状态允许为空（客户端强制可见）。 */
  description?: string;
  metadata: SubagentNoticeMetadata;
}

export interface InjectSyntheticSessionMessageResult {
  messageId: string;
  /** `false` 表示该通知此前已投递（幂等命中，未重复写入）。 */
  created: boolean;
}

/** 幂等注入一条网关合成消息；返回是否真正新建。 */
export function injectSyntheticSessionMessage(
  input: InjectSyntheticSessionMessageInput,
): InjectSyntheticSessionMessageResult {
  const existing = findMessageV2({
    sessionId: input.sessionId,
    userId: input.userId,
    predicate: (message) => message.info.id === input.notificationId,
  });
  if (existing) {
    return { messageId: existing.info.id, created: false };
  }

  const message = appendSessionMessageV2({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'synthetic',
    messageId: input.notificationId,
    // 自带请求身份：使该行可被既有「按请求作用域清理」链路识别（回滚角色过滤已含 synthetic）。
    clientRequestId: input.notificationId,
    content: [{ type: 'text', text: input.text, synthetic: true }],
    ...(input.description ? { description: input.description } : {}),
    metadata: input.metadata,
  });

  return { messageId: message.id, created: true };
}
