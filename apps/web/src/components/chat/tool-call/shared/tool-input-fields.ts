import {
  type ChannelSendBody,
  extractChannelSendBody,
  isChannelSendTool,
  stripChannelRoutingFields,
} from './channel-send-input.js';

/**
 * 入参展示的**唯一规则源**。
 *
 * 卡片的抽屉标题（`参数 (N)` / `内容`）与 `ToolInputPreview` 实际渲染的字段必须来自
 * 同一处判断，否则会出现自相矛盾：MCP-legacy 的入参外面裹了一层 `arguments`，
 * 标题按 `Object.keys(input).length` 数出来是 `参数 (1)`，展开却是 3 个业务字段。
 */

export type ToolInputKind = 'agent' | 'mcp' | 'skill' | 'tool';

/** MCP 工具调用时的元数据字段：对用户无意义，只在输入预览中过滤。 */
const MCP_METADATA_FIELDS: ReadonlySet<string> = new Set([
  'serverId',
  'serverName',
  'toolName',
  '_meta',
  'method',
]);

/** 是否为「MCP 形状」的入参（扁平 MCP 工具、legacy `mcp_call`、`mcp_*` 前缀）。 */
export function isMcpStyleInput(toolName: string, kind?: ToolInputKind): boolean {
  const normalized = toolName.trim().toLowerCase();
  return kind === 'mcp' || normalized === 'mcp_call' || normalized.startsWith('mcp_');
}

/**
 * 过滤 MCP 元数据字段，并把 `arguments` 的内容展平到顶层。
 * 如果存在 arguments 字段，将其内容展平到顶层。
 */
export function filterMcpInput(input: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  // 先提取 arguments 内容（如果存在）
  if (input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)) {
    Object.assign(filtered, input.arguments as Record<string, unknown>);
  }

  // 然后添加其他非元数据字段
  for (const [key, value] of Object.entries(input)) {
    if (!MCP_METADATA_FIELDS.has(key) && key !== 'arguments') {
      filtered[key] = value;
    }
  }

  return filtered;
}

/** 面板真正会铺出来的字段（MCP 元数据过滤 + 渠道发送类剥掉运行时路由字段）。 */
export function resolveDisplayedInputFields(
  toolName: string,
  input: Record<string, unknown>,
  kind?: ToolInputKind,
): Record<string, unknown> {
  const normalized = toolName.trim().toLowerCase();
  const base = isMcpStyleInput(normalized, kind) ? filterMcpInput(input) : input;
  return isChannelSendTool(normalized) ? stripChannelRoutingFields(base) : base;
}

/**
 * 该调用会被渲染成「发出去的那条消息」时返回其正文，否则 null。
 * 判定与 `ToolInputPreview` 的分流完全一致（同一函数，不重复判断）。
 */
export function resolveToolInputMessage(
  toolName: string,
  input: Record<string, unknown>,
  kind?: ToolInputKind,
): ChannelSendBody | null {
  const normalized = toolName.trim().toLowerCase();
  if (!isChannelSendTool(normalized)) return null;
  return extractChannelSendBody(resolveDisplayedInputFields(toolName, input, kind));
}

/**
 * 正文之外的其余字段（已剥元数据 / 路由字段，并摘掉正文本身）。
 *
 * 用途：正文按 markdown 展示后，像 `PluginSendImage` 的 `file_path` 这类字段仍要可见——
 * 否则会出现「带图注时看不到发了哪个文件、不带图注反而看得到」。
 */
export function resolveToolInputExtraFields(
  toolName: string,
  input: Record<string, unknown>,
  kind?: ToolInputKind,
): Record<string, unknown> {
  const fields = resolveDisplayedInputFields(toolName, input, kind);
  const body = resolveToolInputMessage(toolName, input, kind);
  if (!body) return fields;

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key !== body.key) rest[key] = value;
  }
  return rest;
}

export interface ToolInputSection {
  /** 分区标题。 */
  title: '参数' | '内容';
  /** 标题里的计数；`null` 表示不显示计数（消息正文没有「N 个参数」可言）。 */
  count: number | null;
}

/** 卡片里入参分区的标题 + 计数（block 渲染 `参数 (3)`，inline 只渲染标题）。 */
export function resolveToolInputSection(
  toolName: string,
  input: Record<string, unknown>,
  kind?: ToolInputKind,
): ToolInputSection {
  if (resolveToolInputMessage(toolName, input, kind)) {
    return { title: '内容', count: null };
  }
  return {
    title: '参数',
    count: Object.keys(resolveDisplayedInputFields(toolName, input, kind)).length,
  };
}
