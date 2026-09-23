import { parseSubagentNotice, SUBAGENT_NOTICE_DEFAULT_AGENT } from '@openAwork/shared';
import type { Message, SubagentNotice, SubagentNoticeState } from '@openAwork/shared';

export interface MobileChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  inputImages?: MobileInputImage[];
  reasoningBlocks?: string[];
  /** 该消息（assistant trace）关联的回合键，用于回退时定位受影响快照。 */
  clientRequestIds?: string[];
  /** 消息创建时间（毫秒）；用于按时间过滤受影响快照，缺失时不参与过滤。 */
  createdAtMs?: number;
}

export interface MobileInputImage {
  artifactId?: string;
  fileName?: string;
  imageUrl?: string;
  mimeType?: string;
}

export type MobileSubagentNoticeState = SubagentNoticeState;

/**
 * 子代理完成通知的移动端形状。
 *
 * **直接复用 `@openAwork/shared` 的 SSOT 类型**（Web / 桌面 / 移动三端同一份语义），
 * 移动端只负责「原始行 → `Message` 形状」的适配，可见性规则不在本文件实现。
 */
export type MobileSubagentNotice = SubagentNotice;

/** 子代理名缺失时的中性占位（与 shared / shared-ui 共用同一常量）。 */
export const DEFAULT_SUBAGENT_AGENT = SUBAGENT_NOTICE_DEFAULT_AGENT;

export function normalizeMobileChatMessages(rawMessages: unknown): MobileChatMessage[] {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  const seenIds = new Set<string>();
  return rawMessages.flatMap((rawMessage) => {
    const normalized = normalizeMobileChatMessage(rawMessage);
    if (!normalized || seenIds.has(normalized.id)) {
      return [];
    }
    seenIds.add(normalized.id);
    return [normalized];
  });
}

export function extractRuntimeTextDelta(value: unknown): string {
  return collectTextFragments(value).join('');
}

export function extractRuntimeThinkingDelta(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  return collectReasoningFragments(value).join('');
}

/** 把原始行适配成 `Message` 形状；`content` 只取 text part 拼接（其它 part 一律忽略）。 */
function toSubagentNoticeMessage(record: Record<string, unknown>, id: string): Message {
  const parts = Array.isArray(record['content']) ? record['content'] : [];
  const text = parts
    .flatMap((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        return [];
      }
      const partRecord = part as Record<string, unknown>;
      return partRecord['type'] === 'text' && typeof partRecord['text'] === 'string'
        ? [partRecord['text']]
        : [];
    })
    .join('\n')
    .trim();

  const description = record['description'];
  const metadata = record['metadata'];

  return {
    id,
    role: 'synthetic',
    content: text.length > 0 ? [{ type: 'text', text }] : [],
    createdAt: 0,
    ...(typeof description === 'string' ? { description } : {}),
    ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { metadata: metadata as Record<string, unknown> }
      : {}),
  };
}

/**
 * 从网关返回的原始会话行解析「子代理完成通知」；不是通知时返回 `null`。
 *
 * **语义不在本文件实现**：只做「原始行 → `Message` 形状」适配，然后委托
 * `@openAwork/shared` 的 `parseSubagentNotice`（Web / 桌面 / 移动三端同一份 SSOT），
 * 避免可见性规则在三端漂移。
 *
 * 测试环境通过 `apps/mobile/vitest.config.ts` 把 `@openAwork/shared` 别名到源码，
 * 因此纯逻辑单测不依赖 `dist/` 构建顺序。
 */
export function parseMobileSubagentNotice(rawMessage: unknown): MobileSubagentNotice | null {
  if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
    return null;
  }

  const record = rawMessage as Record<string, unknown>;
  if (record['role'] !== 'synthetic') {
    return null;
  }

  const id = record['id'];
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }

  // 语义（可见性规则、状态回落、agent 兜底）统一由 `@openAwork/shared` 的
  // `parseSubagentNotice` 决定，移动端只做输入形状适配，避免三端语义漂移。
  return parseSubagentNotice(toSubagentNoticeMessage(record, id));
}

/** 按出现顺序收集子代理完成通知；非通知行被忽略。 */
export function collectMobileSubagentNotices(rawMessages: unknown): MobileSubagentNotice[] {
  if (!Array.isArray(rawMessages)) {
    return [];
  }

  return rawMessages.flatMap((rawMessage) => {
    const notice = parseMobileSubagentNotice(rawMessage);
    return notice ? [notice] : [];
  });
}

/**
 * 合并两次「通知快照」：已展示的保持原顺序，新出现的按 `incoming` 顺序追加；
 * 同一 id（通知身份 `task-job:<child>:<updatedAt>`）只保留一份，以 `incoming` 为准。
 *
 * 实时通道会在流式期间反复重算同一会话的通知列表（子代理结算事件 + 流结束），
 * 因此合并必须**幂等**：重复解析不会产生重复行，也不会因为一次残缺快照丢掉
 * 已经展示过的通知。非对象 / 缺 id 的脏数据直接跳过（历史加载已经做过一次
 * 校验，这里是防御性兜底）。
 */
export function mergeMobileSubagentNotices(
  existing: readonly (MobileSubagentNotice | null | undefined)[] | null | undefined,
  incoming: readonly (MobileSubagentNotice | null | undefined)[] | null | undefined,
): MobileSubagentNotice[] {
  const merged: MobileSubagentNotice[] = [];
  const indexById = new Map<string, number>();

  for (const notice of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!notice || typeof notice.id !== 'string' || notice.id.length === 0) {
      continue;
    }

    const knownIndex = indexById.get(notice.id);
    if (knownIndex === undefined) {
      indexById.set(notice.id, merged.length);
      merged.push(notice);
      continue;
    }

    merged[knownIndex] = notice;
  }

  return merged;
}

/**
 * 归一化消息创建时间：网关主路径是毫秒 epoch（`session_messages.created_at_ms`），
 * 但历史数据 / 兼容路径可能是 ISO 字符串——两种都要接受，否则会退化成
 * 「无时间信息 → 全部快照成为影响面」（影响面与恢复基线双双放大）。
 */
function toCreatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeMobileChatMessage(rawMessage: unknown): MobileChatMessage | null {
  if (!rawMessage || typeof rawMessage !== 'object') {
    return null;
  }

  const record = rawMessage as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  // Transcript roles. `synthetic` (gateway-injected subagent completion
  // notices) is intentionally excluded: it is not user input and must not
  // render as a chat bubble. Mobile surfaces it through the dedicated notice
  // channel instead of the transcript.
  const role =
    record['role'] === 'user' || record['role'] === 'assistant' || record['role'] === 'tool'
      ? record['role']
      : null;

  if (!id || !role) {
    return null;
  }

  const normalizedContent = normalizeMobileMessageContent(record['content']);
  if (
    normalizedContent.content.length === 0 &&
    (normalizedContent.inputImages?.length ?? 0) === 0 &&
    (normalizedContent.reasoningBlocks?.length ?? 0) === 0
  ) {
    return null;
  }

  const rawClientRequestId =
    typeof record['clientRequestId'] === 'string' && record['clientRequestId'].length > 0
      ? record['clientRequestId']
      : null;
  const clientRequestIds = [
    ...(rawClientRequestId ? [rawClientRequestId] : []),
    ...(normalizedContent.clientRequestIds ?? []),
  ].filter((requestId, index, items) => items.indexOf(requestId) === index);

  const rawCreatedAt = record['createdAt'];
  const createdAtMs = toCreatedAtMs(rawCreatedAt);

  return {
    id,
    role: role === 'user' ? 'user' : 'assistant',
    content: normalizedContent.content,
    ...(normalizedContent.inputImages && normalizedContent.inputImages.length > 0
      ? { inputImages: normalizedContent.inputImages }
      : {}),
    ...(normalizedContent.reasoningBlocks && normalizedContent.reasoningBlocks.length > 0
      ? { reasoningBlocks: normalizedContent.reasoningBlocks }
      : {}),
    ...(clientRequestIds.length > 0 ? { clientRequestIds } : {}),
    ...(createdAtMs !== undefined ? { createdAtMs } : {}),
  };
}

function normalizeMobileMessageContent(content: unknown): {
  content: string;
  inputImages?: MobileInputImage[];
  reasoningBlocks?: string[];
  clientRequestIds?: string[];
} {
  if (typeof content === 'string') {
    const assistantTrace = parseAssistantTraceContent(content);
    if (assistantTrace) {
      return {
        content: buildAssistantTraceText(assistantTrace),
        ...(assistantTrace.reasoningBlocks.length > 0
          ? { reasoningBlocks: assistantTrace.reasoningBlocks }
          : {}),
        ...(assistantTrace.clientRequestIds.length > 0
          ? { clientRequestIds: assistantTrace.clientRequestIds }
          : {}),
      };
    }
    return { content };
  }

  const text = collectTextFragments(content).join('\n').trim();
  const inputImages = collectInputImages(content);
  const reasoningBlocks = collectReasoningFragments(content)
    .map((item) => normalizeReasoningText(item))
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index);

  return {
    content: text,
    ...(inputImages.length > 0 ? { inputImages } : {}),
    ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
  };
}

function collectTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    const fragments = value.flatMap((item) => collectTextFragments(item));
    return fragments;
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const type = record['type'];

  if (isReasoningRecord(record)) {
    return [];
  }

  if (record['type'] === 'input_image') {
    return [];
  }

  if (
    (type === 'text' || type === 'input_text' || type === 'output_text') &&
    typeof record['text'] === 'string'
  ) {
    return record['text'].trim().length > 0 ? [record['text']] : [];
  }

  const candidateFields = [
    record['text'],
    record['content'],
    record['details'],
    record['markdown'],
    record['summary'],
    record['value'],
    record['title'],
    record['path'],
    record['command'],
    record['output'],
  ];

  const fragments = candidateFields.flatMap((item) => collectTextFragments(item));
  return fragments;
}

function collectInputImages(value: unknown): MobileInputImage[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectInputImages(item));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (record['type'] !== 'input_image') {
    return [];
  }

  return [
    {
      ...(typeof record['artifactId'] === 'string' ? { artifactId: record['artifactId'] } : {}),
      ...(typeof record['fileName'] === 'string' ? { fileName: record['fileName'] } : {}),
      ...(typeof record['imageUrl'] === 'string' ? { imageUrl: record['imageUrl'] } : {}),
      ...(typeof record['mimeType'] === 'string' ? { mimeType: record['mimeType'] } : {}),
    },
  ];
}

function collectReasoningFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReasoningFragments(item));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (!isReasoningRecord(record)) {
    return [];
  }

  return collectReasoningCandidateFields(record).flatMap((item) => collectTextFragments(item));
}

function collectReasoningCandidateFields(record: Record<string, unknown>): unknown[] {
  return [
    record['text'],
    record['content'],
    record['details'],
    record['markdown'],
    record['reasoning'],
    record['reasoningText'],
    record['summary'],
    record['value'],
  ];
}

function isReasoningRecord(record: Record<string, unknown>): boolean {
  const type = record['type'];
  const field = record['field'];

  return (
    type === 'reasoning' ||
    type === 'thinking' ||
    type === 'thought' ||
    type === 'thoughts' ||
    field === 'reasoning_content' ||
    field === 'reasoning_details'
  );
}

function normalizeReasoningText(value: string): string {
  return value.replaceAll('[REDACTED]', '').trim();
}

function parseAssistantTraceContent(content: string): {
  content: string;
  reasoningBlocks: string[];
  toolNames: string[];
  clientRequestIds: string[];
} | null {
  try {
    const parsed = JSON.parse(content) as {
      type?: unknown;
      payload?: {
        text?: unknown;
        reasoningBlocks?: unknown;
        toolCalls?: unknown;
        modifiedFilesSummary?: { files?: unknown };
      };
    };

    if (parsed.type !== 'assistant_trace' || !parsed.payload) {
      return null;
    }

    const text = typeof parsed.payload.text === 'string' ? parsed.payload.text : '';
    const reasoningBlocks = Array.isArray(parsed.payload.reasoningBlocks)
      ? parsed.payload.reasoningBlocks
          .filter((item): item is string => typeof item === 'string')
          .map((item) => normalizeReasoningText(item))
          .filter((item) => item.length > 0)
      : [];
    const toolNames = Array.isArray(parsed.payload.toolCalls)
      ? parsed.payload.toolCalls.flatMap((item) => {
          if (!item || typeof item !== 'object') {
            return [];
          }
          const toolCall = item as Record<string, unknown>;
          return typeof toolCall.toolName === 'string' ? [toolCall.toolName] : [];
        })
      : [];

    // 回退检测用的回合键：toolCalls 与变更摘要里的 clientRequestId。
    const clientRequestIds: string[] = [];
    const pushRequestId = (value: unknown): void => {
      if (typeof value === 'string' && value.length > 0 && !clientRequestIds.includes(value)) {
        clientRequestIds.push(value);
      }
    };
    if (Array.isArray(parsed.payload.toolCalls)) {
      for (const item of parsed.payload.toolCalls) {
        if (item && typeof item === 'object') {
          pushRequestId((item as Record<string, unknown>)['clientRequestId']);
        }
      }
    }
    const summaryFiles = parsed.payload.modifiedFilesSummary?.files;
    if (Array.isArray(summaryFiles)) {
      for (const item of summaryFiles) {
        if (item && typeof item === 'object') {
          pushRequestId((item as Record<string, unknown>)['clientRequestId']);
        }
      }
    }

    return { content: text, reasoningBlocks, toolNames, clientRequestIds };
  } catch {
    return null;
  }
}

function buildAssistantTraceText(trace: { content: string; toolNames: string[] }): string {
  const toolLines = trace.toolNames.map((toolName) => `工具：${toolName}`);
  return [trace.content, ...toolLines].filter((item) => item.trim().length > 0).join('\n\n');
}
