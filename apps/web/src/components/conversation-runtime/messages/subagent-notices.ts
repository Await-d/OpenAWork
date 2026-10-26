import { parseSyntheticNotice } from '@openAwork/shared';
import type { Message, MessageRole, SubagentNotice } from '@openAwork/shared';
import { getComparableCreatedAt } from './message-coercion.js';

/**
 * 从网关返回的原始会话行中收集「网关注入通知」（子代理完成 / 定时任务结果）。
 *
 * 语义（visible 规则、状态回落、来源兜底）**不在本文件实现**——这里只做
 * 「原始行 → Message 形状」的适配，然后委托 `@openAwork/shared` 的
 * `parseSyntheticNotice`，以保证 Web / 桌面 / 未来消费方共用同一份 SSOT。
 *
 * 注意：`normalizeChatMessages` 会把 `role: 'synthetic'` 排除在 transcript 之外
 * （它不是用户输入，不得渲染为聊天气泡），因此通知必须走这条独立通道。
 *
 * 必须用 `parseSyntheticNotice` 而非旧的 `parseSubagentNotice`：后者只认
 * `source: 'subagent'`，会把定时任务结果投递（`source: 'cron'`）静默丢弃——
 * 任务明明投递成功了，用户却什么都看不到。
 */

const MESSAGE_ROLES: readonly MessageRole[] = ['user', 'assistant', 'tool', 'system', 'synthetic'];

function isMessageRole(value: unknown): value is MessageRole {
  return typeof value === 'string' && MESSAGE_ROLES.some((role) => role === value);
}

function readMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** 把原始行适配成 `Message` 形状；缺少必要字段时返回 null。 */
function toMessageShape(record: Record<string, unknown>): Message | null {
  const id = record['id'];
  const role = record['role'];
  if (typeof id !== 'string' || id.length === 0 || !isMessageRole(role)) {
    return null;
  }

  const content = Array.isArray(record['content']) ? (record['content'] as Message['content']) : [];
  // 与消息侧同口径解析（数字毫秒或 ISO 串）；畸形值回落 0——确定性优先，
  // 避免每次快照重算把通知挪到列表末尾。
  const createdAt =
    getComparableCreatedAt(
      typeof record['createdAt'] === 'number' || typeof record['createdAt'] === 'string'
        ? record['createdAt']
        : undefined,
    ) ?? 0;
  const description = record['description'];
  const metadata = readMetadata(record['metadata']);

  return {
    id,
    role,
    content,
    createdAt,
    ...(typeof description === 'string' ? { description } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/** 按出现顺序收集子代理完成通知；非通知行被忽略。 */
export function collectSubagentNotices(rawMessages: unknown): SubagentNotice[] {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  const notices: SubagentNotice[] = [];
  for (const rawMessage of rawMessages) {
    if (!rawMessage || typeof rawMessage !== 'object') {
      continue;
    }
    const message = toMessageShape(rawMessage as Record<string, unknown>);
    if (!message) {
      continue;
    }
    const notice = parseSyntheticNotice(message);
    if (notice) {
      notices.push(notice);
    }
  }
  return notices;
}
