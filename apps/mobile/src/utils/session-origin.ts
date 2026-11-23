/**
 * 会话来源（`metadata.source`）解析与只读来源标识（移动端）。
 *
 * 渠道会话（`source: 'channel'`）与定时任务执行会话（`source: 'cron'`）**没有**
 * 「澄清 / 编程 / 程序员」这套对话模式：网关侧它们的工具面分别由渠道 allowlist /
 * permissions 与任务自身配置决定，metadata 也从来不会写入 `dialogueMode`。但移动端
 * 复用同一个聊天屏打开这些会话，模式栏会显示一个该会话根本不具备的可写模式。
 *
 * 与网页端 `apps/web/src/utils/session/session-origin.ts`、网关侧
 * `services/agent-gateway/src/session/session-runtime-policy.ts` 的
 * `isSourceManagedSessionMetadata` 取值一致（`channel` 与 `cron` 同属来源托管）。
 *
 * 为什么这里是一份等价实现而不是共享模块：**真正的能力约束在网关侧**——网关对来源会话
 * 一律忽略请求级与 metadata 里的 `dialogueMode`（见 `routes/stream.ts` 的
 * `resolveStreamInteractionModes` 与 `session-tool-visibility.ts` 的澄清豁免），客户端
 * 这两份只影响展示。而把该模块下沉到 `@openAwork/web-client` 会新增包导出，击穿网页端
 * 大量 `vi.mock('@openAwork/web-client')` 的局部工厂（导入链经过它的测试会整体报
 * 「No "X" export is defined on the mock」），代价远大于收益。
 */

/** 会话来源：与网关 `metadata.source` 的取值对齐；未知 / 客户端自建会话统一为 `unknown`。 */
export type SessionOriginSource = 'channel' | 'cron' | 'desktop' | 'unknown';

export interface SessionOrigin {
  source: SessionOriginSource;
  /** 渠道展示名：`channel.name` 优先，回退 `channel.type`；非渠道会话为 null。 */
  channelLabel: string | null;
}

export const UNKNOWN_SESSION_ORIGIN: SessionOrigin = { source: 'unknown', channelLabel: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 解析「渠道」子对象的展示名：name 优先，回退 type（两者都可能是缺失 / 脏数据）。 */
function readChannelLabel(channel: unknown): string | null {
  if (!isRecord(channel)) return null;
  return readNonEmptyString(channel['name']) || readNonEmptyString(channel['type']) || null;
}

/** 在**已解析**的 metadata 对象上解析来源（避免重复 JSON.parse）。 */
export function parseSessionOrigin(parsed: Record<string, unknown>): SessionOrigin {
  const source = parsed['source'];
  if (source === 'channel') {
    return { source: 'channel', channelLabel: readChannelLabel(parsed['channel']) };
  }
  if (source === 'cron') return { source: 'cron', channelLabel: null };
  if (source === 'desktop') return { source: 'desktop', channelLabel: null };
  return UNKNOWN_SESSION_ORIGIN;
}

/** 从 metadata JSON 字符串解析来源；缺失 / 非法 JSON 一律回退为 `unknown`。 */
export function readSessionOrigin(metadataJson?: string): SessionOrigin {
  if (!metadataJson) return UNKNOWN_SESSION_ORIGIN;
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    return isRecord(parsed) ? parseSessionOrigin(parsed) : UNKNOWN_SESSION_ORIGIN;
  } catch {
    return UNKNOWN_SESSION_ORIGIN;
  }
}

/**
 * 来源托管会话（渠道 / 定时任务）：对话模式由来源侧配置决定，客户端必须只读——
 * 既不渲染模式选择器，也不把 `dialogueMode` 塞进 stream 请求。
 */
export function isSourceManagedSession(origin: SessionOrigin): boolean {
  return origin.source === 'channel' || origin.source === 'cron';
}

/**
 * 只读来源标识文案；非来源托管会话返回 null（此时才渲染模式选择器）。
 * 渠道名缺失时退化为「渠道会话」，不要拼出「渠道：undefined」。
 */
export function buildSessionOriginBadgeLabel(origin: SessionOrigin): string | null {
  if (origin.source === 'channel') {
    return origin.channelLabel ? `渠道：${origin.channelLabel}` : '渠道会话';
  }
  if (origin.source === 'cron') return '定时任务';
  return null;
}
