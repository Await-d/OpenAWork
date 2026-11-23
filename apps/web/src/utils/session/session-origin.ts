/**
 * 会话来源（`metadata.source`）解析与只读来源标识。
 *
 * 背景：渠道会话（`source: 'channel'`）与定时任务执行会话（`source: 'cron'`）**没有**
 * 「澄清 / 编程 / 程序员」这套对话模式——网关侧它们的工具面分别由渠道 allowlist /
 * permissions 与任务自身配置决定（`services/agent-gateway/src/session/session-tool-visibility.ts`），
 * 且 metadata 从来不会写入 `dialogueMode`。但网页端复用同一个 ChatPage 打开这些会话，
 * `dialogueMode` 读取即回退到默认值，于是顶栏出现一个**可点击**的三模式切换器，
 * 显示着一个该会话根本不具备的模式。
 *
 * 更严重的是那个切换器是**可写的**：`buildSessionMetadata` 永远带上 `dialogueMode`，
 * 因此一旦被点成 `clarify`（或在来源会话里改任意其它设置触发 PATCH），澄清只读白名单
 * （`clarify-mode-tool-policy.ts`，不含任何渠道回复工具）就会把该会话在渠道侧的全部回复
 * 能力收敛掉——表现为「渠道里再也回不了消息」。
 *
 * 故本模块是网页端「这个会话是否由来源托管、是否必须只读」的**唯一判定来源**，供顶栏
 * 只读标识、侧栏 / 标签页图标、元数据写入豁免共同消费，避免多处散判 `source`。
 *
 * 与网关侧 `isChannelManagedSessionMetadata` / `isSourceManagedSessionMetadata` 取值一致
 *（`channel` 与 `cron` 同属来源托管：两者都不写 `dialogueMode`）。
 *
 * 注：移动端另有一份等价实现（`apps/mobile/src/lib/session-origin.ts`）——不放进
 * `@openAwork/web-client` 是因为网页端有大量 `vi.mock('@openAwork/web-client')` 的局部
 * 工厂，新增导出会击穿它们的导入链。真正的能力约束仍在网关侧，客户端两份只影响展示。
 */

/** 会话来源：与网关 `metadata.source` 的取值对齐；未知 / 网页自建会话统一为 `unknown`。 */
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
 * 来源托管会话（渠道 / 定时任务）：对话模式由来源侧配置决定，网页端必须只读——
 * 既不渲染模式切换器，也不把 `dialogueMode` 写进会话 metadata。
 */
export function isSourceManagedSession(origin: SessionOrigin): boolean {
  return origin.source === 'channel' || origin.source === 'cron';
}

/**
 * 顶栏只读来源标识文案；非来源托管会话返回 null（此时才允许渲染三模式切换器）。
 * 渠道名缺失时退化为「渠道会话」，不要拼出「渠道：undefined」。
 */
export function buildSessionOriginBadgeLabel(origin: SessionOrigin): string | null {
  if (origin.source === 'channel') {
    return origin.channelLabel ? `渠道：${origin.channelLabel}` : '渠道会话';
  }
  if (origin.source === 'cron') return '定时任务';
  return null;
}
