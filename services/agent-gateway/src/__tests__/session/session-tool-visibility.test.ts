import { describe, expect, it } from 'vitest';
import type { GatewayToolDefinition } from '../../tools/tool-definitions.js';
import {
  filterEnabledGatewayToolsForDialogueMode,
  filterEnabledGatewayToolsForSession,
  isGatewayToolEnabledForSessionMetadata,
} from '../../session/session-tool-visibility.js';
import { MCP_MANAGE_SERVERS_TOOL_NAME } from '../../mcp/mcp-manage-tool-name.js';
import { MEMORY_MANAGE_TOOL_NAME } from '../../memory/memory-manage-tool-name.js';
import { SKILL_MANAGE_TOOL_NAME } from '../../skill/skill-manage-tool-name.js';
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

describe('schedule_manage 会话可见性', () => {
  it('个人会话可见（含 task 子代理）', () => {
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, { source: 'desktop' }),
    ).toBe(true);
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, { createdByTool: 'task' }),
    ).toBe(true);
  });

  it('cron / team / channel / clarify 均不可见', () => {
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
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, { source: 'channel' }),
    ).toBe(false);
    expect(
      isGatewayToolEnabledForSessionMetadata(SCHEDULE_MANAGE_TOOL_NAME, {
        dialogueMode: 'clarify',
      }),
    ).toBe(false);
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
    expect(isGatewayToolEnabledForSessionMetadata('mcp__omo__adapter_catalog', metadata)).toBe(
      false,
    );
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
    expect(isGatewayToolEnabledForSessionMetadata('mcp__omo__adapter_catalog', metadata)).toBe(
      false,
    );
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
