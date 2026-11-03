/**
 * 渠道能力分组与提示词注入开关 —— 前端侧。
 *
 * **规则、默认值、归一化与分组键类型都不在本文件定义**：它们是 `@openAwork/shared`
 * 里的唯一事实来源。本文件只保留前端 UI 专属的构造器（分组选项、可用性推导、计数），
 * 并把共享实现按其**既有名字**再导出，使既有消费点无需改动。
 *
 * 背景（2026-11-02）：此处此前有一份手写的 `classifyCapabilityToolGroup` 副本，与后端
 * `resolveChannelCapabilityToolGroup` 逐条漂移 —— 委派工具规范名 `subagent` 未登记，
 * 前端能力目录把它归入 `other`，而后端归 `orchestration`。现统一为共享实现。
 */
import {
  DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
  normalizeChannelCapabilityContextToolPromptInjections,
  resolveChannelCapabilityToolGroup,
} from '@openAwork/shared';
import type { CapabilityDescriptor, ChannelCapabilityToolGroupKey } from '@openAwork/shared';

import type {
  ChannelCapabilityCatalogToolGroupCounts,
  ChannelCapabilityContextToolPromptInjections,
  ChannelDescriptorTool,
  ChannelPermissionsEntry,
} from './channel-subscription-settings.types.js';

export {
  DEFAULT_CHANNEL_CAPABILITY_CONTEXT_TOOL_PROMPT_INJECTIONS,
  normalizeChannelCapabilityContextToolPromptInjections,
};

/** 工具名（能力标签）→ 能力目录分组。与后端 `resolveChannelCapabilityToolGroup` 为**同一实现**，此处保留前端既有名字。 */
export const classifyCapabilityToolGroup = resolveChannelCapabilityToolGroup;

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
    description: '子代理（`subagent`，历史别名 `task`）、`Agent`、`Skill`、计划模式与问答流程。',
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
