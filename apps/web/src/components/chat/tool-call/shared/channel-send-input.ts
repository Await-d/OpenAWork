/**
 * 渠道**发送类**工具的入参视图。
 *
 * 两条事实决定了它不该走通用参数表：
 *
 * 1. `plugin_id` / `chat_id` 由运行时自动填充——渠道 persona 提示词里明确写着
 *    「会自动使用当前通道和当前会话，不需要也不要手写 plugin_id/chat_id」
 *    （见 `services/agent-gateway/src/channels/channel-persona-prompt.ts` 的
 *    `<channel-reply-policy>`）。铺到界面上只剩两串无意义的 id（`c2c1…` / `ep000…`），
 *    与 `MCP_METADATA_FIELDS` 过滤 `serverId` / `toolName` 是同一个道理。
 * 2. 真正的内容是 `content`（发给用户的那条消息），通常是一整篇 markdown；按字段表渲染
 *    就是把 markdown 源码（`**粗体**`、`- 列表`）原样铺成一堵墙——既不好读，又把
 *    「已发送了消息」这件事实淹没了。
 *
 * 读类工具（`PluginGetGroupMessages` 等）**不**走这里：那里的 `chatId` 是用户要看的
 * 主体，剥掉反而丢信息。
 */

/** 发送类工具名（小写归一化后）；与 `natural-language-summary` 的渠道文案同一族。 */
const CHANNEL_SEND_TOOL_NAMES: ReadonlySet<string> = new Set([
  'pluginsendmessage',
  'pluginreplymessage',
  'pluginsendimage',
  'weixinsendimage',
  'feishusendimage',
  'pluginsendfile',
  'weixinsendfile',
  'feishusendfile',
]);

/**
 * 发送类里「发图」的子集。
 *
 * 发图与发文本 / 发文件的展示差异不止文案：图片本体只在入参 `file_path`，因此
 * 工具调用结果里要额外补一张缩略图（见 `tool-call-image-source.ts`）。这里单独
 * 导出判定、而不是让各处再枚举一遍名字，避免「认得出文案、认不出缩略图」。
 */
const CHANNEL_SEND_IMAGE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'pluginsendimage',
  'weixinsendimage',
  'feishusendimage',
]);

/** 由运行时填充的路由字段：发送类工具展示时一律剥掉。 */
const CHANNEL_ROUTING_FIELDS: ReadonlySet<string> = new Set([
  'plugin_id',
  'pluginId',
  'chat_id',
  'chatId',
]);

export function isChannelSendTool(normalizedToolName: string): boolean {
  return CHANNEL_SEND_TOOL_NAMES.has(normalizedToolName);
}

/** 是否渠道「发图」工具（发送类子集，见上方 `CHANNEL_SEND_IMAGE_TOOL_NAMES`）。 */
export function isChannelSendImageTool(normalizedToolName: string): boolean {
  return CHANNEL_SEND_IMAGE_TOOL_NAMES.has(normalizedToolName);
}

/** 剥掉运行时填充的路由字段（没有正文可展示时，用它兜底渲染参数表）。 */
export function stripChannelRoutingFields(input: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!CHANNEL_ROUTING_FIELDS.has(key)) {
      stripped[key] = value;
    }
  }
  return stripped;
}

export interface ChannelSendBody {
  /**
   * 正文来自哪个字段（`content` / `caption`）。
   *
   * 调用方需要它把正文从参数里摘出去，好在正文下方继续展示**其余**字段
   *（例如发图时的 `file_path`）——否则会出现「带图注时看不到发了哪个文件、
   * 不带图注反而看得到」这种自相矛盾。
   */
  key: 'content' | 'caption';
  /** 正文文本：`content` 优先，图片 / 文件类退到 `caption`。 */
  body: string;
  /** meta 行的定语（正文 / 图注）。 */
  hint: string;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().length > 0 ? value : null;
}

/**
 * 取出要展示的正文；没有可展示文本时返回 null（调用方退回参数表，例如只发文件不带图注）。
 *
 * 刻意不 trim 返回值：正文里的缩进 / 空行是用户内容的一部分，交给 markdown 自己处理。
 */
export function extractChannelSendBody(input: Record<string, unknown>): ChannelSendBody | null {
  const content = readNonEmptyString(input['content']);
  if (content !== null) return { key: 'content', body: content, hint: '正文' };
  const caption = readNonEmptyString(input['caption']);
  if (caption !== null) return { key: 'caption', body: caption, hint: '图注' };
  return null;
}
