// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildInitialTemplateEditorState } from './NewTeamTemplateModal.js';

describe('buildInitialTemplateEditorState', () => {
  it('会把当前固定角色绑定写入创建态 roleBindings，避免保存出空模板', () => {
    const state = buildInitialTemplateEditorState([
      { role: 'leader', selectedAgent: { id: 'atlas' } as never, selectedAgentId: 'atlas' },
      {
        role: 'planner',
        selectedAgent: { id: 'planner-a' } as never,
        selectedAgentId: 'planner-a',
      },
      {
        role: 'researcher',
        selectedAgent: { id: 'researcher-a' } as never,
        selectedAgentId: 'researcher-a',
      },
      {
        role: 'executor',
        selectedAgent: { id: 'executor-a' } as never,
        selectedAgentId: 'executor-a',
      },
      {
        role: 'reviewer',
        selectedAgent: { id: 'reviewer-a' } as never,
        selectedAgentId: 'reviewer-a',
      },
    ]);

    expect(state.roleBindings.leader?.agentId).toBe('atlas');
    expect(state.roleBindings.planner?.agentId).toBe('planner-a');
    expect(state.roleBindings.researcher?.agentId).toBe('researcher-a');
    expect(state.roleBindings.executor?.agentId).toBe('executor-a');
    expect(state.roleBindings.reviewer?.agentId).toBe('reviewer-a');
  });
});

describe('buildInitialTemplateEditorState fallback', () => {
  it('在 selectedAgent 为空时会回退到 selectedAgentId', () => {
    const state = buildInitialTemplateEditorState([
      { role: 'leader', selectedAgent: null as never, selectedAgentId: 'leader-x' },
      { role: 'planner', selectedAgent: null as never, selectedAgentId: 'planner-x' },
      { role: 'researcher', selectedAgent: null as never, selectedAgentId: 'researcher-x' },
      { role: 'executor', selectedAgent: null as never, selectedAgentId: 'executor-x' },
      { role: 'reviewer', selectedAgent: null as never, selectedAgentId: 'reviewer-x' },
    ]);

    expect(state.roleBindings.leader?.agentId).toBe('leader-x');
    expect(state.roleBindings.planner?.agentId).toBe('planner-x');
  });
});
