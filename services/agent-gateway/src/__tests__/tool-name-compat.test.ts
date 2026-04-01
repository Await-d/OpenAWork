import { describe, expect, it } from 'vitest';
import { isEnabledToolName } from '../routes/tool-name-compat.js';

describe('isEnabledToolName', () => {
  it('accepts exact enabled tool names', () => {
    const enabledToolNames = new Set(['websearch', 'list', 'read', 'grep', 'write']);

    expect(isEnabledToolName('websearch', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('read', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('write', enabledToolNames)).toBe(true);
  });

  it('accepts legacy tool names when their reference-style names are enabled', () => {
    const enabledToolNames = new Set(['websearch', 'list', 'read', 'grep', 'write']);

    expect(isEnabledToolName('web_search', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('workspace_tree', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('workspace_read_file', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('workspace_search', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('workspace_write_file', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('workspace_create_file', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('file_read', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('read_file', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('file_write', enabledToolNames)).toBe(true);
    expect(isEnabledToolName('write_file', enabledToolNames)).toBe(true);
  });

  it('accepts canonical and presented tool names across the same enabled surface', () => {
    expect(isEnabledToolName('Agent', new Set(['call_omo_agent']))).toBe(true);
    expect(isEnabledToolName('call_omo_agent', new Set(['Agent']))).toBe(true);
    expect(isEnabledToolName('AskUserQuestion', new Set(['question']))).toBe(true);
    expect(isEnabledToolName('question', new Set(['AskUserQuestion']))).toBe(true);
    expect(isEnabledToolName('Skill', new Set(['skill']))).toBe(true);
    expect(isEnabledToolName('skill', new Set(['Skill']))).toBe(true);
  });

  it('rejects legacy tool names when the mapped reference tool is not enabled', () => {
    const enabledToolNames = new Set(['read']);

    expect(isEnabledToolName('web_search', enabledToolNames)).toBe(false);
    expect(isEnabledToolName('workspace_tree', enabledToolNames)).toBe(false);
    expect(isEnabledToolName('workspace_search', enabledToolNames)).toBe(false);
    expect(isEnabledToolName('workspace_write_file', enabledToolNames)).toBe(false);
    expect(isEnabledToolName('Agent', enabledToolNames)).toBe(false);
  });
});
