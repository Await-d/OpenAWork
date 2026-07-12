import type {
  ChannelCapabilityCatalogToolGroupCounts,
  ChannelCapabilityContextToolPromptInjections,
  ChannelDescriptorTool,
  ChannelPermissionsEntry,
  ChannelCapabilityToolGroupKey,
} from './channel-subscription-settings.types.js';
import type { CapabilityDescriptor } from '@openAwork/shared';

export const DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS: Readonly<ChannelCapabilityContextToolPromptInjections> =
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

export const CHANNEL_CAPABILITY_TOOL_GROUP_OPTIONS = [
  {
    key: 'web',
    label: '网页搜索',
    description: 'websearch / codesearch / webfetch。',
  },
  {
    key: 'lsp',
    label: 'LSP',
    description: '诊断、跳转、引用、重命名等语言服务能力。',
  },
  {
    key: 'files',
    label: '文件与工作区',
    description: '读写文件、目录、补丁和工作区审查。',
  },
  {
    key: 'shell',
    label: 'Shell',
    description: 'bash、后台命令与终端输出相关工具。',
  },
  {
    key: 'orchestration',
    label: '编排与协作',
    description: 'task、Agent、Skill、计划模式和问答流程。',
  },
  {
    key: 'session',
    label: '会话与待办',
    description: 'session、todo 和子待办工具。',
  },
  {
    key: 'mcp',
    label: 'MCP 访问',
    description: 'mcp_list_tools、mcp_call、skill_mcp。',
  },
  {
    key: 'desktop',
    label: '桌面与图像',
    description: '桌面控制、观察与图片生成。',
  },
  {
    key: 'repo',
    label: '仓库分析',
    description: 'repo、ast_grep 与 codegraph 工具。',
  },
  {
    key: 'channel',
    label: '渠道工具',
    description: 'Plugin、Weixin、Feishu 等消息渠道能力。',
  },
  {
    key: 'other',
    label: '其他工具',
    description: '暂未归类或未来新增的工具。',
  },
] as const satisfies ReadonlyArray<{
  key: ChannelCapabilityToolGroupKey;
  label: string;
  description: string;
}>;

function resolvePromptInjectionFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeChannelCapabilityContextToolPromptInjections(
  input?: Partial<ChannelCapabilityContextToolPromptInjections> | null,
): ChannelCapabilityContextToolPromptInjections {
  return {
    web: resolvePromptInjectionFlag(
      input?.web,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.web,
    ),
    lsp: resolvePromptInjectionFlag(
      input?.lsp,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.lsp,
    ),
    files: resolvePromptInjectionFlag(
      input?.files,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.files,
    ),
    shell: resolvePromptInjectionFlag(
      input?.shell,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.shell,
    ),
    orchestration: resolvePromptInjectionFlag(
      input?.orchestration,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.orchestration,
    ),
    session: resolvePromptInjectionFlag(
      input?.session,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.session,
    ),
    mcp: resolvePromptInjectionFlag(
      input?.mcp,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.mcp,
    ),
    desktop: resolvePromptInjectionFlag(
      input?.desktop,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.desktop,
    ),
    repo: resolvePromptInjectionFlag(
      input?.repo,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.repo,
    ),
    channel: resolvePromptInjectionFlag(
      input?.channel,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.channel,
    ),
    other: resolvePromptInjectionFlag(
      input?.other,
      DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS.other,
    ),
  };
}

export function classifyCapabilityToolGroup(label: string): ChannelCapabilityToolGroupKey {
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
    case 'apply_patch':
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
    case 'Skill':
    case 'Agent':
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

function isChannelRuntimeToolKey(key: string): boolean {
  return key.startsWith('Plugin') || key.startsWith('Feishu') || key.startsWith('Weixin');
}

export function buildAvailableChannelCapabilityToolGroups(input: {
  readonly channelLlmToolsEnabled: boolean;
  readonly tools: Record<string, boolean>;
  readonly permissions: Pick<ChannelPermissionsEntry, 'allowShell' | 'allowSubAgents'>;
  readonly descriptorTools?: readonly ChannelDescriptorTool[];
}): ChannelCapabilityContextToolPromptInjections {
  if (!input.channelLlmToolsEnabled) {
    return {
      web: false,
      lsp: false,
      files: false,
      shell: false,
      orchestration: false,
      session: false,
      mcp: false,
      desktop: false,
      repo: false,
      channel: false,
      other: false,
    };
  }

  const canRead = input.tools['read'] === true;
  const canEdit = input.tools['edit'] === true;
  const hasChannelRuntimeTool = [
    ...new Set([
      ...Object.keys(input.tools).filter(isChannelRuntimeToolKey),
      ...(input.descriptorTools ?? []).map((tool) => tool.key).filter(isChannelRuntimeToolKey),
    ]),
  ].some((key) => input.tools[key] !== false);

  return {
    web: input.tools['web_search'] === true,
    lsp: canRead || canEdit,
    files: canRead || canEdit,
    shell: input.tools['bash'] === true && input.permissions.allowShell === true,
    orchestration: input.tools['task'] === true && input.permissions.allowSubAgents === true,
    session: false,
    mcp: input.tools['mcp'] === true,
    desktop: false,
    repo: canRead,
    channel: hasChannelRuntimeTool,
    other: false,
  };
}

export function buildAvailableChannelCapabilityToolGroupsFromCounts(input: {
  readonly channelLlmToolsEnabled: boolean;
  readonly toolGroups: ChannelCapabilityCatalogToolGroupCounts;
}): ChannelCapabilityContextToolPromptInjections {
  if (!input.channelLlmToolsEnabled) {
    return {
      web: false,
      lsp: false,
      files: false,
      shell: false,
      orchestration: false,
      session: false,
      mcp: false,
      desktop: false,
      repo: false,
      channel: false,
      other: false,
    };
  }

  return {
    web: input.toolGroups.web > 0,
    lsp: input.toolGroups.lsp > 0,
    files: input.toolGroups.files > 0,
    shell: input.toolGroups.shell > 0,
    orchestration: input.toolGroups.orchestration > 0,
    session: input.toolGroups.session > 0,
    mcp: input.toolGroups.mcp > 0,
    desktop: input.toolGroups.desktop > 0,
    repo: input.toolGroups.repo > 0,
    channel: input.toolGroups.channel > 0,
    other: input.toolGroups.other > 0,
  };
}

export function hasAvailableChannelCapabilityToolGroups(
  groups: ChannelCapabilityContextToolPromptInjections,
): boolean {
  return Object.values(groups).some((enabled) => enabled === true);
}

export function buildChannelCapabilityToolGroupCounts(
  capabilities: readonly CapabilityDescriptor[],
): ChannelCapabilityCatalogToolGroupCounts {
  const counts: ChannelCapabilityCatalogToolGroupCounts = {
    web: 0,
    lsp: 0,
    files: 0,
    shell: 0,
    orchestration: 0,
    session: 0,
    mcp: 0,
    desktop: 0,
    repo: 0,
    channel: 0,
    other: 0,
  };

  for (const capability of capabilities) {
    if (capability.kind !== 'tool' || capability.callable !== true) {
      continue;
    }
    const key = classifyCapabilityToolGroup(capability.label);
    counts[key] += 1;
  }

  return counts;
}
