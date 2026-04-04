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

import {
  buildGatewayToolDefinitions,
  buildGatewayToolDefinitionsForProfile,
} from '../tool-definitions.js';
import {
  CLAUDE_CODE_PROFILE_NAMES,
  PRESENTED_TO_CANONICAL,
  CANONICAL_TO_PRESENTED,
  PROFILE_TOOL_SETS,
} from '../claude-code-tool-surface-profiles.js';
import {
  buildToolSurface,
  filterToolDefinitionsForSurface,
  isToolAllowed,
  resolveCanonicalName,
  isValidProfileName,
} from '../claude-code-tool-surface.js';

describe('buildGatewayToolDefinitions', () => {
  it('includes the first batch of workspace coding tools', () => {
    const definitions = buildGatewayToolDefinitions();
    const toolNames = definitions.map((definition) => definition.function.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'websearch',
        'codesearch',
        'webfetch',
        'lsp_goto_definition',
        'lsp_goto_implementation',
        'lsp_find_references',
        'lsp_symbols',
        'lsp_prepare_rename',
        'lsp_rename',
        'lsp_hover',
        'lsp_call_hierarchy',
        'list',
        'read',
        'glob',
        'grep',
        'edit',
        'batch',
        'Skill',
        'bash',
        'apply_patch',
        'AskUserQuestion',
        'EnterPlanMode',
        'ExitPlanMode',
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
        'Agent',
        'skill_mcp',
        'look_at',
        'desktop_automation',
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
    expect(byName.get('read')?.function.parameters.required).toEqual([]);
    expect(byName.get('glob')?.function.parameters.required).toEqual(['pattern']);
    expect(byName.get('grep')?.function.parameters.required).toEqual(['pattern']);
    expect(byName.get('edit')?.function.parameters.required).toEqual([
      'filePath',
      'oldString',
      'newString',
    ]);
    expect(byName.get('batch')?.function.parameters.required).toEqual(['tool_calls']);
    expect(byName.get('Skill')?.function.parameters.required).toEqual(['skill']);
    expect(byName.get('bash')?.function.parameters.required).toEqual(['command']);
    expect(byName.get('apply_patch')?.function.parameters.required).toEqual(['patchText']);
    expect(byName.get('AskUserQuestion')?.function.parameters.required).toEqual(['questions']);
    expect(byName.get('EnterPlanMode')?.function.parameters.required).toEqual([]);
    expect(byName.get('ExitPlanMode')?.function.parameters.required).toEqual([]);
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
    expect(byName.get('lsp_goto_definition')?.function.parameters.required).toEqual([
      'filePath',
      'line',
      'character',
    ]);
    expect(byName.get('lsp_goto_implementation')?.function.parameters.required).toEqual([
      'filePath',
      'line',
      'character',
    ]);
    expect(byName.get('lsp_find_references')?.function.parameters.required).toEqual([
      'filePath',
      'line',
      'character',
    ]);
    expect(byName.get('lsp_symbols')?.function.parameters.required).toEqual(['filePath']);
    expect(byName.get('lsp_prepare_rename')?.function.parameters.required).toEqual([
      'filePath',
      'line',
      'character',
    ]);
    expect(byName.get('lsp_rename')?.function.parameters.required).toEqual([
      'filePath',
      'line',
      'character',
      'newName',
    ]);
    expect(byName.get('lsp_hover')?.function.parameters.required).toEqual([
      'filePath',
      'line',
      'character',
    ]);
    expect(byName.get('lsp_call_hierarchy')?.function.parameters.required).toEqual([
      'filePath',
      'line',
      'character',
    ]);
    expect(byName.get('lsp_call_hierarchy')?.function.parameters).toMatchObject({
      properties: {
        direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'] },
      },
    });
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
    expect(byName.get('Agent')?.function.parameters.required).toEqual([
      'description',
      'prompt',
      'subagent_type',
      'run_in_background',
    ]);
    expect(byName.get('skill_mcp')?.function.parameters.required).toEqual(['mcp_name']);
    expect(byName.get('look_at')?.function.parameters.required).toEqual(['goal']);
    expect(byName.get('desktop_automation')?.function.parameters.required).toEqual(['action']);
    expect(byName.get('workspace_review_status')?.function.parameters.required).toEqual(['path']);
    expect(byName.get('workspace_review_diff')?.function.parameters.required).toEqual([
      'path',
      'filePath',
    ]);
    expect(byName.get('write')?.function.parameters.required).toEqual(['content']);
    expect(byName.get('read')?.function.parameters).toMatchObject({
      properties: {
        filePath: {
          type: 'string',
        },
      },
    });
    expect(byName.get('write')?.function.parameters).toMatchObject({
      properties: {
        filePath: {
          type: 'string',
        },
      },
    });
    expect(byName.get('desktop_automation')?.function.parameters).toMatchObject({
      properties: {
        action: {
          enum: ['status', 'start', 'goto', 'click', 'type', 'screenshot'],
        },
        url: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
      },
    });
    expect(byName.get('grep')?.function.parameters).toMatchObject({
      properties: {
        include: { type: 'string' },
        output_mode: { type: 'string' },
        head_limit: { type: 'integer' },
      },
    });
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
    expect(byName.get('codesearch')?.function.parameters.required).toEqual(['query']);
    expect(byName.get('webfetch')?.function.parameters.required).toEqual(['url']);
    expect(byName.get('mcp_list_tools')?.function.parameters.required).toEqual([]);
    expect(byName.get('mcp_call')?.function.parameters.required).toEqual([
      'serverId',
      'toolName',
      'arguments',
    ]);
  });

  it('buildGatewayToolDefinitionsForProfile keeps openawork profile identical to the current default surface', () => {
    const defaults = buildGatewayToolDefinitions();
    const forOpenAWork = buildGatewayToolDefinitionsForProfile('openawork');
    expect(forOpenAWork.map((d) => d.function.name)).toEqual(defaults.map((d) => d.function.name));
  });

  it('buildGatewayToolDefinitionsForProfile falls back to openawork for unknown profile', () => {
    const defaults = buildGatewayToolDefinitions();
    const fallback = buildGatewayToolDefinitionsForProfile('unknown-profile');
    expect(fallback.map((d) => d.function.name)).toEqual(defaults.map((d) => d.function.name));
  });

  it('buildGatewayToolDefinitionsForProfile restricts simple profile to Bash/Read/Edit canonical tools', () => {
    const forSimple = buildGatewayToolDefinitionsForProfile('claude_code_simple');
    const names = forSimple.map((d) => d.function.name).sort();
    expect(names).toEqual(['bash', 'edit', 'read']);
  });

  it('buildGatewayToolDefinitionsForProfile restricts default profile to the planned canonical subset', () => {
    const forDefault = buildGatewayToolDefinitionsForProfile('claude_code_default');
    const names = forDefault.map((d) => d.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'bash',
        'read',
        'edit',
        'write',
        'glob',
        'grep',
        'webfetch',
        'websearch',
        'todowrite',
        'task_create',
        'task_get',
        'task_list',
        'task_update',
        'desktop_automation',
        'Skill',
        'AskUserQuestion',
        'task',
      ]),
    );
    expect(names).not.toContain('call_omo_agent');
    expect(names).not.toContain('look_at');
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
    expect(toolNames).not.toContain('file_read');
    expect(toolNames).not.toContain('read_file');
    expect(toolNames).not.toContain('file_write');
    expect(toolNames).not.toContain('write_file');
  });
});

describe('ClaudeCodeToolSurface profiles', () => {
  it('CLAUDE_CODE_PROFILE_NAMES contains the frozen profile names', () => {
    expect(CLAUDE_CODE_PROFILE_NAMES).toEqual([
      'openawork',
      'claude_code_simple',
      'claude_code_default',
    ]);
  });

  it('PRESENTED_TO_CANONICAL maps local reference tool names to canonical names', () => {
    expect(PRESENTED_TO_CANONICAL['Bash']).toBe('bash');
    expect(PRESENTED_TO_CANONICAL['Read']).toBe('read');
    expect(PRESENTED_TO_CANONICAL['Edit']).toBe('edit');
    expect(PRESENTED_TO_CANONICAL['Write']).toBe('write');
    expect(PRESENTED_TO_CANONICAL['Glob']).toBe('glob');
    expect(PRESENTED_TO_CANONICAL['Grep']).toBe('grep');
    expect(PRESENTED_TO_CANONICAL['WebFetch']).toBe('webfetch');
    expect(PRESENTED_TO_CANONICAL['WebSearch']).toBe('websearch');
    expect(PRESENTED_TO_CANONICAL['TodoWrite']).toBe('todowrite');
    expect(PRESENTED_TO_CANONICAL['TaskCreate']).toBe('task_create');
    expect(PRESENTED_TO_CANONICAL['TaskGet']).toBe('task_get');
    expect(PRESENTED_TO_CANONICAL['TaskList']).toBe('task_list');
    expect(PRESENTED_TO_CANONICAL['TaskUpdate']).toBe('task_update');
    expect(PRESENTED_TO_CANONICAL['Skill']).toBe('skill');
    expect(PRESENTED_TO_CANONICAL['AskUserQuestion']).toBe('question');
    expect(PRESENTED_TO_CANONICAL['Agent']).toBe('call_omo_agent');
    expect(PRESENTED_TO_CANONICAL['EnterPlanMode']).toBe('EnterPlanMode');
    expect(PRESENTED_TO_CANONICAL['ExitPlanMode']).toBe('ExitPlanMode');
  });

  it('CANONICAL_TO_PRESENTED is the inverse of PRESENTED_TO_CANONICAL (first occurrence)', () => {
    expect(CANONICAL_TO_PRESENTED['bash']).toBe('Bash');
    expect(CANONICAL_TO_PRESENTED['read']).toBe('Read');
    expect(CANONICAL_TO_PRESENTED['edit']).toBe('Edit');
    expect(CANONICAL_TO_PRESENTED['task_create']).toBe('TaskCreate');
  });

  it('PROFILE_TOOL_SETS keeps openawork as allow-all', () => {
    expect(PROFILE_TOOL_SETS['openawork']).toBeNull();
  });

  it('PROFILE_TOOL_SETS simple profile only includes Bash/Read/Edit canonical tools', () => {
    const simple = PROFILE_TOOL_SETS['claude_code_simple'];
    expect(simple).not.toBeNull();
    expect(simple?.has('bash')).toBe(true);
    expect(simple?.has('read')).toBe(true);
    expect(simple?.has('edit')).toBe(true);
    expect(simple?.has('write')).toBe(false);
    expect(simple?.has('glob')).toBe(false);
  });

  it('PROFILE_TOOL_SETS default profile includes the planned canonical subset', () => {
    const defaults = PROFILE_TOOL_SETS['claude_code_default'];
    expect(defaults).not.toBeNull();
    expect(defaults?.has('bash')).toBe(true);
    expect(defaults?.has('write')).toBe(true);
    expect(defaults?.has('task_create')).toBe(true);
    expect(defaults?.has('desktop_automation')).toBe(true);
    expect(defaults?.has('question')).toBe(true);
    expect(defaults?.has('call_omo_agent')).toBe(true);
    expect(defaults?.has('EnterPlanMode')).toBe(true);
    expect(defaults?.has('ExitPlanMode')).toBe(true);
  });

  it('isValidProfileName returns true for valid profiles', () => {
    expect(isValidProfileName('openawork')).toBe(true);
    expect(isValidProfileName('claude_code_simple')).toBe(true);
    expect(isValidProfileName('claude_code_default')).toBe(true);
    expect(isValidProfileName('unknown')).toBe(false);
  });

  it('resolveCanonicalName maps presented names and passes through unknown names', () => {
    expect(resolveCanonicalName('Read')).toBe('read');
    expect(resolveCanonicalName('Bash')).toBe('bash');
    expect(resolveCanonicalName('unknown_tool')).toBe('unknown_tool');
  });

  it('buildToolSurface creates allow-all surface for openawork profile', () => {
    const surface = buildToolSurface('openawork');
    expect(surface.profile).toBe('openawork');
    expect(surface.policy).toBe('allow-all');
    expect(surface.allowedCanonicalNames).toBeNull();
  });

  it('buildToolSurface creates allowlist surface for claude_code_simple profile', () => {
    const surface = buildToolSurface('claude_code_simple');
    expect(surface.policy).toBe('allowlist');
    expect(surface.allowedCanonicalNames).not.toBeNull();
  });

  it('isToolAllowed returns true for allow-all surface regardless of name', () => {
    const surface = buildToolSurface('openawork');
    expect(isToolAllowed(surface, 'bash')).toBe(true);
    expect(isToolAllowed(surface, 'call_omo_agent')).toBe(true);
    expect(isToolAllowed(surface, 'nonexistent')).toBe(true);
  });

  it('isToolAllowed correctly filters for simple surface', () => {
    const surface = buildToolSurface('claude_code_simple');
    expect(isToolAllowed(surface, 'read')).toBe(true);
    expect(isToolAllowed(surface, 'bash')).toBe(true);
    expect(isToolAllowed(surface, 'write')).toBe(false);
    expect(isToolAllowed(surface, 'glob')).toBe(false);
  });

  it('filterToolDefinitionsForSurface returns all definitions for allow-all surface', () => {
    const definitions = buildGatewayToolDefinitions();
    const surface = buildToolSurface('openawork');
    const filtered = filterToolDefinitionsForSurface(definitions, surface);
    expect(filtered).toHaveLength(definitions.length);
  });

  it('filterToolDefinitionsForSurface subsets definitions for simple surface', () => {
    const definitions = buildGatewayToolDefinitions();
    const surface = buildToolSurface('claude_code_simple');
    const filtered = filterToolDefinitionsForSurface(definitions, surface);
    expect(filtered.length).toBeLessThan(definitions.length);
    expect(filtered.every((d) => isToolAllowed(surface, d.function.name))).toBe(true);
  });
});

describe('claude-code-tool-surface helpers', () => {
  it('buildGatewayToolDefinitionsForProfile keeps openawork profile identical to the current default surface', () => {
    const defaults = buildGatewayToolDefinitions();
    const forOpenAWork = buildGatewayToolDefinitionsForProfile('openawork');
    expect(forOpenAWork.map((d) => d.function.name)).toEqual(defaults.map((d) => d.function.name));
  });

  it('buildGatewayToolDefinitionsForProfile falls back to openawork for unknown profile', () => {
    const defaults = buildGatewayToolDefinitions();
    const fallback = buildGatewayToolDefinitionsForProfile('unknown-profile');
    expect(fallback.map((d) => d.function.name)).toEqual(defaults.map((d) => d.function.name));
  });

  it('buildGatewayToolDefinitionsForProfile restricts simple profile to Bash/Read/Edit canonical tools', () => {
    const forSimple = buildGatewayToolDefinitionsForProfile('claude_code_simple');
    const names = forSimple.map((d) => d.function.name).sort();
    expect(names).toEqual(['bash', 'edit', 'read']);
  });

  it('buildGatewayToolDefinitionsForProfile restricts default profile to the planned canonical subset', () => {
    const all = buildGatewayToolDefinitions();
    const defaults = buildGatewayToolDefinitionsForProfile('claude_code_default');
    const names = defaults.map((d) => d.function.name);
    expect(defaults.length).toBeLessThan(all.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'bash',
        'read',
        'edit',
        'write',
        'glob',
        'grep',
        'webfetch',
        'websearch',
        'todowrite',
        'task_create',
        'task_get',
        'task_list',
        'task_update',
        'desktop_automation',
        'Skill',
        'AskUserQuestion',
        'EnterPlanMode',
        'ExitPlanMode',
        'task',
        'Agent',
      ]),
    );
    expect(names).not.toContain('call_omo_agent');
    expect(names).not.toContain('look_at');
  });
});
