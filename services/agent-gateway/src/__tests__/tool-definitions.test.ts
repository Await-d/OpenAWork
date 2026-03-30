import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  db: { exec: vi.fn() },
  sqliteAll: vi.fn(() => []),
  sqliteRun: vi.fn(),
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_ROOT: tmpdir(),
  WORKSPACE_ROOTS: [tmpdir()],
}));

import { buildGatewayToolDefinitions } from '../tool-definitions.js';

describe('buildGatewayToolDefinitions', () => {
  it('includes the first batch of workspace coding tools', () => {
    const definitions = buildGatewayToolDefinitions();
    const toolNames = definitions.map((definition) => definition.function.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'websearch',
        'webfetch',
        'list',
        'read',
        'glob',
        'grep',
        'edit',
        'batch',
        'skill',
        'bash',
        'apply_patch',
        'question',
        'read_tool_output',
        'task',
        'background_output',
        'background_cancel',
        'session_list',
        'session_read',
        'session_search',
        'session_info',
        'ast_grep_search',
        'ast_grep_replace',
        'interactive_bash',
        'call_omo_agent',
        'skill_mcp',
        'look_at',
        'write',
        'workspace_review_status',
        'workspace_review_diff',
        'workspace_create_directory',
        'workspace_review_revert',
        'todowrite',
        'todoread',
        'subtodowrite',
        'subtodoread',
        'mcp_list_tools',
        'mcp_call',
      ]),
    );
    expect(toolNames).not.toContain('web_search');
    expect(toolNames).not.toContain('workspace_tree');
    expect(toolNames).not.toContain('workspace_read_file');
    expect(toolNames).not.toContain('workspace_search');
    expect(toolNames).not.toContain('workspace_write_file');
    expect(toolNames).not.toContain('workspace_create_file');
  });

  it('declares the expected required parameters for workspace tools', () => {
    const definitions = buildGatewayToolDefinitions();
    const byName = new Map(definitions.map((definition) => [definition.function.name, definition]));

    expect(byName.get('list')?.function.parameters.required).toEqual(['path']);
    expect(byName.get('read')?.function.parameters.required).toEqual(['path']);
    expect(byName.get('glob')?.function.parameters.required).toEqual(['path', 'pattern']);
    expect(byName.get('grep')?.function.parameters.required).toEqual(['path', 'query']);
    expect(byName.get('edit')?.function.parameters.required).toEqual([
      'filePath',
      'oldString',
      'newString',
    ]);
    expect(byName.get('batch')?.function.parameters.required).toEqual(['tool_calls']);
    expect(byName.get('skill')?.function.parameters.required).toEqual(['name']);
    expect(byName.get('bash')?.function.parameters.required).toEqual(['command']);
    expect(byName.get('apply_patch')?.function.parameters.required).toEqual(['patchText']);
    expect(byName.get('question')?.function.parameters.required).toEqual(['questions']);
    expect(byName.get('read_tool_output')?.function.parameters.required).toEqual([]);
    expect(byName.get('read_tool_output')?.function.parameters).toMatchObject({
      properties: {
        useLatestReferenced: {
          type: 'boolean',
        },
      },
    });
    expect(byName.get('task')?.function.parameters.required).toEqual([
      'description',
      'prompt',
      'load_skills',
      'run_in_background',
    ]);
    expect(byName.get('task')?.function.parameters).toMatchObject({
      properties: {
        subagent_type: {
          type: 'string',
        },
        category: {
          type: 'string',
        },
        load_skills: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        run_in_background: {
          type: 'boolean',
        },
        session_id: {
          type: 'string',
        },
      },
    });
    expect(byName.get('background_output')?.function.parameters.required).toEqual(['task_id']);
    expect(byName.get('background_cancel')?.function.parameters.required).toEqual([]);
    expect(byName.get('session_list')?.function.parameters.required).toEqual([]);
    expect(byName.get('session_read')?.function.parameters.required).toEqual(['session_id']);
    expect(byName.get('session_search')?.function.parameters.required).toEqual(['query']);
    expect(byName.get('session_info')?.function.parameters.required).toEqual(['session_id']);
    expect(byName.get('ast_grep_search')?.function.parameters.required).toEqual([
      'pattern',
      'lang',
    ]);
    expect(byName.get('ast_grep_replace')?.function.parameters.required).toEqual([
      'pattern',
      'rewrite',
      'lang',
    ]);
    expect(byName.get('interactive_bash')?.function.parameters.required).toEqual(['tmux_command']);
    expect(byName.get('call_omo_agent')?.function.parameters.required).toEqual([
      'description',
      'prompt',
      'subagent_type',
      'run_in_background',
    ]);
    expect(byName.get('skill_mcp')?.function.parameters.required).toEqual(['mcp_name']);
    expect(byName.get('look_at')?.function.parameters.required).toEqual(['goal']);
    expect(byName.get('workspace_review_status')?.function.parameters.required).toEqual(['path']);
    expect(byName.get('workspace_review_diff')?.function.parameters.required).toEqual([
      'path',
      'filePath',
    ]);
    expect(byName.get('write')?.function.parameters.required).toEqual(['path', 'content']);
    expect(byName.get('workspace_create_directory')?.function.parameters.required).toEqual([
      'path',
    ]);
    expect(byName.get('workspace_review_revert')?.function.parameters.required).toEqual([
      'path',
      'filePath',
    ]);
    expect(byName.get('todowrite')?.function.parameters.required).toEqual(['todos']);
    expect(byName.get('todowrite')?.function.parameters).toMatchObject({
      properties: {
        todos: {
          items: {
            properties: {
              status: {
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              },
              priority: {
                enum: ['high', 'medium', 'low'],
              },
            },
          },
        },
      },
    });
    expect(byName.get('todoread')?.function.parameters.required).toEqual([]);
    expect(byName.get('subtodowrite')?.function.parameters.required).toEqual(['todos']);
    expect(byName.get('subtodoread')?.function.parameters.required).toEqual([]);
    expect(byName.get('websearch')?.function.parameters.required).toEqual(['query']);
    expect(byName.get('webfetch')?.function.parameters.required).toEqual(['url']);
    expect(byName.get('mcp_list_tools')?.function.parameters.required).toEqual([]);
    expect(byName.get('mcp_call')?.function.parameters.required).toEqual([
      'serverId',
      'toolName',
      'arguments',
    ]);
  });

  it('only exposes the approved MCP wrapper tools and never raw MCP tool ids', () => {
    const definitions = buildGatewayToolDefinitions();
    const toolNames = definitions.map((definition) => definition.function.name);

    expect(toolNames.some((name) => name.startsWith('mcp:'))).toBe(false);
    expect(
      toolNames
        .filter((name) => name.startsWith('mcp_'))
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual(['mcp_call', 'mcp_list_tools']);
  });
});
