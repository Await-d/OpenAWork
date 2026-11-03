/**
 * 内置 Agent 提示词编辑区的最小渲染回归（复查 V-09 补充）。
 *
 * `AgentForm` 是模块内私有组件，这里通过导出的 `AgentsEditorPanel` 做最小渲染，
 * 并用受控 `setEditorState` 捕获 updater 结果（不需要真实 state 管理）。
 *
 * 锁定：点击「恢复默认提示词」必须把编辑器**填回默认值**，而不是清空 ——
 * 清空会让「本来就没有覆盖」的用户也产生一次差异提交，服务端据此落一条空 override 对象。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedAgentRecord } from '@openAwork/shared';
import { AgentsEditorPanel } from './agents-editor-panel.js';
import { emptyEditorState } from './agents-editor-state.js';
import type { AgentEditorState } from './agents-editor-state.js';

const BASE = {
  label: '通用',
  description: '',
  aliases: [],
  enabled: true,
  removable: false,
  resettable: false,
  hasOverrides: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies Omit<ManagedAgentRecord, 'id' | 'origin' | 'source'>;

const DEFAULT_TEXT = '内置默认提示词';

function builtinAgent(hasPromptOverride: boolean): ManagedAgentRecord {
  return {
    ...BASE,
    id: 'general',
    origin: 'builtin',
    source: 'builtin',
    systemPrompt: hasPromptOverride ? '用户自定义提示词' : DEFAULT_TEXT,
    promptMetadata: { defaultText: DEFAULT_TEXT, hasPromptOverride },
  };
}

const NOOP = () => {
  /* 测试不需要这些回调动效 */
};

function renderPanel(state: AgentEditorState, hasPromptOverride: boolean, setState = vi.fn()) {
  const view = render(
    <AgentsEditorPanel
      editorMode="edit"
      selectedAgent={builtinAgent(hasPromptOverride)}
      editorState={state}
      setEditorState={setState}
      canSave
      saving={false}
      saveMessage={null}
      onCreate={NOOP}
      onCancelCreate={NOOP}
      onResetDraft={NOOP}
      onSave={NOOP}
      onToggleEnabled={NOOP}
      onResetOne={NOOP}
      onRemove={NOOP}
    />,
  );
  return { view, setState };
}

afterEach(cleanup);

describe('内置 Agent 提示词编辑区', () => {
  it('点击「恢复默认提示词」填回默认值（而非清空）', () => {
    const setState = vi.fn();
    const state = { ...emptyEditorState(), systemPrompt: '用户自定义提示词' };
    renderPanel(state, true, setState);

    fireEvent.click(screen.getByRole('button', { name: '恢复默认提示词' }));

    expect(setState).toHaveBeenCalledTimes(1);
    const updater = setState.mock.calls[0]?.[0] as (current: AgentEditorState) => AgentEditorState;
    expect(updater(state).systemPrompt).toBe(DEFAULT_TEXT);
  });

  it('编辑器内容已等于默认值时按钮不可用（无差异可提交）', () => {
    renderPanel({ ...emptyEditorState(), systemPrompt: DEFAULT_TEXT }, false);

    const button = screen.getByRole('button', { name: '恢复默认提示词' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('已有覆盖时按钮可用，并展示覆盖状态', () => {
    renderPanel({ ...emptyEditorState(), systemPrompt: '用户自定义提示词' }, true);

    expect(screen.getByText('当前使用自定义提示词')).toBeTruthy();
    const button = screen.getByRole('button', { name: '恢复默认提示词' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('无覆盖时展示「使用系统默认」且提示词输入框可编辑', () => {
    renderPanel({ ...emptyEditorState(), systemPrompt: DEFAULT_TEXT }, false);

    expect(screen.getByText('当前使用系统默认提示词')).toBeTruthy();
    // label 文本含提示文案，故用正则匹配可访问名。
    const textarea = screen.getByRole('textbox', { name: /系统提示词/ }) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });
});
