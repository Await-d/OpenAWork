import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'restricted',
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/tmp/openawork-workspace-root',
  WORKSPACE_ROOTS: ['/tmp/openawork-workspace-root'],
}));

import {
  filterEnabledGatewayToolsForSession,
  isGatewayToolEnabledForSessionMetadata,
  isQuestionToolEnabledForSessionMetadata,
  isTaskToolEnabledForSessionMetadata,
  shouldAutoApproveToolForSessionMetadata,
} from '../session-tool-visibility.js';
import type { GatewayToolDefinition } from '../tool-definitions.js';

function createToolDefinition(name: string): GatewayToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
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
  const tools = [
    createToolDefinition('task'),
    createToolDefinition('question'),
    createToolDefinition('read'),
  ];

  it('disables task tool by default for sessions created by the task tool', () => {
    expect(isTaskToolEnabledForSessionMetadata({ createdByTool: 'task' })).toBe(false);

    const visibleToolNames = filterEnabledGatewayToolsForSession(
      tools,
      JSON.stringify({ createdByTool: 'task' }),
    ).map((tool) => tool.function.name);

    expect(isQuestionToolEnabledForSessionMetadata({ createdByTool: 'task' })).toBe(false);
    expect(visibleToolNames).toEqual(['read']);
  });

  it('keeps task tool enabled for regular sessions', () => {
    expect(isTaskToolEnabledForSessionMetadata({})).toBe(true);

    const visibleToolNames = filterEnabledGatewayToolsForSession(tools, JSON.stringify({})).map(
      (tool) => tool.function.name,
    );

    expect(isQuestionToolEnabledForSessionMetadata({})).toBe(true);
    expect(visibleToolNames).toEqual(['task', 'question', 'read']);
  });

  it('allows explicit task tool opt-in override on task-created sessions', () => {
    expect(
      isTaskToolEnabledForSessionMetadata({ createdByTool: 'task', taskToolEnabled: true }),
    ).toBe(true);

    const visibleToolNames = filterEnabledGatewayToolsForSession(
      tools,
      JSON.stringify({ createdByTool: 'task', taskToolEnabled: true }),
    ).map((tool) => tool.function.name);

    expect(visibleToolNames).toEqual(['task', 'read']);
  });

  it('allows explicit question tool opt-in override on task-created sessions', () => {
    expect(
      isQuestionToolEnabledForSessionMetadata({ createdByTool: 'task', questionToolEnabled: true }),
    ).toBe(true);

    const visibleToolNames = filterEnabledGatewayToolsForSession(
      tools,
      JSON.stringify({ createdByTool: 'task', questionToolEnabled: true }),
    ).map((tool) => tool.function.name);

    expect(visibleToolNames).toEqual(['question', 'read']);
  });

  it('filters gateway tools using channel tool policy and permissions', () => {
    const channelTools = [
      createToolDefinition('websearch'),
      createToolDefinition('webfetch'),
      createToolDefinition('bash'),
      createToolDefinition('task'),
      createToolDefinition('question'),
      createToolDefinition('read'),
      createToolDefinition('edit'),
      createToolDefinition('workspace_review_diff'),
      createToolDefinition('mcp_call'),
    ];
    const metadata = {
      source: 'channel',
      channel: {
        tools: {
          web_search: true,
          read: true,
          edit: false,
          bash: false,
          task: true,
          mcp: true,
        },
        permissions: {
          allowShell: false,
          allowSubAgents: true,
        },
      },
    };

    const visibleToolNames = filterEnabledGatewayToolsForSession(
      channelTools,
      JSON.stringify(metadata),
    ).map((tool) => tool.function.name);

    expect(isGatewayToolEnabledForSessionMetadata('websearch', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('webfetch', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('read', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('workspace_review_diff', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('mcp_call', metadata)).toBe(true);
    expect(isGatewayToolEnabledForSessionMetadata('edit', metadata)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('bash', metadata)).toBe(false);
    expect(isTaskToolEnabledForSessionMetadata(metadata)).toBe(true);
    expect(isQuestionToolEnabledForSessionMetadata(metadata)).toBe(false);
    expect(visibleToolNames).toEqual([
      'websearch',
      'webfetch',
      'task',
      'read',
      'workspace_review_diff',
      'mcp_call',
    ]);
  });

  it('marks enabled channel tools as auto-approved runtime actions', () => {
    const metadata = {
      source: 'channel',
      channel: {
        tools: {
          bash: true,
        },
        permissions: {
          allowShell: true,
          allowSubAgents: false,
        },
      },
    };

    expect(shouldAutoApproveToolForSessionMetadata('bash', metadata)).toBe(true);
    expect(shouldAutoApproveToolForSessionMetadata('task', metadata)).toBe(false);
  });
});
