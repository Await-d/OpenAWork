import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'restricted',
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/tmp/openawork-workspace-root',
  WORKSPACE_ROOTS: ['/tmp/openawork-workspace-root'],
}));

import {
  isAgentToolEnabledForSessionMetadata,
  filterEnabledGatewayToolsForSession,
  isGatewayToolEnabledForSessionMetadata,
  isPlanModeToolEnabledForSessionMetadata,
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
    createToolDefinition('Agent'),
    createToolDefinition('question'),
    createToolDefinition('EnterPlanMode'),
    createToolDefinition('ExitPlanMode'),
    createToolDefinition('read'),
  ];

  it('disables task tool by default for sessions created by the task tool', () => {
    expect(isTaskToolEnabledForSessionMetadata({ createdByTool: 'task' })).toBe(false);

    const visibleToolNames = filterEnabledGatewayToolsForSession(
      tools,
      JSON.stringify({ createdByTool: 'task' }),
    ).map((tool) => tool.function.name);

    expect(isAgentToolEnabledForSessionMetadata({ createdByTool: 'task' })).toBe(false);
    expect(isQuestionToolEnabledForSessionMetadata({ createdByTool: 'task' })).toBe(false);
    expect(isPlanModeToolEnabledForSessionMetadata({ createdByTool: 'task' })).toBe(false);
    expect(visibleToolNames).toEqual(['read']);
  });

  it('keeps task tool enabled for regular sessions', () => {
    expect(isTaskToolEnabledForSessionMetadata({})).toBe(true);

    const visibleToolNames = filterEnabledGatewayToolsForSession(tools, JSON.stringify({})).map(
      (tool) => tool.function.name,
    );

    expect(isQuestionToolEnabledForSessionMetadata({})).toBe(true);
    expect(isPlanModeToolEnabledForSessionMetadata({})).toBe(true);
    expect(isAgentToolEnabledForSessionMetadata({})).toBe(true);
    expect(visibleToolNames).toEqual([
      'task',
      'Agent',
      'question',
      'EnterPlanMode',
      'ExitPlanMode',
      'read',
    ]);
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
      createToolDefinition('Agent'),
      createToolDefinition('question'),
      createToolDefinition('read'),
      createToolDefinition('edit'),
      createToolDefinition('desktop_automation'),
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
    expect(isGatewayToolEnabledForSessionMetadata('desktop_automation', metadata)).toBe(false);
    expect(isTaskToolEnabledForSessionMetadata(metadata)).toBe(true);
    expect(isAgentToolEnabledForSessionMetadata(metadata)).toBe(true);
    expect(isQuestionToolEnabledForSessionMetadata(metadata)).toBe(false);
    expect(isPlanModeToolEnabledForSessionMetadata(metadata)).toBe(false);
    expect(visibleToolNames).toEqual([
      'websearch',
      'webfetch',
      'task',
      'Agent',
      'read',
      'workspace_review_diff',
      'mcp_call',
    ]);
  });

  describe('LSP tool channel classification', () => {
    const readLspTools = [
      'lsp_diagnostics',
      'lsp_touch',
      'lsp_goto_definition',
      'lsp_goto_implementation',
      'lsp_find_references',
      'lsp_symbols',
      'lsp_prepare_rename',
      'lsp_hover',
      'lsp_call_hierarchy',
    ] as const;

    const editLspTools = ['lsp_rename'] as const;

    it('classifies read-only LSP tools under the "read" channel key', () => {
      const metadata = {
        source: 'channel',
        channel: {
          tools: {
            read: true,
            edit: false,
          },
          permissions: {},
        },
      };

      for (const toolName of readLspTools) {
        expect(
          isGatewayToolEnabledForSessionMetadata(toolName, metadata),
          `${toolName} should be enabled when read=true`,
        ).toBe(true);
      }

      for (const toolName of editLspTools) {
        expect(
          isGatewayToolEnabledForSessionMetadata(toolName, metadata),
          `${toolName} should be disabled when edit=false`,
        ).toBe(false);
      }
    });

    it('classifies lsp_rename under the "edit" channel key', () => {
      const metadata = {
        source: 'channel',
        channel: {
          tools: {
            read: false,
            edit: true,
          },
          permissions: {},
        },
      };

      expect(isGatewayToolEnabledForSessionMetadata('lsp_rename', metadata)).toBe(true);

      for (const toolName of readLspTools) {
        expect(
          isGatewayToolEnabledForSessionMetadata(toolName, metadata),
          `${toolName} should be disabled when read=false`,
        ).toBe(false);
      }
    });

    it('enables all LSP tools in non-channel sessions', () => {
      const metadata = {};

      for (const toolName of [...readLspTools, ...editLspTools]) {
        expect(
          isGatewayToolEnabledForSessionMetadata(toolName, metadata),
          `${toolName} should be enabled in regular sessions`,
        ).toBe(true);
      }
    });

    it('disables all LSP tools when both read and edit are disabled in channel', () => {
      const metadata = {
        source: 'channel',
        channel: {
          tools: {
            read: false,
            edit: false,
          },
          permissions: {},
        },
      };

      for (const toolName of [...readLspTools, ...editLspTools]) {
        expect(
          isGatewayToolEnabledForSessionMetadata(toolName, metadata),
          `${toolName} should be disabled when both read and edit are false`,
        ).toBe(false);
      }
    });

    it('auto-approves lsp_rename in channel sessions only when edit is enabled', () => {
      const editEnabled = {
        source: 'channel',
        channel: {
          tools: {
            read: true,
            edit: true,
          },
          permissions: {},
        },
      };

      const editDisabled = {
        source: 'channel',
        channel: {
          tools: {
            read: true,
            edit: false,
          },
          permissions: {},
        },
      };

      expect(shouldAutoApproveToolForSessionMetadata('lsp_rename', editEnabled)).toBe(true);

      expect(shouldAutoApproveToolForSessionMetadata('lsp_rename', editDisabled)).toBe(false);
    });

    it('does not auto-approve any LSP tools in non-channel sessions', () => {
      const metadata = {};

      for (const toolName of [...readLspTools, ...editLspTools]) {
        expect(
          shouldAutoApproveToolForSessionMetadata(toolName, metadata),
          `${toolName} should not be auto-approved in regular sessions`,
        ).toBe(false);
      }
    });

    it('filters LSP tools correctly via filterEnabledGatewayToolsForSession', () => {
      const lspTools = [
        ...readLspTools.map(createToolDefinition),
        ...editLspTools.map(createToolDefinition),
      ];
      const metadata = {
        source: 'channel',
        channel: {
          tools: {
            read: true,
            edit: false,
          },
          permissions: {},
        },
      };

      const visibleToolNames = filterEnabledGatewayToolsForSession(
        lspTools,
        JSON.stringify(metadata),
      ).map((tool) => tool.function.name);

      expect(visibleToolNames).toEqual([...readLspTools]);
      expect(visibleToolNames).not.toContain('lsp_rename');
    });
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
    expect(shouldAutoApproveToolForSessionMetadata('Agent', metadata)).toBe(false);
  });

  describe('clarify mode tool filtering', () => {
    const clarifyAllowedTools = [
      'list',
      'read',
      'glob',
      'grep',
      'read_tool_output',
      'workspace_review_status',
      'workspace_review_diff',
      'lsp_diagnostics',
      'lsp_touch',
      'lsp_goto_definition',
      'lsp_goto_implementation',
      'lsp_find_references',
      'lsp_symbols',
      'lsp_hover',
      'lsp_call_hierarchy',
      'codesearch',
      'websearch',
      'webfetch',
      'question',
      'AskUserQuestion',
      'EnterPlanMode',
      'ExitPlanMode',
      'session_list',
      'session_read',
      'session_search',
      'session_info',
      'todoReadTool',
      'subTodoReadTool',
      'task_list',
      'task_get',
      'look_at',
      'task',
      'Agent',
    ];

    const clarifyDisallowedTools = [
      'write',
      'edit',
      'apply_patch',
      'bash',
      'interactive_bash',
      'workspace_create_file',
      'workspace_create_directory',
      'workspace_review_revert',
      'call_omo_agent',
      'mcp_list_tools',
      'mcp_call',
      'skill_mcp',
      'desktop_automation',
      'lsp_rename',
      'lsp_prepare_rename',
      'Skill',
      'batch',
      'todoWriteTool',
      'subTodoWriteTool',
      'task_create',
      'task_update',
      'ast_grep_replace',
    ];

    it('allows only read-only and questioning tools in clarify mode', () => {
      const metadata = { dialogueMode: 'clarify' };

      for (const toolName of clarifyAllowedTools) {
        expect(
          isGatewayToolEnabledForSessionMetadata(toolName, metadata),
          `${toolName} should be allowed in clarify mode`,
        ).toBe(true);
      }

      for (const toolName of clarifyDisallowedTools) {
        expect(
          isGatewayToolEnabledForSessionMetadata(toolName, metadata),
          `${toolName} should be disallowed in clarify mode`,
        ).toBe(false);
      }
    });

    it('does not restrict tools in coding or programmer mode', () => {
      for (const mode of ['coding', 'programmer'] as const) {
        const metadata = { dialogueMode: mode };

        expect(isGatewayToolEnabledForSessionMetadata('bash', metadata)).toBe(true);
        expect(isGatewayToolEnabledForSessionMetadata('edit', metadata)).toBe(true);
        expect(isGatewayToolEnabledForSessionMetadata('write', metadata)).toBe(true);
        expect(isGatewayToolEnabledForSessionMetadata('task', metadata)).toBe(true);
        expect(isGatewayToolEnabledForSessionMetadata('read', metadata)).toBe(true);
      }
    });

    it('filterEnabledGatewayToolsForSession filters tools based on clarify mode', () => {
      const allTools = [
        ...clarifyAllowedTools.map(createToolDefinition),
        ...clarifyDisallowedTools.map(createToolDefinition),
      ];

      const visibleToolNames = filterEnabledGatewayToolsForSession(
        allTools,
        JSON.stringify({ dialogueMode: 'clarify' }),
      ).map((tool) => tool.function.name);

      for (const toolName of clarifyAllowedTools) {
        expect(visibleToolNames).toContain(toolName);
      }

      for (const toolName of clarifyDisallowedTools) {
        expect(visibleToolNames).not.toContain(toolName);
      }
    });

    it('clarify mode child sessions inherit dialogueMode and apply same restrictions', () => {
      const childMetadata = { dialogueMode: 'clarify', createdByTool: 'task' };

      expect(isGatewayToolEnabledForSessionMetadata('read', childMetadata)).toBe(true);
      expect(isGatewayToolEnabledForSessionMetadata('grep', childMetadata)).toBe(true);
      expect(isGatewayToolEnabledForSessionMetadata('task', childMetadata)).toBe(false);
      expect(isGatewayToolEnabledForSessionMetadata('Agent', childMetadata)).toBe(false);
      expect(isGatewayToolEnabledForSessionMetadata('bash', childMetadata)).toBe(false);
      expect(isGatewayToolEnabledForSessionMetadata('edit', childMetadata)).toBe(false);
    });

    it('clarify mode filtering combines with channel policy', () => {
      const tools = [
        createToolDefinition('read'),
        createToolDefinition('websearch'),
        createToolDefinition('bash'),
      ];
      const metadata = {
        dialogueMode: 'clarify',
        source: 'channel',
        channel: {
          tools: { read: true, web_search: true, bash: true },
          permissions: { allowShell: true },
        },
      };

      const visibleToolNames = filterEnabledGatewayToolsForSession(
        tools,
        JSON.stringify(metadata),
      ).map((tool) => tool.function.name);

      expect(visibleToolNames).toContain('read');
      expect(visibleToolNames).toContain('websearch');
      expect(visibleToolNames).not.toContain('bash');
    });
  });
});
