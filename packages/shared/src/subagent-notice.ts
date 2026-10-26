import type {
  Message,
  SubagentNoticeMetadata,
  SubagentNoticeState,
  SyntheticNoticeSource,
  TextContent,
} from './message-schema.js';

/**
 * 网关注入通知的渲染契约（子代理完成 / 定时任务结果）。
 *
 * 对齐 opencode 的 notice 行：一行紧凑文本 + 可跳转到来源会话。
 * 由 `parseSyntheticNotice` 从 `role: 'synthetic'` 的网关注入消息中提取。
 *
 * 放在 `shared` 而非 `shared-ui`：Web / 桌面 / 移动端三个客户端都需要同一份语义，
 * 而移动端不依赖 `shared-ui`；且 Web 的测试环境会把 `shared-ui` 整体 mock 掉。
 */
export interface SubagentNotice {
  /** 源消息 id（用作列表 key）。 */
  id: string;
  /**
   * 通知来源。消费方必须按它分流文案与跳转语义：
   * `'subagent'` 是子代理完成、`'cron'` 是定时任务结果。
   */
  source: SyntheticNoticeSource;
  /** 来源名（子代理名 / 定时任务名）；缺失时回退为中性占位。 */
  agent: string;
  state: SubagentNoticeState;
  /** 短标签；`failed` 状态允许为空（强制可见）。 */
  description: string;
  /** 跳转目标会话 id；存在则可跳转。 */
  targetSessionId?: string;
  /** 通知正文（来自 text parts）。 */
  text: string;
  /**
   * 源消息的创建时间（毫秒）。用于把通知**按位置**插入消息群组之间——
   * 与 opencode 把 notice 作为时间线行渲染的语义一致。
   */
  createdAt: number;
}

/** 来源名缺失时的中性占位（对齐上游的 `Subagent` 兜底）。 */
export const SUBAGENT_NOTICE_DEFAULT_AGENT = '子代理';

function isNoticeState(value: unknown): value is SubagentNoticeState {
  return value === 'done' || value === 'failed' || value === 'cancelled';
}

function isNoticeSource(value: unknown): value is SyntheticNoticeSource {
  return value === 'subagent' || value === 'cron';
}

function readSubagentMetadata(value: unknown): SubagentNoticeMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const source = record['source'];
  if (!isNoticeSource(source)) {
    return undefined;
  }

  const childID = record['childID'];
  const agent = record['agent'];
  const state = record['state'];

  return {
    source,
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
 * 剥离网关注入的 `<subagent …>…</subagent>` / `<cron …>…</cron>` 包裹
 * （参考库 `SubagentCompletion.deliver` 的标签形态），让客户端拿到纯正文。
 * 模型侧不受影响——解析器只服务客户端，模型请求直接读取 text parts
 * （`message-to-model-messages.ts`）。
 */
function stripSubagentNoticeWrapper(value: string): string {
  const trimmed = value.trim();
  // 两种标签都要剥：子代理通知是 `<subagent …>`，定时任务结果投递是 `<cron …>`
  // （见 `services/agent-gateway/src/cron/delivery.ts`）。只剥前者会让 cron 通知把
  // 原始标签当作正文显示给用户。
  const match = /^<(subagent|cron)\b[^>]*>\n?([\s\S]*?)\n?<\/\1>$/u.exec(trimmed);
  return match?.[2]?.trim() ?? trimmed;
}

/**
 * 把消息解析为网关注入通知（子代理完成 / 定时任务结果）；不是通知时返回 `null`。
 *
 * 可见性规则对齐上游（`session-ui/src/timeline/projection.ts` 的 `isNotice`
 * 与 `session-ui/src/timeline/detail.ts` 的 `timelineNoticeRequired`）：
 * 非空 `description` 才成形；`failed` 即使没有描述也强制可见。
 */
export function parseSyntheticNotice(message: Message): SubagentNotice | null {
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
    source: metadata.source,
    agent: metadata.agent ?? SUBAGENT_NOTICE_DEFAULT_AGENT,
    state,
    description,
    ...(metadata.childID ? { targetSessionId: metadata.childID } : {}),
    text: stripSubagentNoticeWrapper(readNoticeText(message)),
    createdAt: message.createdAt,
  };
}

/**
 * @deprecated 用 `parseSyntheticNotice`：本函数只认子代理通知，会把定时任务
 * 结果投递（`source: 'cron'`）判为「非通知」而静默丢弃。保留导出仅为兼容旧调用方。
 */
export function parseSubagentNotice(message: Message): SubagentNotice | null {
  const notice = parseSyntheticNotice(message);
  return notice?.source === 'subagent' ? notice : null;
}
