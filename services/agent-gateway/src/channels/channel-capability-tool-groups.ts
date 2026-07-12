import type {
  ChannelCapabilityContextToolPromptInjections,
  ChannelCapabilityToolGroupKey,
} from './types.js';

export const DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS: Readonly<
  Required<ChannelCapabilityContextToolPromptInjections>
> = {
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

function resolvePromptInjectionFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeChannelCapabilityContextToolPromptInjections(
  input?: ChannelCapabilityContextToolPromptInjections | null,
): Required<ChannelCapabilityContextToolPromptInjections> {
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

export function resolveChannelCapabilityToolGroup(toolName: string): ChannelCapabilityToolGroupKey {
  if (
    toolName.startsWith('Plugin') ||
    toolName.startsWith('Weixin') ||
    toolName.startsWith('Feishu')
  ) {
    return 'channel';
  }
  if (toolName.startsWith('lsp_')) {
    return 'lsp';
  }
  if (toolName.startsWith('ast_grep_') || toolName.startsWith('codegraph_')) {
    return 'repo';
  }

  switch (toolName) {
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
    case 'repo_clone':
    case 'repo_overview':
      return 'repo';
    default:
      return 'other';
  }
}
