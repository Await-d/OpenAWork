import type { Message } from '@openAwork/shared';

const INTERNAL_CLIENT_REQUEST_ID_KEY = '__openAworkClientRequestId';

function isAssistantUiEventText(value: string): boolean {
  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { source?: unknown; type?: unknown };
    return parsed.type === 'assistant_event' && parsed.source === 'openawork_internal';
  } catch {
    return false;
  }
}

function extractMessageText(message: Message): string {
  return message.content
    .filter(
      (content): content is Extract<Message['content'][number], { type: 'text' }> =>
        content.type === 'text',
    )
    .map((content) => content.text)
    .join('\n')
    .trim();
}

function isIgnorableAssistantUiEventMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.content.length === 0) {
    return false;
  }

  return message.content.every((content) => {
    if (content.type !== 'text') {
      return false;
    }

    const text = content.text.trim();
    return text.length === 0 || isAssistantUiEventTextForMessage(text, message);
  });
}

function isAssistantUiEventTextForMessage(value: string, message: Message): boolean {
  if (isAssistantUiEventText(value)) {
    return true;
  }

  const clientRequestId = (message as Message & { [INTERNAL_CLIENT_REQUEST_ID_KEY]?: unknown })[
    INTERNAL_CLIENT_REQUEST_ID_KEY
  ];
  if (typeof clientRequestId !== 'string') {
    return false;
  }

  if (
    !clientRequestId.startsWith('assistant_event:') &&
    !clientRequestId.startsWith('task-reminder:')
  ) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { type?: unknown };
    return parsed.type === 'assistant_event';
  } catch {
    return false;
  }
}

function normalizeExtractedChildSummary(value: string): string {
  return value.replace(/^\[(?:错误|Error):\s*[^\]]+\]\s*/iu, '').trim();
}

/**
 * 扫描窗口（与参考库一致）。
 *
 * 参考库 `subagent-job.ts:44-52` 用 `sessions.messages({ order:'desc', limit:20 })`
 * 只在**最近 20 条**消息里找最终 assistant 文本；这里保持同一窗口，
 * 避免回溯到与本次运行无关的更早历史消息。
 */
const RECENT_MESSAGE_SCAN_LIMIT = 20;

/**
 * 提取子会话的最终总结（对齐参考库 `SubagentCompletion.text` 的选取口径）：
 * 在**最近 20 条**消息里从后往前找第一条有文本的 assistant 消息。
 *
 * 调用方应传已完成的消息集合（`statuses: ['final']`）——参考库同样跳过
 * `error !== undefined` 的 assistant 消息，失败场景由 `errorSummary` 兜底。
 */
export function extractLatestChildSessionSummary(messages: Message[]): string {
  const recent = messages.slice(-RECENT_MESSAGE_SCAN_LIMIT);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    if (isIgnorableAssistantUiEventMessage(message)) {
      continue;
    }

    const text = extractMessageText(message);
    if (text.length > 0) {
      return normalizeExtractedChildSummary(text);
    }
  }

  return '';
}
