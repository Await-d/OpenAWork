import { describe, expect, it } from 'vitest';
import type { GatewayToolDefinition } from '../../tools/tool-definitions.js';
import {
  filterEnabledGatewayToolsForSession,
  isGatewayToolEnabledForSessionMetadata,
} from '../../session/session-tool-visibility.js';

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

  it('Given normal session metadata When channel tools are checked Then channel send tools are hidden', () => {
    const metadata = { source: 'desktop' };

    expect(isGatewayToolEnabledForSessionMetadata('PluginSendMessage', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('PluginReplyMessage', metadata)).toBe(false);
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
    const tools = [makeTool('websearch'), makeTool('read'), makeTool('PluginReplyMessage')];

    expect(filterEnabledGatewayToolsForSession(tools, metadata)).toEqual([]);
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
      makeTool('WeixinSendImage'),
    ];

    expect(
      filterEnabledGatewayToolsForSession(tools, metadata).map((tool) => tool.function.name),
    ).toEqual(['websearch', 'PluginReplyMessage']);
  });
});
