import { z } from 'zod';

export type MessageType =
  | 'request' // 请求（需要响应）
  | 'response' // 响应（回复某个请求）
  | 'broadcast' // 广播（通知所有成员）
  | 'handoff' // 任务交接
  | 'escalation' // 升级到人工
  | 'update' // 状态更新（兼容旧类型）
  | 'question' // 提问（兼容旧类型）
  | 'result' // 结果（兼容旧类型）
  | 'error'; // 错误（兼容旧类型）

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TeamMessage {
  id: string;
  from: string; // 发送者 ID
  to?: string | string[]; // 接收者（支持单播和广播）
  replyTo?: string; // 回复消息 ID
  threadId?: string; // 会话线程 ID
  content: string;
  structuredData?: unknown; // 结构化载荷
  type: MessageType;
  priority: MessagePriority;
  requiresAck?: boolean; // 是否需要确认
  timestamp: number;
  expiresAt?: number; // 消息过期时间

  // 保留兼容字段（标记为废弃）
  /** @deprecated 使用 from 替代 */
  memberId?: string;
}

const TeamMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.union([z.string(), z.array(z.string())]).optional(),
  replyTo: z.string().optional(),
  threadId: z.string().optional(),
  content: z.string(),
  structuredData: z.unknown().optional(),
  type: z.enum([
    'request',
    'response',
    'broadcast',
    'handoff',
    'escalation',
    'update',
    'question',
    'result',
    'error',
  ]),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  requiresAck: z.boolean().optional(),
  timestamp: z.number(),
  expiresAt: z.number().optional(),
  memberId: z.string().optional(), // deprecated
});

export function validateTeamMessage(data: unknown): TeamMessage {
  try {
    return TeamMessageSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];
      throw new Error(
        `TeamMessage 验证失败: ${firstIssue?.path.join('.')} - ${firstIssue?.message}`,
      );
    }
    throw error;
  }
}
