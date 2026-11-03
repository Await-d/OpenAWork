/**
 * MCP 通道 → 内置工具名的归一化（纯函数）。
 *
 * 网关把同一批能力用两条通道暴露给模型：
 *
 * 1. 内置工具：`codegraph_search`、`webfetch`、`lsp_find_references` …；
 * 2. 虚拟 MCP server：扁平名 `mcp__<server>__<tool>`，或 legacy 的
 *    `mcp_call` + `{ serverId, toolName }`。
 *
 * 两条通道的**输出内容一致**，只是 MCP 通道多包了一层
 * `{ content: [{ type: 'text' }], structuredContent? }`（虚拟 server 的对象载荷
 * 还会被 `JSON.stringify` 成单个 text 块）。前端原先只为 LSP 写了「剥壳 + 派发」，
 * 于是其它 server 即便已经有现成的内置预览组件，也仍然退化成原始 JSON ——
 * 也就是代码里反复提到的「同一能力两套观感」。
 *
 * 这里把归一化收成一处：认得出内置对应关系，就换成内置工具名 + 内层载荷，下游
 * 所有内置分支天然生效；认不出则返回 null，让调用方继续走原有的 MCP 渲染路径。
 */

import { extractMcpResult } from '../previews/mcp-result-preview.js';

/**
 * `serverId → { 内层工具名 → 归一化后的工具名 }`。
 *
 * 目标名通常是**真实存在的内置工具名**，但也可以是前端专为某类 MCP 输出准备的
 * 渲染通道名（如 `git_bash_status` / `lsp_status`）——它们没有对应的内置工具，只是给
 * `renderToolOutputBody` 一个稳定的分发锚点。
 *
 * 登记的粒度是「有专门渲染方式」的工具：名字统一 + 信封剥壳让折叠标题、inline 摘要
 * 与输出预览共用一套口径；认不出的工具返回 null，继续走 `McpResultPreview`。
 *
 * 未登记的有两类：
 * - `grep_app`：远端 SSE server，本地不枚举它的工具名、也不掌握返回形状，无法可靠适配；
 * - `omo`：**已下线**（`RETIRED_PROTECTED_MCP_IDS`）。历史会话里仍有存量调用，
 *   这里刻意不给它任何渲染通道，让它们按未登记路径回落 `McpResultPreview` ——
 *   不要为已下线的能力新增专属预览。
 */
const BUILTIN_TOOL_ALIASES: Record<string, Record<string, string>> = {
  lsp: {
    call_hierarchy: 'lsp_call_hierarchy',
    diagnostics: 'lsp_diagnostics',
    find_references: 'lsp_find_references',
    goto_definition: 'lsp_goto_definition',
    goto_implementation: 'lsp_goto_implementation',
    hover: 'lsp_hover',
    prepare_rename: 'lsp_prepare_rename',
    rename: 'lsp_rename',
    status: 'lsp_status',
    symbols: 'lsp_symbols',
    touch: 'lsp_touch',
  },
  // 虚拟 codegraph server 的内层名本身就是内置工具名，逐条列出而不是靠前缀
  // 推断——「看起来像巧合」的隐式约定最容易在改名时静默失效。
  codegraph: {
    codegraph_callers: 'codegraph_callers',
    codegraph_impact: 'codegraph_impact',
    codegraph_index: 'codegraph_index',
    codegraph_node: 'codegraph_node',
    codegraph_search: 'codegraph_search',
    codegraph_status: 'codegraph_status',
  },
  // `run` 的输出与内置 bash 同形（`{ exitCode, cwd, output, timedOut }`），直接复用
  // 终端预览；`which_bash` / `diagnose` 是环境探测结果，共用一张状态卡。
  git_bash: {
    diagnose: 'git_bash_status',
    run: 'bash',
    which_bash: 'git_bash_status',
  },
  // `fetch_web` 的 `structuredContent` 与内置 webfetch 的输出同形
  // （`{ url, contentType, content, … }`），因此可以直接复用网页结果卡片；
  // `fetch_github_readme` 返回 Markdown 文本，走 webfetch 的 Markdown 分支。
  open_websearch: {
    fetch_github_readme: 'webfetch',
    fetch_web: 'webfetch',
    // 搜索结果信封 `{ query, results, totalResults }`：网页结果卡的结构化识别
    // 认得 `results` 数组，所以它和内置 websearch 走同一条渲染链路。
    search: 'websearch',
  },
  // Exa 的搜索工具同样返回结果列表。
  websearch: {
    web_search_exa: 'web_search',
  },
};

const FLAT_MCP_PREFIX = 'mcp__';
const LEGACY_MCP_TOOL_NAMES = new Set(['mcp', 'mcp_call']);
/** 扁平名的 server 与工具名分隔符。 */
const FLAT_MCP_SERVER_SEPARATOR = '__';

export interface McpCall {
  serverId: string;
  /** 内层工具名（不含 server 前缀）。 */
  toolName: string;
}

/**
 * 识别一次 MCP 调用，取出 `serverId` 与内层工具名。
 *
 * - 扁平模式：`mcp__lsp__find_references` → `lsp` + `find_references`
 * - legacy 模式：`mcp_call` + `{ serverId: 'lsp', toolName: 'find_references' }`
 *
 * 不判断 server 是否内置——「是不是 MCP 调用」与「有没有内置对应」是两件事，
 * 混在一起会让调用方无法区分「不是 MCP」和「是 MCP 但没对应预览」。
 */
export function parseMcpCall(input0: string, input?: Record<string, unknown>): McpCall | null {
  const normalized = input0.trim().toLowerCase();

  if (normalized.startsWith(FLAT_MCP_PREFIX)) {
    const rest = normalized.slice(FLAT_MCP_PREFIX.length);
    const separator = rest.indexOf(FLAT_MCP_SERVER_SEPARATOR);
    if (separator <= 0) return null;
    const serverId = rest.slice(0, separator);
    const toolName = rest.slice(separator + FLAT_MCP_SERVER_SEPARATOR.length);
    return serverId.length > 0 && toolName.length > 0 ? { serverId, toolName } : null;
  }

  if (LEGACY_MCP_TOOL_NAMES.has(normalized)) {
    const serverId = readTrimmed(input?.['serverId']);
    const toolName = readTrimmed(input?.['toolName']);
    if (!serverId || !toolName) return null;
    return { serverId: serverId.toLowerCase(), toolName: toolName.toLowerCase() };
  }

  return null;
}

/** 该 MCP 调用对应的内置工具名；不是 MCP 调用、或没有内置对应时返回 null。 */
export function resolveMcpBuiltinToolName(
  toolName: string,
  input?: Record<string, unknown>,
): string | null {
  const call = parseMcpCall(toolName, input);
  if (!call) return null;
  return BUILTIN_TOOL_ALIASES[call.serverId]?.[call.toolName] ?? null;
}

/**
 * 剥掉 MCP 信封，取出内层载荷。
 *
 * 优先 `structuredContent`（网关若给出结构化返回，比解析文本可靠）；否则取 text
 * 块并尝试按 JSON 还原——虚拟 server 的对象载荷正是 `JSON.stringify` 进 text 的。
 * 非 MCP 信封原样返回，调用方不必先判断形状。
 */
export function unwrapMcpPayload(output: unknown): unknown {
  const envelope = extractMcpResult(output);
  if (!envelope) return output;
  if (envelope.structuredContent !== undefined) return envelope.structuredContent;
  return envelope.text.length > 0 ? parseMaybeJsonPayload(envelope.text) : output;
}

export interface McpBuiltinBridge {
  serverId: string;
  /** MCP 内层工具名。 */
  mcpToolName: string;
  /** 归一化后的内置工具名。 */
  toolName: string;
  /** 已剥掉 MCP 信封的内层载荷。 */
  output: unknown;
}

/**
 * 一步到位：既是 MCP 调用、又有内置对应时，返回归一化后的工具名与载荷；
 * 否则返回 null（调用方据此走原有 MCP 渲染）。
 */
export function resolveMcpBuiltinBridge(
  toolName: string,
  output: unknown,
  input?: Record<string, unknown>,
): McpBuiltinBridge | null {
  const call = parseMcpCall(toolName, input);
  if (!call) return null;
  const builtinToolName = BUILTIN_TOOL_ALIASES[call.serverId]?.[call.toolName];
  if (!builtinToolName) return null;
  return {
    serverId: call.serverId,
    mcpToolName: call.toolName,
    toolName: builtinToolName,
    output: unwrapMcpPayload(output),
  };
}

/** 把「可能是 JSON 文本」的载荷还原成对象；非 JSON 原样返回。 */
export function parseMaybeJsonPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  const trimmed = payload.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return payload;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // 截断 / 非法 JSON：保持原文，让下游按文本回退。
    return payload;
  }
}

function readTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
