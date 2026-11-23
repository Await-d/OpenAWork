import { describe, expect, it } from 'vitest';
import type { GatewayToolDefinition } from '../../tools/tool-definitions.js';
import {
  filterEnabledGatewayToolsForDialogueMode,
  filterEnabledGatewayToolsForSession,
  isGatewayToolEnabledForSessionMetadata,
  resolveChannelToolKey,
  shouldAutoApproveToolForSessionMetadata,
} from '../../session/session-tool-visibility.js';
import { runWithChannelActorPolicy } from '../../channels/channel-actor-scope.js';
import { MCP_MANAGE_SERVERS_TOOL_NAME } from '../../mcp/mcp-manage-tool-name.js';
import { MEMORY_MANAGE_TOOL_NAME } from '../../memory/memory-manage-tool-name.js';
import { SKILL_MANAGE_TOOL_NAME } from '../../skill/skill-manage-tool-name.js';
import { PLUGIN_MANAGE_TOOL_NAME } from '../../plugin/plugin-manage-tool-name.js';
import { SCHEDULE_MANAGE_TOOL_NAME } from '../../cron/schedule-manage-tool-name.js';
import { AGENT_MANAGE_TOOL_NAME } from '../../agent/agent-manage-tool-name.js';
import { TEAM_WORKSPACE_MANAGE_TOOL_NAME } from '../../team/team-workspace-manage-tool-name.js';

const FEISHU_TOOL_NAMES = [
  'FeishuSendImage',
  'FeishuSendFile',
  'FeishuListChatMembers',
  'FeishuAtMember',
  'FeishuSendUrgent',
  'FeishuBitableListApps',
  'FeishuBitableListTables',
  'FeishuBitableListFields',
  'FeishuBitableGetRecords',
  'FeishuBitableCreateRecords',
  'FeishuBitableUpdateRecords',
  'FeishuBitableDeleteRecords',
] as const;

function makeTool(name: string): GatewayToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: name,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: false,
    },
  };
}

describe('mcp_manage_servers 会话可见性', () => {
  it('个人会话可见（含 task 子代理）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(MCP_MANAGE_SERVERS_TOOL_NAME, { source: 'desktop' }),
    ).toBe(true);
    expect(
      isGatewayToolEnabledForSessionMetadata(MCP_MANAGE_SERVERS_TOOL_NAME, {
        createdByTool: 'task',
      }),
    ).toBe(true);
  });

  it('team 会话不可见（teamWorkspaceId / teamRoleInstance）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(MCP_MANAGE_SERVERS_TOOL_NAME, {
        teamWorkspaceId: 'ws-1',
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(MCP_MANAGE_SERVERS_TOOL_NAME, {
        teamRoleInstance: { role: 'executor' },
      }),
    ).toBe(false);
  });

  it('cron / channel 会话不可见', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(MCP_MANAGE_SERVERS_TOOL_NAME, { source: 'cron' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(MCP_MANAGE_SERVERS_TOOL_NAME, { source: 'channel' }),
    ).toBe(false);
  });

  it('clarify 模式不可见（只读白名单之外）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(MCP_MANAGE_SERVERS_TOOL_NAME, {
        dialogueMode: 'clarify',
      }),
    ).toBe(false);
  });
});

describe('渠道会话扩展管理', () => {
  const enabled = {
    source: 'channel',
    channelLlmToolsEnabled: true,
    channelExtensionManagementEnabled: true,
  };

  it.each([SKILL_MANAGE_TOOL_NAME, MCP_MANAGE_SERVERS_TOOL_NAME])(
    '%s 仅在显式开启且成员允许时可见',
    (name) => {
      expect(isGatewayToolEnabledForSessionMetadata(name, enabled)).toBe(true);
      expect(
        isGatewayToolEnabledForSessionMetadata(name, {
          ...enabled,
          channelExtensionManagementEnabled: false,
        }),
      ).toBe(false);
      expect(
        isGatewayToolEnabledForSessionMetadata(name, { ...enabled, channelLlmToolsEnabled: false }),
      ).toBe(false);
      expect(
        isGatewayToolEnabledForSessionMetadata(name, {
          ...enabled,
          channelToolAllowlist: ['PluginSendMessage'],
        }),
      ).toBe(false);
      expect(
        isGatewayToolEnabledForSessionMetadata(name, { ...enabled, channelToolAllowlist: [name] }),
      ).toBe(true);
      expect(
        isGatewayToolEnabledForSessionMetadata(name, { ...enabled, teamWorkspaceId: 'team' }),
      ).toBe(false);
      expect(
        isGatewayToolEnabledForSessionMetadata(name, { ...enabled, dialogueMode: 'clarify' }),
      ).toBe(false);
    },
  );

  it('不放开其他自助管理工具', () => {
    for (const name of [
      MEMORY_MANAGE_TOOL_NAME,
      PLUGIN_MANAGE_TOOL_NAME,
      AGENT_MANAGE_TOOL_NAME,
      TEAM_WORKSPACE_MANAGE_TOOL_NAME,
    ]) {
      expect(isGatewayToolEnabledForSessionMetadata(name, enabled)).toBe(false);
    }
  });
});

describe('memory_manage 会话可见性', () => {
  it('个人会话可见（含 task 子代理）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(MEMORY_MANAGE_TOOL_NAME, { source: 'desktop' }),
    ).toBe(true);
    expect(
      isGatewayToolEnabledForSessionMetadata(MEMORY_MANAGE_TOOL_NAME, { createdByTool: 'task' }),
    ).toBe(true);
  });

  it('team / cron / channel / clarify 均不可见', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(MEMORY_MANAGE_TOOL_NAME, { teamWorkspaceId: 'ws-1' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(MEMORY_MANAGE_TOOL_NAME, {
        teamRoleInstance: { role: 'executor' },
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(MEMORY_MANAGE_TOOL_NAME, { source: 'cron' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(MEMORY_MANAGE_TOOL_NAME, { source: 'channel' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(MEMORY_MANAGE_TOOL_NAME, { dialogueMode: 'clarify' }),
    ).toBe(false);
  });
});

describe('skill_manage 会话可见性', () => {
  it('个人会话可见（含 task 子代理）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(SKILL_MANAGE_TOOL_NAME, { source: 'desktop' }),
    ).toBe(true);
    expect(
      isGatewayToolEnabledForSessionMetadata(SKILL_MANAGE_TOOL_NAME, { createdByTool: 'task' }),
    ).toBe(true);
  });

  it('team / cron / channel / clarify 均不可见', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(SKILL_MANAGE_TOOL_NAME, { teamWorkspaceId: 'ws-1' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(SKILL_MANAGE_TOOL_NAME, {
        teamRoleInstance: { role: 'executor' },
      }),
    ).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata(SKILL_MANAGE_TOOL_NAME, { source: 'cron' })).toBe(
      false,
    );
    expect(
      isGatewayToolEnabledForSessionMetadata(SKILL_MANAGE_TOOL_NAME, { source: 'channel' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(SKILL_MANAGE_TOOL_NAME, { dialogueMode: 'clarify' }),
    ).toBe(false);
  });
});

describe('plugin_manage 会话可见性', () => {
  it('个人会话可见（含 task 子代理）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(PLUGIN_MANAGE_TOOL_NAME, { source: 'desktop' }),
    ).toBe(true);
    expect(
      isGatewayToolEnabledForSessionMetadata(PLUGIN_MANAGE_TOOL_NAME, { createdByTool: 'task' }),
    ).toBe(true);
  });

  it('team / cron / channel / clarify 均不可见', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(PLUGIN_MANAGE_TOOL_NAME, { teamWorkspaceId: 'ws-1' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(PLUGIN_MANAGE_TOOL_NAME, {
        teamRoleInstance: { role: 'executor' },
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(PLUGIN_MANAGE_TOOL_NAME, { source: 'cron' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(PLUGIN_MANAGE_TOOL_NAME, { source: 'channel' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(PLUGIN_MANAGE_TOOL_NAME, {
        dialogueMode: 'clarify',
      }),
    ).toBe(false);
  });
});

describe('schedule_manage 会话可见性', () => {
  it('个人会话可见（含 task 子代理）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, { source: 'desktop' }),
    ).toBe(true);
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, { createdByTool: 'task' }),
    ).toBe(true);
  });

  it('cron / team / clarify 不可见', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, { source: 'cron' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, {
        teamWorkspaceId: 'ws-1',
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, {
        teamRoleInstance: { role: 'executor' },
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, {
        dialogueMode: 'clarify',
      }),
    ).toBe(false);
  });

  it('渠道会话放通（启用过 LLM 工具时）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, {
        source: 'channel',
        channelLlmToolsEnabled: true,
      }),
    ).toBe(true);
    // 未启用 LLM 工具的渠道会话仍不可见（与其它渠道工具同一道闸）。
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, { source: 'channel' }),
    ).toBe(false);
  });

  it('渠道白名单仍然生效：限缩过的渠道不因放通而额外获得该工具', () => {
    const base = { source: 'channel', channelLlmToolsEnabled: true };
    // 显式只留渠道回发工具 → schedule_manage 不在白名单内，不可见。
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, {
        ...base,
        channelToolAllowlist: ['PluginSendMessage'],
      }),
    ).toBe(false);
    // 通配 / all / 显式列名 → 可见（与其它渠道工具的 allowlist 语义一致）。
    for (const allowlist of [['*'], ['all'], [SCHEDULE_MANAGE_TOOL_NAME]]) {
      expect(
        isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, {
          ...base,
          channelToolAllowlist: allowlist,
        }),
      ).toBe(true);
    }
  });
});

describe('agent_manage 会话可见性', () => {
  it('个人会话可见（含 task 子代理）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(AGENT_MANAGE_TOOL_NAME, { source: 'desktop' }),
    ).toBe(true);
    expect(
      isGatewayToolEnabledForSessionMetadata(AGENT_MANAGE_TOOL_NAME, { createdByTool: 'task' }),
    ).toBe(true);
  });

  it('team / cron / channel / clarify 均不可见', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(AGENT_MANAGE_TOOL_NAME, { teamWorkspaceId: 'ws-1' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(AGENT_MANAGE_TOOL_NAME, {
        teamRoleInstance: { role: 'executor' },
      }),
    ).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata(AGENT_MANAGE_TOOL_NAME, { source: 'cron' })).toBe(
      false,
    );
    expect(
      isGatewayToolEnabledForSessionMetadata(AGENT_MANAGE_TOOL_NAME, { source: 'channel' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(AGENT_MANAGE_TOOL_NAME, { dialogueMode: 'clarify' }),
    ).toBe(false);
  });
});

describe('team_workspace_manage 会话可见性', () => {
  it('个人会话可见（含 task 子代理）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(TEAM_WORKSPACE_MANAGE_TOOL_NAME, {
        source: 'desktop',
      }),
    ).toBe(true);
    expect(
      isGatewayToolEnabledForSessionMetadata(TEAM_WORKSPACE_MANAGE_TOOL_NAME, {
        createdByTool: 'task',
      }),
    ).toBe(true);
  });

  it('team / cron / channel / clarify 均不可见', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(TEAM_WORKSPACE_MANAGE_TOOL_NAME, {
        teamWorkspaceId: 'ws-1',
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(TEAM_WORKSPACE_MANAGE_TOOL_NAME, {
        teamRoleInstance: { role: 'executor' },
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(TEAM_WORKSPACE_MANAGE_TOOL_NAME, { source: 'cron' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(TEAM_WORKSPACE_MANAGE_TOOL_NAME, {
        source: 'channel',
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(TEAM_WORKSPACE_MANAGE_TOOL_NAME, {
        dialogueMode: 'clarify',
      }),
    ).toBe(false);
  });
});

describe('filterEnabledGatewayToolsForDialogueMode — 本轮模式收敛工具面', () => {
  const tools = [makeTool('read'), makeTool('edit'), makeTool('bash'), makeTool('question')];

  it('clarify：只保留只读 + 提问类工具', () => {
    expect(
      filterEnabledGatewayToolsForDialogueMode(tools, 'clarify').map((tool) => tool.function.name),
    ).toEqual(['read', 'question']);
  });

  it('coding / programmer：不额外过滤', () => {
    for (const mode of ['coding', 'programmer'] as const) {
      expect(
        filterEnabledGatewayToolsForDialogueMode(tools, mode).map((tool) => tool.function.name),
      ).toEqual(['read', 'edit', 'bash', 'question']);
    }
  });

  it('未指定模式（team / channel 等）：不额外过滤', () => {
    expect(
      filterEnabledGatewayToolsForDialogueMode(tools, undefined).map((tool) => tool.function.name),
    ).toEqual(['read', 'edit', 'bash', 'question']);
  });
});

/**
 * 来源托管会话（渠道 / 定时任务）本就没有对话模式：其 metadata 里的
 * `dialogueMode` 只可能是网页端误写的脏值。若让澄清只读收敛在该值上生效，
 * 澄清白名单（不含任何渠道回复工具）会把渠道会话的回复工具整套过滤掉 ——
 * 表现为「渠道里再也回不了消息」。这里锁定豁免范围：非配置类工具豁免，
 * 配置类管理工具保留 fail-closed。
 */
describe('来源会话不受澄清只读收敛（防脏 dialogueMode 让渠道失能）', () => {
  it('渠道会话即使带 dialogueMode=clarify，渠道回复工具仍可见', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata('PluginSendMessage', {
        source: 'channel',
        dialogueMode: 'clarify',
      }),
    ).toBe(true);
  });

  it('定时任务会话同样不受澄清收敛', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata('read', { source: 'cron', dialogueMode: 'clarify' }),
    ).toBe(true);
  });

  it('配置类管理工具保留 fail-closed：不得因脏值在来源会话里多开配置入口', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(SKILL_MANAGE_TOOL_NAME, {
        source: 'channel',
        channelLlmToolsEnabled: true,
        channelExtensionManagementEnabled: true,
        dialogueMode: 'clarify',
      }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(MCP_MANAGE_SERVERS_TOOL_NAME, {
        source: 'channel',
        dialogueMode: 'clarify',
      }),
    ).toBe(false);
  });

  it('普通会话的澄清收敛不受影响', () => {
    expect(isGatewayToolEnabledForSessionMetadata('bash', { dialogueMode: 'clarify' })).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('read', { dialogueMode: 'clarify' })).toBe(true);
  });
});

describe('session tool visibility', () => {
  it('disables desktop control tools for channel-managed sessions', () => {
    const metadata = { source: 'channel' };

    expect(isGatewayToolEnabledForSessionMetadata('desktop_automation', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('desktop_control', metadata)).toBe(false);
  });

  it('keeps desktop control tools visible for normal desktop sessions', () => {
    const metadata = { source: 'desktop' };

    expect(isGatewayToolEnabledForSessionMetadata('desktop_automation', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('desktop_control', metadata)).toBe(true);
  });

  it('Given channel-managed metadata disables MCP When checking flat and legacy MCP tools Then neither entry point is visible', () => {
    const metadata = {
      source: 'channel',
      channel: {
        tools: {
          mcp: false,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('mcp_call', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('mcp__lsp__diagnostics', metadata)).toBe(false);
  });

  it('Given channel-managed metadata When channel tools are checked Then channel send tools are visible', () => {
    const metadata = {
      source: 'channel',
      channel: {
        type: 'telegram',
        tools: {},
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('PluginSendMessage', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('PluginReplyMessage', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('PluginSendImage', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('PluginSendFile', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('WeixinSendImage', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('WeixinSendFile', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('FeishuSendImage', metadata)).toBe(false);
  });

  it('Given Weixin channel metadata When Weixin media tools are checked Then they are visible', () => {
    const metadata = {
      source: 'channel',
      channel: {
        type: 'weixin',
        tools: {},
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('WeixinSendImage', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('WeixinSendFile', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('FeishuSendImage', metadata)).toBe(false);
  });

  it('Given Feishu channel metadata When Feishu tools are checked Then they are visible only there', () => {
    const metadata = {
      source: 'channel',
      channel: {
        type: 'feishu',
        tools: {},
      },
    };

    for (const toolName of FEISHU_TOOL_NAMES) {
      expect(isGatewayToolEnabledForSessionMetadata(toolName, metadata)).toBe(true);
    }
    expect(isGatewayToolEnabledForSessionMetadata('WeixinSendImage', metadata)).toBe(false);
  });

  it('Given Feishu channel metadata with a disabled tool When checking visibility Then that tool is hidden', () => {
    const metadata = {
      source: 'channel',
      channel: {
        type: 'feishu',
        tools: {
          FeishuSendUrgent: false,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('FeishuSendImage', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('FeishuSendUrgent', metadata)).toBe(false);
  });

  it('Given channel metadata with a disabled common channel tool When checking visibility Then that tool is hidden', () => {
    const metadata = {
      source: 'channel',
      channel: {
        type: 'telegram',
        tools: {
          PluginSendMessage: false,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('PluginSendMessage', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('PluginReplyMessage', metadata)).toBe(true);
  });

  it('Given channel member allowlist When a channel send tool is omitted Then that tool is hidden even if channel defaults would allow it', () => {
    const metadata = {
      source: 'channel',
      channelToolAllowlist: ['PluginReplyMessage'],
      channel: {
        type: 'telegram',
        tools: {},
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('PluginReplyMessage', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('PluginSendImage', metadata)).toBe(false);
  });

  it('Given normal session metadata When channel tools are checked Then channel send tools are hidden', () => {
    const metadata = { source: 'desktop' };

    expect(isGatewayToolEnabledForSessionMetadata('PluginSendMessage', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('PluginReplyMessage', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('PluginSendImage', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('PluginSendFile', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('WeixinSendImage', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('WeixinSendFile', metadata)).toBe(false);
    for (const toolName of FEISHU_TOOL_NAMES) {
      expect(isGatewayToolEnabledForSessionMetadata(toolName, metadata)).toBe(false);
    }
  });

  it('Given channel-managed metadata without LLM tool opt-in When filtering upstream tools Then no declarations are exposed', () => {
    const metadata = JSON.stringify({
      source: 'channel',
      channel: {
        type: 'qq',
        tools: {
          web_search: true,
        },
      },
    });
    const tools = [
      makeTool('websearch'),
      makeTool('read'),
      makeTool('PluginReplyMessage'),
      makeTool('PluginSendImage'),
    ];

    expect(filterEnabledGatewayToolsForSession(tools, metadata)).toEqual([]);
  });

  it('Given channel-managed metadata without LLM tool opt-in When gateway tools are checked Then only local channel tools are enabled', () => {
    const metadata = {
      source: 'channel',
      taskToolEnabled: true,
      channel: {
        type: 'qq',
        permissions: {
          allowShell: true,
          allowSubAgents: true,
        },
        tools: {
          web_search: true,
          read: true,
          bash: true,
          mcp: true,
          task: true,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('PluginReplyMessage', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('PluginSendImage', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('websearch', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('read', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('bash', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('run_bash_in_background', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('interactive_bash', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('mcp__lsp__diagnostics', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('task', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('Agent', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('generate_image', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('repo_clone', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('codegraph_search', metadata)).toBe(false);
  });

  it('Given channel-managed metadata with LLM tool opt-in When filtering upstream tools Then existing channel policy still applies', () => {
    const metadata = JSON.stringify({
      source: 'channel',
      channelLlmToolsEnabled: true,
      channel: {
        type: 'qq',
        tools: {
          web_search: true,
        },
      },
    });
    const tools = [
      makeTool('websearch'),
      makeTool('desktop_control'),
      makeTool('PluginReplyMessage'),
      makeTool('PluginSendImage'),
      makeTool('WeixinSendImage'),
    ];

    expect(
      filterEnabledGatewayToolsForSession(tools, metadata).map((tool) => tool.function.name),
    ).toEqual(['websearch', 'PluginReplyMessage', 'PluginSendImage']);
  });

  it('Given channel-managed metadata with LLM tool opt-in When only web search is allowed Then unmapped tools stay disabled', () => {
    const metadata = {
      source: 'channel',
      channelLlmToolsEnabled: true,
      channel: {
        type: 'qq',
        tools: {
          web_search: true,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('websearch', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('webfetch', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('generate_image', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('repo_clone', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('codegraph_search', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('run_bash_in_background', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('interactive_bash', metadata)).toBe(false);
  });

  it('Given channel member allowlist When only read is granted Then unrelated model tools remain hidden', () => {
    const metadata = {
      source: 'channel',
      channelLlmToolsEnabled: true,
      channelToolAllowlist: ['read'],
      channel: {
        type: 'qq',
        tools: {
          web_search: true,
          read: true,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('read', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('list', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('websearch', metadata)).toBe(false);
  });

  it('Given channel-managed metadata with LLM tool opt-in When sub-agents are allowed Then task tools follow channel policy', () => {
    const metadata = {
      source: 'channel',
      taskToolEnabled: true,
      channelLlmToolsEnabled: true,
      channel: {
        type: 'qq',
        permissions: {
          allowSubAgents: true,
        },
        tools: {
          task: true,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('task', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('Agent', metadata)).toBe(true);
  });

  it('Given channel-managed metadata with LLM tool opt-in When sub-agent permission is denied Then task tools stay disabled', () => {
    const metadata = {
      source: 'channel',
      taskToolEnabled: true,
      channelLlmToolsEnabled: true,
      channel: {
        type: 'qq',
        permissions: {
          allowSubAgents: false,
        },
        tools: {
          task: true,
        },
      },
    };

    expect(isGatewayToolEnabledForSessionMetadata('task', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('Agent', metadata)).toBe(false);
  });
});

/**
 * G1（261102 修复规范名 subagent 静默漏点）：委派工具的**规范名 `subagent`**
 * 必须在渠道 `channel.tools` 键解析上与历史别名 `task` **逐字一致**。
 *
 * 漏点：`resolveChannelToolKey` 只登记 `case 'task'`，规范名落 `default → null`。
 * 这些用例以 **`'subagent'` 为入参**（此前所有用例都用字面量 `'task'`，故漏点长期未暴露）。
 */
describe('G1：渠道委派工具键解析覆盖规范名 subagent', () => {
  const channelMetadata = (over: {
    tools?: Record<string, boolean>;
    permissions?: Record<string, unknown>;
  }) => ({
    source: 'channel',
    channelLlmToolsEnabled: true,
    channel: {
      type: 'telegram',
      ...(over.tools ? { tools: over.tools } : { tools: {} }),
      ...(over.permissions ? { permissions: over.permissions } : {}),
    },
  });

  type Tri = 'true' | 'false' | 'missing';

  const matrixMetadata = (toolsTask: Tri, allowSubAgents: Tri) => {
    const tools: Record<string, boolean> = {};
    if (toolsTask !== 'missing') {
      tools['task'] = toolsTask === 'true';
    }
    const permissions: Record<string, unknown> = {};
    if (allowSubAgents !== 'missing') {
      permissions['allowSubAgents'] = allowSubAgents === 'true';
    }
    return channelMetadata(
      Object.keys(permissions).length > 0 ? { tools, permissions } : { tools },
    );
  };

  it('resolveChannelToolKey 对 subagent 与 task 解析结果逐字一致（均为 task）', () => {
    expect(resolveChannelToolKey('task')).toBe('task');
    expect(resolveChannelToolKey('subagent')).toBe('task');
    // 反向：未登记的无关工具仍为 null（防止把 default 分支改坏）
    expect(resolveChannelToolKey('nonexistent_tool')).toBeNull();
  });

  it('tools.task=true + allowSubAgents=true → subagent 可见（且与 task 一致）', () => {
    const metadata = channelMetadata({
      tools: { task: true },
      permissions: { allowSubAgents: true },
    });
    expect(isGatewayToolEnabledForSessionMetadata('subagent', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('subagent', metadata)).toBe(
      isGatewayToolEnabledForSessionMetadata('task', metadata),
    );
  });

  it('allowSubAgents=false → subagent 不可见', () => {
    const metadata = channelMetadata({
      tools: { task: true },
      permissions: { allowSubAgents: false },
    });
    expect(isGatewayToolEnabledForSessionMetadata('subagent', metadata)).toBe(false);
  });

  it('allowSubAgents 缺失 → subagent 不可见', () => {
    const metadata = channelMetadata({ tools: { task: true } });
    expect(isGatewayToolEnabledForSessionMetadata('subagent', metadata)).toBe(false);
  });

  it('tools.task 缺失或为 false → subagent 不可见', () => {
    const missing = channelMetadata({ permissions: { allowSubAgents: true } });
    expect(isGatewayToolEnabledForSessionMetadata('subagent', missing)).toBe(false);

    const disabled = channelMetadata({
      tools: { task: false },
      permissions: { allowSubAgents: true },
    });
    expect(isGatewayToolEnabledForSessionMetadata('subagent', disabled)).toBe(false);
  });

  /**
   * 不变量（V2 要求）：经**公共入口**，`subagent` 与 `task` 在全部
   * `channel.tools.task × permissions.allowSubAgents` 组合下**结果始终相同**。
   *
   * 这是对"G1 不可达（`:398` 的 `isTaskToolName` 让 `subagent` 走 `'task'` 字面量）"
   * 这一结论的回归保护：一旦将来有人把 `:295` 的字面量改成传 `toolName`、
   * 或新增一条把 `subagent` 送进 `resolveChannelToolKey` 的路径，本断言即可暴露差异。
   */
  it('公共入口下 subagent 与 task 在全部配置组合下结果一致（不可达性回归保护）', () => {
    const values: Tri[] = ['true', 'false', 'missing'];
    for (const toolsTask of values) {
      for (const allowSubAgents of values) {
        const metadata = matrixMetadata(toolsTask, allowSubAgents);
        const subagent = isGatewayToolEnabledForSessionMetadata('subagent', metadata);
        const task = isGatewayToolEnabledForSessionMetadata('task', metadata);
        expect(subagent, `tools.task=${toolsTask} allowSubAgents=${allowSubAgents}`).toBe(task);
      }
    }
  });
});

describe('渠道成员权限的轮次级作用域', () => {
  const channelMetadataWith = (permissions: Record<string, unknown>) => ({
    source: 'channel',
    channelLlmToolsEnabled: true,
    channel: { tools: { bash: true, read: true }, permissions },
  });

  const DENY_ALL = {
    allowReadHome: false,
    readablePathPrefixes: [] as string[],
    allowWriteOutside: false,
    allowShell: false,
    allowSubAgents: false,
  };

  it('作用域内的本轮权限覆盖会话 metadata（同群成员不互相改权限）', async () => {
    // 会话 metadata 上是「别人」的宽松权限：单独看是放行的。
    const metadata = channelMetadataWith({ allowShell: true, allowSubAgents: true });
    expect(isGatewayToolEnabledForSessionMetadata('bash', metadata)).toBe(true);

    // 本轮是发言者自己那份更严的权限：同一个 metadata 必须判否。
    const scoped = await runWithChannelActorPolicy(
      { permissions: DENY_ALL, toolAllowlist: null },
      async () => isGatewayToolEnabledForSessionMetadata('bash', metadata),
    );

    expect(scoped).toBe(false);
  });

  it('作用域内的成员白名单同时收窄工具面与自动批准', async () => {
    const metadata = channelMetadataWith({ allowShell: true, allowSubAgents: true });

    const scoped = await runWithChannelActorPolicy(
      {
        permissions: { ...DENY_ALL, allowShell: true },
        toolAllowlist: ['read'],
      },
      async () => ({
        read: isGatewayToolEnabledForSessionMetadata('read', metadata),
        bash: isGatewayToolEnabledForSessionMetadata('bash', metadata),
        autoApproveBash: shouldAutoApproveToolForSessionMetadata('bash', metadata),
      }),
    );

    // 可见性与「免审批」同源：白名单外的 bash 既不可见、也不会被自动批准。
    expect(scoped).toEqual({ read: true, bash: false, autoApproveBash: false });
  });

  it('作用域外仍回退会话 metadata（无作用域的续跑路径不受影响）', () => {
    expect(
      shouldAutoApproveToolForSessionMetadata('bash', channelMetadataWith({ allowShell: false })),
    ).toBe(false);
    expect(
      shouldAutoApproveToolForSessionMetadata(
        'bash',
        channelMetadataWith({ allowShell: true, allowSubAgents: true }),
      ),
    ).toBe(true);
  });
});
