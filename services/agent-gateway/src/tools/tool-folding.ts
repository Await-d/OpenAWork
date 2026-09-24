/**
 * Tool folding — bounded model-visible tool surface.
 *
 * 对齐目标（opencode v2.0.15）：参考库只把 12 个 `codemode: false` 的直连工具
 * 作为原生 tool 暴露，其余工具折进 Code Mode 目录（目录有 2,000 tokens 硬预算），
 * 模型通过 `execute`（内部 `search` + 调用）访问折叠工具。
 *
 * 本仓没有 Code Mode 解释器，因此采用**同形状**的折叠：
 *   - 直连工具（`DIRECT_TOOL_NAMES`）保持原生 JSON Schema 不变；
 *   - 其余工具折进「可折叠工具目录」（system 提示词内，字符预算 ≈ 2,000 tokens），
 *     目录行只含紧凑签名 + 截断描述（对齐参考库 catalog 行）；
 *   - `tool_invoke({ tool, arguments })` 在网关侧分发到真实工具（等价于参考库
 *     在 `execute` 内调用工具的执行路径，但参数是 JSON 而非 JS）；
 *   - `tool_search({ query })` 返回匹配工具的完整定义（等价于参考库目录里的
 *     `search`），用于恢复参数细节。
 *
 * 安全边界：`tool_invoke` 只允许调用**当前会话已可见且已启用**的工具
 * （会话 metadata 里的 `toolInvokeAllowlist`），且权限阶梯在解包后按**内层工具名**
 * 评估——deny / ask / 审批 / team / channel / clarify 规则与直接调用完全一致。
 */

import type { GatewayToolDefinition } from './tool-definitions.js';
import { z } from 'zod';

export const TOOL_INVOKE_TOOL_NAME = 'tool_invoke';
export const TOOL_SEARCH_TOOL_NAME = 'tool_search';

/**
 * 直连工具：保持原生 tool 定义（高频、承载关键指引 / 列表 / 交互）。
 *
 * 对齐参考库的 12 个直连工具（shell / read / write / edit / patch / glob /
 * grep / webfetch / websearch / skill / question / subagent），再叠加本仓在
 * 任务开发里高频使用的编排与交互工具。
 */
export const DIRECT_TOOL_NAMES: ReadonlySet<string> = new Set([
  // 文件与检索
  'bash',
  'read',
  'write',
  'edit',
  'multi_edit',
  'patch',
  'glob',
  'grep',
  'list',
  'run_bash_in_background',
  'bash_output',
  'bash_kill',
  // 网络
  'webfetch',
  'websearch',
  'codesearch',
  // 交互 / 模式
  'Skill',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  // 编排
  'subagent',
  'Agent',
  'task',
  'batch',
  'background_output',
  'background_cancel',
  // 计划（高频）
  'todowrite',
  'todoread',
  'subtodowrite',
  'subtodoread',
  // 检索大输出
  'read_tool_output',
  // 评审
  'workspace_review_diff',
  // 折叠入口本身
  TOOL_INVOKE_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
]);

/**
 * 可折叠工具：低频 / 领域专用工具（显式清单，未知或新增工具默认直连，
 * 避免漏登记导致模型「看不到也不能调」）。
 */
export const DEFERRED_TOOL_NAMES: ReadonlySet<string> = new Set([
  // LSP（语义查询；需要时才查）
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_prepare_rename',
  'lsp_rename',
  'lsp_hover',
  'lsp_call_hierarchy',
  // codegraph 发现缓存
  'codegraph_status',
  'codegraph_index',
  'codegraph_search',
  'codegraph_node',
  'codegraph_callers',
  'codegraph_impact',
  // AST 结构检索
  'ast_grep_search',
  'ast_grep_replace',
  // 会话管理套件
  'session_list',
  'session_read',
  'session_search',
  'session_info',
  'session_rename',
  'session_move',
  // 任务图管理（非委派本身）
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  // MCP 包装入口
  'mcp_list_tools',
  'mcp_call',
  'mcp_manage_servers',
  // 自助管理
  'memory_manage',
  'skill_manage',
  'schedule_manage',
  'agent_manage',
  // 媒体
  'convert_media',
  'extract_media_info',
  'extract_video_frame',
  'generate_image',
  'generate_audio',
  // 桌面控制
  'desktop_automation',
  'desktop_control',
  'computer_use',
  // 仓库
  'repo_clone',
  'repo_overview',
  // 其他低频
  'models',
  'look_at',
  'skill_mcp',
  'interactive_bash',
  'workspace_review_status',
  'workspace_review_revert',
  'workspace_create_directory',
]);

/** 折叠总开关（默认开启）；`OPENAWORK_DISABLE_TOOL_FOLDING=1` 可回退完整工具面。 */
export function isToolFoldingEnabled(): boolean {
  const raw = globalThis.process?.env?.['OPENAWORK_DISABLE_TOOL_FOLDING'];
  if (typeof raw !== 'string') return true;
  const normalized = raw.trim().toLowerCase();
  return !(normalized === '1' || normalized === 'true' || normalized === 'yes');
}

/** 动态 MCP 扁平工具（`mcp__<server>__<tool>`）同样可折叠。 */
function isFlatMcpToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}

export function isDeferrableToolName(toolName: string): boolean {
  return DEFERRED_TOOL_NAMES.has(toolName) || isFlatMcpToolName(toolName);
}

export function shouldFoldTool(toolName: string): boolean {
  return isDeferrableToolName(toolName) && !DIRECT_TOOL_NAMES.has(toolName);
}

export interface FoldedToolSurface {
  /** 原生暴露的直连工具（含 tool_invoke / tool_search）。 */
  readonly directTools: GatewayToolDefinition[];
  /** 仅出现在目录里的折叠工具（保持原始定义，供 tool_search / tool_invoke 使用）。 */
  readonly deferredTools: GatewayToolDefinition[];
  /** 本轮模型可见的全部工具名（直连 + 折叠）。 */
  readonly visibleNames: string[];
  /** 注入 system 提示词的目录文本（无折叠工具时为空串）。 */
  readonly catalogPrompt: string;
}

/**
 * 把（已按会话/层/渠道过滤后的）工具面拆成「直连 + 折叠目录」。
 *
 * 入参必须是最终可见的工具列表——折叠不能绕过任何上游门控。
 */
export function buildFoldedToolSurface(
  tools: readonly GatewayToolDefinition[],
  options?: { catalogMaxChars?: number },
): FoldedToolSurface {
  const directTools: GatewayToolDefinition[] = [];
  const deferredTools: GatewayToolDefinition[] = [];
  for (const tool of tools) {
    if (shouldFoldTool(tool.function.name)) {
      deferredTools.push(tool);
    } else {
      directTools.push(tool);
    }
  }
  const visibleNames = tools.map((tool) => tool.function.name);
  return {
    directTools,
    deferredTools,
    visibleNames,
    catalogPrompt: renderToolCatalog(deferredTools, options),
  };
}

/** 目录行预算：8,000 字符 ≈ 2,000 tokens（对齐参考库 `INLINE_BUDGET`）。 */
export const TOOL_CATALOG_MAX_CHARS_DEFAULT = 8_000;
const CATALOG_DESCRIPTION_LIMIT = 120;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonSchemaTypeLabel(schema: unknown): string {
  const record = asRecord(schema);
  if (!record) return 'unknown';
  const enumValues = Array.isArray(record['enum']) ? record['enum'] : null;
  if (enumValues && enumValues.length > 0) {
    const shown = enumValues.slice(0, 4).map((value) => JSON.stringify(value));
    return enumValues.length > 4 ? `${shown.join('|')}|…` : shown.join('|');
  }
  const anyOf = Array.isArray(record['anyOf']) ? record['anyOf'] : null;
  if (anyOf && anyOf.length > 0) {
    const labels = [
      ...new Set(
        anyOf
          .map((entry) => asRecord(entry)?.['type'])
          .filter((value): value is string => typeof value === 'string'),
      ),
    ];
    if (labels.length > 0) return labels.join('|');
  }
  const type = record['type'];
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) {
    return type.filter((value): value is string => typeof value === 'string').join('|');
  }
  return 'unknown';
}

/**
 * 紧凑签名：`name(a: string, b?: number)`（对齐参考库 catalog 行的 signature）。
 *
 * 顶级 `anyOf` 表示「必填其一」的替代组（例如 codegraph_node 的
 * `symbol` / `file`）：签名会追加 `[必填其一: …]`，避免目录把互斥必填字段
 * 渲染成全可选导致模型空参调用。
 */
export function renderToolSignature(toolName: string, parameters: unknown): string {
  const record = asRecord(parameters);
  const properties = record ? asRecord(record['properties']) : null;
  if (!properties || Object.keys(properties).length === 0) {
    const alternatives = topLevelRequiredAlternatives(record);
    return alternatives.length === 0
      ? `${toolName}()`
      : `${toolName}() [必填其一: ${alternatives}]`;
  }
  const required = new Set(
    Array.isArray(record?.['required'])
      ? (record['required'] as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
  );
  const parts = Object.entries(properties).map(
    ([key, value]) => `${key}${required.has(key) ? '' : '?'}: ${jsonSchemaTypeLabel(value)}`,
  );
  const signature = `${toolName}(${parts.join(', ')})`;
  const alternatives = topLevelRequiredAlternatives(record);
  return alternatives.length === 0 ? signature : `${signature} [必填其一: ${alternatives}]`;
}

/** 顶级 `anyOf` 的 required 组渲染：`symbol | file`、`a+b | c`。 */
function topLevelRequiredAlternatives(record: Record<string, unknown> | null): string {
  const anyOf = record && Array.isArray(record['anyOf']) ? record['anyOf'] : null;
  if (!anyOf || anyOf.length === 0) return '';
  const groups = anyOf
    .map((entry) => asRecord(entry)?.['required'])
    .filter((value): value is unknown[] => Array.isArray(value))
    .map((value) =>
      value.filter((item): item is string => typeof item === 'string' && item.length > 0),
    )
    .filter((group) => group.length > 0)
    .map((group) => group.join('+'));
  return groups.join(' | ');
}

function firstLine(value: string): string {
  const line = value.split('\n', 1)[0]?.trim() ?? '';
  return line.length > CATALOG_DESCRIPTION_LIMIT
    ? `${line.slice(0, CATALOG_DESCRIPTION_LIMIT - 3)}...`
    : line;
}

/**
 * 渲染折叠工具目录（按名称排序，稳定字节序）。
 *
 * 超出预算时截断并提示剩余数量；模型可用 `tool_search` 检索未内联的工具。
 */
export function renderToolCatalog(
  deferredTools: readonly GatewayToolDefinition[],
  options?: { catalogMaxChars?: number },
): string {
  if (deferredTools.length === 0) return '';
  const maxChars = Math.max(200, options?.catalogMaxChars ?? TOOL_CATALOG_MAX_CHARS_DEFAULT);
  const sorted = [...deferredTools].sort((left, right) =>
    left.function.name.localeCompare(right.function.name),
  );
  const header =
    '## 可折叠工具目录\n先用 `tool_search` 查完整参数，再用 `tool_invoke({ tool, arguments })` 调用；不要凭记忆猜参数。';
  const lines: string[] = [];
  let used = header.length;
  for (let index = 0; index < sorted.length; index += 1) {
    const tool = sorted[index]!;
    const description = firstLine(tool.function.description ?? '');
    const suffix = description.length > 0 ? ` // ${description}` : '';
    const line = `- ${renderToolSignature(tool.function.name, tool.function.parameters)}${suffix}`;
    // 至少保留一行；之后超预算就截断并给出剩余数量。
    if (lines.length > 0 && used + line.length + 1 > maxChars) {
      const remaining = sorted.length - index;
      lines.push(`- …（其余 ${remaining} 个折叠工具未内联，用 tool_search 检索）`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return [header, ...lines].join('\n');
}

export type ToolInvokeDecision =
  | { readonly kind: 'pass' }
  | { readonly kind: 'rewrite'; readonly toolName: string; readonly rawInput: unknown }
  | { readonly kind: 'reject'; readonly message: string };

/**
 * 解包 `tool_invoke` 请求（纯函数，便于单测）。
 *
 * - 非 `tool_invoke`：`pass`；
 * - 合法且内层工具在 allowlist 内且已启用：`rewrite`（后续按内层工具走完整门控）；
 * - 其余：`reject`（绝不降级成放行）。
 */
export function resolveToolInvokeRequest(input: {
  toolName: string;
  rawInput: unknown;
  allowlist: readonly string[];
  isToolEnabled: (toolName: string) => boolean;
}): ToolInvokeDecision {
  if (input.toolName !== TOOL_INVOKE_TOOL_NAME) return { kind: 'pass' };

  const record = asRecord(input.rawInput);
  const innerTool = record?.['tool'];
  if (typeof innerTool !== 'string' || innerTool.trim().length === 0) {
    return {
      kind: 'reject',
      message:
        'tool_invoke 需要参数 { tool: string, arguments: object }：tool 传折叠工具名（见系统提示的可折叠工具目录）。',
    };
  }
  const toolName = innerTool.trim();
  if (toolName === TOOL_INVOKE_TOOL_NAME || toolName === TOOL_SEARCH_TOOL_NAME) {
    return {
      kind: 'reject',
      message: `tool_invoke 不能嵌套调用 "${toolName}"；直接调用该工具即可。`,
    };
  }
  if (!input.allowlist.includes(toolName)) {
    return {
      kind: 'reject',
      message: `Tool "${toolName}" is not available in this session; use tool_search to find an available folded tool.`,
    };
  }
  if (!input.isToolEnabled(toolName)) {
    return {
      kind: 'reject',
      message: `Tool "${toolName}" is disabled for this session.`,
    };
  }
  const rawArguments = record?.['arguments'];
  if (rawArguments !== undefined && asRecord(rawArguments) === null) {
    return {
      kind: 'reject',
      message: 'tool_invoke 的 arguments 必须是对象（与 tool_search 返回的 schema 一致）。',
    };
  }
  return { kind: 'rewrite', toolName, rawInput: rawArguments ?? {} };
}

/** `tool_invoke` 的模型可见定义（参数与说明）。 */
export const toolInvokeDefinition = {
  name: TOOL_INVOKE_TOOL_NAME,
  description:
    '调用未直接暴露的「折叠工具」。先读系统提示中的可折叠工具目录获取工具名与签名；参数不确定时先用 tool_search 查完整 schema。参数：tool=工具名，arguments=与 schema 一致的对象。权限与直接调用完全相同。',
} as const;

/** `tool_search` 的模型可见定义（参数与说明）。 */
export const toolSearchDefinition = {
  name: TOOL_SEARCH_TOOL_NAME,
  description:
    '在折叠工具目录中检索工具（按工具名或描述关键词），返回匹配工具的完整描述与 JSON Schema，供随后 tool_invoke 使用。',
} as const;

/** `tool_search` 入参 schema（沙箱侧校验，与模型可见 JSON Schema 保持一致）。 */
export const toolSearchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional().default(8),
});
