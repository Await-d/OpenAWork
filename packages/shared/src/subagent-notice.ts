import type {
  Message,
  SubagentNoticeMetadata,
  SubagentNoticeState,
  TextContent,
} from './message-schema.js';

/**
 * 子代理完成通知的渲染契约。
 *
 * 对齐 opencode 的 notice 行：一行紧凑文本 + 可跳转到子会话。
 * 由 `parseSubagentNotice` 从 `role: 'synthetic'` 的网关注入消息中提取。
 *
 * 放在 `shared` 而非 `shared-ui`：Web / 桌面 / 移动端三个客户端都需要同一份语义，
 * 而移动端不依赖 `shared-ui`；且 Web 的测试环境会把 `shared-ui` 整体 mock 掉。
 */
export interface SubagentNotice {
  /** 源消息 id（用作列表 key）。 */
  id: string;
  /** 子代理名；缺失时回退为中性占位。 */
  agent: string;
  state: SubagentNoticeState;
  /** 任务短标签；`failed` 状态允许为空（强制可见）。 */
  description: string;
  /** 子会话 id；存在则可跳转。 */
  childSessionId?: string;
  /** 通知正文（来自 text parts）。 */
  text: string;
  /**
   * 源消息的创建时间（毫秒）。用于把通知**按位置**插入消息群组之间——
   * 与 opencode 把 notice 作为时间线行渲染的语义一致。
   */
  createdAt: number;
}

/** 子代理名缺失时的中性占位（对齐上游的 `Subagent` 兜底）。 */
export const SUBAGENT_NOTICE_DEFAULT_AGENT = '子代理';

function isNoticeState(value: unknown): value is SubagentNoticeState {
  return value === 'done' || value === 'failed' || value === 'cancelled';
}

function readSubagentMetadata(value: unknown): SubagentNoticeMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record['source'] !== 'subagent') {
    return undefined;
  }

  const childID = record['childID'];
  const agent = record['agent'];
  const state = record['state'];

  return {
    source: 'subagent',
    ...(typeof childID === 'string' && childID.length > 0 ? { childID } : {}),
    ...(typeof agent === 'string' && agent.length > 0 ? { agent } : {}),
    ...(isNoticeState(state) ? { state } : {}),
  };
}

function readNoticeText(message: Message): string {
  return message.content
    .filter((part): part is TextContent => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

/**
 * 剥离网关注入的 `<subagent …>…</subagent>` 包裹（参考库 `SubagentCompletion.deliver`
 * 的标签形态），让客户端拿到纯正文。模型侧不受影响——`parseSubagentNotice` 只服务
 * 客户端，模型请求直接读取 text parts（`message-to-model-messages.ts`）。
 */
function stripSubagentNoticeWrapper(value: string): string {
  const trimmed = value.trim();
  const match = /^<subagent\b[^>]*>\n?([\s\S]*?)\n?<\/subagent>$/u.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

/**
 * 把消息解析为子代理通知；不是子代理通知时返回 `null`。
 *
 * 可见性规则对齐上游（`session-ui/src/timeline/projection.ts` 的 `isNotice`
 * 与 `session-ui/src/timeline/detail.ts` 的 `timelineNoticeRequired`）：
 * 非空 `description` 才成形；`failed` 即使没有描述也强制可见。
 */
export function parseSubagentNotice(message: Message): SubagentNotice | null {
  if (message.role !== 'synthetic') {
    return null;
  }

  const metadata = readSubagentMetadata(message.metadata);
  if (!metadata) {
    return null;
  }

  const state: SubagentNoticeState = metadata.state ?? 'done';
  const description = typeof message.description === 'string' ? message.description.trim() : '';
  if (description.length === 0 && state !== 'failed') {
    return null;
  }

  return {
    id: message.id,
    agent: metadata.agent ?? SUBAGENT_NOTICE_DEFAULT_AGENT,
    state,
    description,
    ...(metadata.childID ? { childSessionId: metadata.childID } : {}),
    text: stripSubagentNoticeWrapper(readNoticeText(message)),
    createdAt: message.createdAt,
  };
}
