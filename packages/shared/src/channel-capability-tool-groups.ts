/**
 * 渠道能力分组规则 —— **唯一事实来源**。
 *
 * 背景（2026-11-02）：该规则此前在
 * `services/agent-gateway/src/channels/channel-capability-tool-groups.ts` 与
 * `apps/web/src/components/common/display/channel-capability-tool-groups.ts` **各有一份手写实现**，
 * 且已发生漂移：委派工具的规范名 `subagent` 只在一侧登记，另一侧落 `other` 分组，
 * 导致渠道「按组开关工具」与能力目录计数错位。现上移至此，两端只做再导出。
 *
 * 形态说明（有意区分，不是漂移）：
 * - {@link ChannelCapabilityContextToolPromptInjections} —— **持久化/传输形态**，字段可缺省
 *   （渠道配置由用户部分设置）；
 * - {@link NormalizedChannelCapabilityContextToolPromptInjections} —— **归一化形态**，字段必有
 *   （UI 状态与提示词注入逻辑消费）。
 */

/** 能力目录的分组键。新增分组时必须同步 {@link CHANNEL_CAPABILITY_TOOL_GROUP_KEYS} 与默认值。 */
export type ChannelCapabilityToolGroupKey =
  | 'web'
  | 'lsp'
  | 'files'
  | 'shell'
  | 'orchestration'
  | 'session'
  | 'mcp'
  | 'desktop'
  | 'repo'
  | 'channel'
  | 'other';

/** 分组键的有序全集（UI 选项、计数与归一化的遍历来源）。 */
export const CHANNEL_CAPABILITY_TOOL_GROUP_KEYS = [
  'web',
  'lsp',
  'files',
  'shell',
  'orchestration',
  'session',
  'mcp',
  'desktop',
  'repo',
  'channel',
  'other',
] as const satisfies readonly ChannelCapabilityToolGroupKey[];

/** 持久化/传输形态：字段可缺省。 */
export interface ChannelCapabilityContextToolPromptInjections {
  web?: boolean;
  lsp?: boolean;
  files?: boolean;
  shell?: boolean;
  orchestration?: boolean;
  session?: boolean;
  mcp?: boolean;
  desktop?: boolean;
  repo?: boolean;
  channel?: boolean;
  other?: boolean;
}

/** 归一化形态：字段必有。 */
export type NormalizedChannelCapabilityContextToolPromptInjections =
  Required<ChannelCapabilityContextToolPromptInjections>;

/** 归一化时的缺省值（全部开启）。 */
export const DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS: Readonly<NormalizedChannelCapabilityContextToolPromptInjections> =
  {
    web: true,
    lsp: true,
    files: true,
    shell: true,
    orchestration: true,
    session: true,
    mcp: true,
    desktop: true,
    repo: true,
    channel: true,
    other: true,
  };

/**
 * 把可缺省的持久化形态补全为归一化形态（非布尔值一律回落默认值）。
 */
export function normalizeChannelCapabilityContextToolPromptInjections(
  input?: ChannelCapabilityContextToolPromptInjections | null,
): NormalizedChannelCapabilityContextToolPromptInjections {
  const resolveFlag = (key: ChannelCapabilityToolGroupKey): boolean => {
    const value = input?.[key];
    return typeof value === 'boolean'
      ? value
      : DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS[key];
  };

  return {
    web: resolveFlag('web'),
    lsp: resolveFlag('lsp'),
    files: resolveFlag('files'),
    shell: resolveFlag('shell'),
    orchestration: resolveFlag('orchestration'),
    session: resolveFlag('session'),
    mcp: resolveFlag('mcp'),
    desktop: resolveFlag('desktop'),
    repo: resolveFlag('repo'),
    channel: resolveFlag('channel'),
    other: resolveFlag('other'),
  };
}

/**
 * 工具名（或能力标签）→ 能力目录分组。
 *
 * 注意：委派工具的**历史别名 `task`**、**规范名 `subagent`**（`TASK_TOOL_NAME`）与
 * Claude Code 兼容呈报名 `Agent` 同属一个工具，均归 `orchestration`。
 * 三者必须同时登记 —— 只登记别名曾导致规范名落 `other`（本模块上移的起因）。
 */
export function resolveChannelCapabilityToolGroup(label: string): ChannelCapabilityToolGroupKey {
  if (label.startsWith('Plugin') || label.startsWith('Weixin') || label.startsWith('Feishu')) {
    return 'channel';
  }
  if (label.startsWith('lsp_')) {
    return 'lsp';
  }
  if (
    label.startsWith('ast_grep_') ||
    label.startsWith('codegraph_') ||
    label === 'repo_clone' ||
    label === 'repo_overview'
  ) {
    return 'repo';
  }

  switch (label) {
    case 'websearch':
    case 'codesearch':
    case 'webfetch':
      return 'web';
    case 'list':
    case 'read':
    case 'glob':
    case 'grep':
    case 'edit':
    case 'multi_edit':
    case 'write':
    case 'patch':
    case 'workspace_review_status':
    case 'workspace_review_diff':
    case 'workspace_create_directory':
    case 'workspace_review_revert':
      return 'files';
    case 'bash':
    case 'run_bash_in_background':
    case 'bash_output':
    case 'bash_kill':
    case 'interactive_bash':
    case 'background_output':
    case 'background_cancel':
    case 'read_tool_output':
      return 'shell';
    case 'task_create':
    case 'task_get':
    case 'task_list':
    case 'task_update':
    case 'AskUserQuestion':
    case 'EnterPlanMode':
    case 'ExitPlanMode':
    case 'task':
    case 'subagent':
    case 'Agent':
    case 'Skill':
    case 'batch':
      return 'orchestration';
    case 'session_list':
    case 'session_read':
    case 'session_search':
    case 'session_info':
    case 'todowrite':
    case 'todoread':
    case 'subtodowrite':
    case 'subtodoread':
      return 'session';
    case 'skill_mcp':
    case 'mcp_list_tools':
    case 'mcp_call':
      return 'mcp';
    case 'desktop_automation':
    case 'desktop_control':
    case 'look_at':
    case 'generate_image':
      return 'desktop';
    default:
      return 'other';
  }
}

/**
 * 分组规则的**契约表**（黄金表）：两端与其测试遍历它做一致性断言。
 *
 * 用途：任何一侧漏登记 / 规则被误改都会让测试失败；`subagent` 与 `repo_clone` /
 * `repo_overview` 这三条是历史上真实漏过的条目，必须保留。
 */
export const CHANNEL_CAPABILITY_TOOL_GROUP_CONTRACT: ReadonlyArray<{
  readonly label: string;
  readonly group: ChannelCapabilityToolGroupKey;
}> = [
  // 前缀族（用样本名断言）
  { label: 'PluginEcho', group: 'channel' },
  { label: 'WeixinInbound', group: 'channel' },
  { label: 'FeishuOutbound', group: 'channel' },
  { label: 'lsp_diagnostics', group: 'lsp' },
  { label: 'lsp_rename', group: 'lsp' },
  { label: 'ast_grep_search', group: 'repo' },
  { label: 'codegraph_query', group: 'repo' },
  // 历史上真实漏过的条目（回归锚点）
  { label: 'repo_clone', group: 'repo' },
  { label: 'repo_overview', group: 'repo' },
  { label: 'task', group: 'orchestration' },
  { label: 'subagent', group: 'orchestration' },
  { label: 'Agent', group: 'orchestration' },
  // 其余显式条目
  { label: 'websearch', group: 'web' },
  { label: 'codesearch', group: 'web' },
  { label: 'webfetch', group: 'web' },
  { label: 'list', group: 'files' },
  { label: 'read', group: 'files' },
  { label: 'glob', group: 'files' },
  { label: 'grep', group: 'files' },
  { label: 'edit', group: 'files' },
  { label: 'multi_edit', group: 'files' },
  { label: 'write', group: 'files' },
  { label: 'patch', group: 'files' },
  { label: 'workspace_review_status', group: 'files' },
  { label: 'workspace_review_diff', group: 'files' },
  { label: 'workspace_create_directory', group: 'files' },
  { label: 'workspace_review_revert', group: 'files' },
  { label: 'bash', group: 'shell' },
  { label: 'run_bash_in_background', group: 'shell' },
  { label: 'bash_output', group: 'shell' },
  { label: 'bash_kill', group: 'shell' },
  { label: 'interactive_bash', group: 'shell' },
  { label: 'background_output', group: 'shell' },
  { label: 'background_cancel', group: 'shell' },
  { label: 'read_tool_output', group: 'shell' },
  { label: 'task_create', group: 'orchestration' },
  { label: 'task_get', group: 'orchestration' },
  { label: 'task_list', group: 'orchestration' },
  { label: 'task_update', group: 'orchestration' },
  { label: 'AskUserQuestion', group: 'orchestration' },
  { label: 'EnterPlanMode', group: 'orchestration' },
  { label: 'ExitPlanMode', group: 'orchestration' },
  { label: 'Skill', group: 'orchestration' },
  { label: 'batch', group: 'orchestration' },
  { label: 'session_list', group: 'session' },
  { label: 'session_read', group: 'session' },
  { label: 'session_search', group: 'session' },
  { label: 'session_info', group: 'session' },
  { label: 'todowrite', group: 'session' },
  { label: 'todoread', group: 'session' },
  { label: 'subtodowrite', group: 'session' },
  { label: 'subtodoread', group: 'session' },
  { label: 'skill_mcp', group: 'mcp' },
  { label: 'mcp_list_tools', group: 'mcp' },
  { label: 'mcp_call', group: 'mcp' },
  { label: 'desktop_automation', group: 'desktop' },
  { label: 'desktop_control', group: 'desktop' },
  { label: 'look_at', group: 'desktop' },
  { label: 'generate_image', group: 'desktop' },
  { label: 'mcp__lsp__diagnostics', group: 'other' },
  { label: 'some_unknown_tool', group: 'other' },
];
