// @vitest-environment jsdom
/**
 * Agent 目录列（`/agents` 左列）渲染与交互覆盖。
 *
 * 锁住三件容易回归的事：
 *   1. 每次改动目录行都要保留「提示词覆盖」徽章——它只在
 *      `promptMetadata.hasPromptOverride` 为真时出现（该字段与含模型字段的
 *      `hasOverrides` 不同，不能用后者代替）；
 *   2. 加载态 / 无匹配分别给出不同空态文案，不能退化成空白列表；
 *   3. 选中态跟随 `editorMode`——处于「新建」时不应把任何行标为当前项。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentsCatalogPanel } from './agents-catalog-panel.js';
import type { ManagedAgentRecord } from '@openAwork/shared';

function agent(overrides: Partial<ManagedAgentRecord> & { id: string }): ManagedAgentRecord {
  return {
    label: overrides.id,
    description: '',
    aliases: [],
    enabled: true,
    origin: 'builtin',
    source: 'builtin',
    removable: false,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(
  overrides: Partial<Parameters<typeof AgentsCatalogPanel>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <AgentsCatalogPanel
      loading={false}
      filteredAgents={[]}
      editorMode="edit"
      selectedAgentId={null}
      saving={false}
      onSelect={() => undefined}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('AgentsCatalogPanel', () => {
  it('加载中与无匹配分别给出不同文案', () => {
    const { unmount } = renderPanel({ loading: true });
    expect(screen.getByText('正在加载 Agent 列表…')).toBeTruthy();
    unmount();

    renderPanel({ filteredAgents: [] });
    expect(screen.getByText(/没有匹配的 Agent/)).toBeTruthy();
  });

  it('行内展示名称、id、类型、角色与模型', () => {
    renderPanel({
      filteredAgents: [
        agent({
          id: 'architect-advisor',
          label: '架构顾问',
          origin: 'custom',
          source: 'configured',
          canonicalRole: { coreRole: 'planner', preset: 'architect' },
          model: 'anthropic/claude-opus-4.1',
        }),
      ],
    });

    expect(screen.getByText('架构顾问')).toBeTruthy();
    expect(screen.getByText('architect-advisor · 自定义')).toBeTruthy();
    expect(screen.getByText('规划 / 架构')).toBeTruthy();
    expect(screen.getByText('anthropic/claude-opus-4.1')).toBeTruthy();
  });

  it('未设置模型时回落到「默认模型」文案', () => {
    renderPanel({ filteredAgents: [agent({ id: 'build' })] });
    expect(screen.getByText('默认模型')).toBeTruthy();
  });

  it('禁用行显示「已禁用」，启用行不显示', () => {
    const { unmount } = renderPanel({ filteredAgents: [agent({ id: 'off', enabled: false })] });
    expect(screen.getByText('已禁用')).toBeTruthy();
    unmount();

    renderPanel({ filteredAgents: [agent({ id: 'on' })] });
    expect(screen.queryByText('已禁用')).toBeNull();
  });

  it('「提示词覆盖」徽章只在 hasPromptOverride 为真时出现', () => {
    const { unmount } = renderPanel({
      filteredAgents: [
        agent({ id: 'build', promptMetadata: { hasPromptOverride: true, defaultText: '默认' } }),
      ],
    });
    expect(screen.getByTitle('系统提示词已被用户覆盖，不再随版本升级更新')).toBeTruthy();
    unmount();

    // hasOverrides（含模型字段）不能代替提示词覆盖状态。
    renderPanel({
      filteredAgents: [
        agent({
          id: 'build',
          hasOverrides: true,
          model: 'openai/gpt-5',
          promptMetadata: { hasPromptOverride: false, defaultText: '默认' },
        }),
      ],
    });
    expect(screen.queryByText('提示词覆盖')).toBeNull();
  });

  it('点击行回传 agent id', () => {
    const onSelect = vi.fn();
    renderPanel({
      filteredAgents: [agent({ id: 'build' }), agent({ id: 'plan' })],
      onSelect,
    });

    fireEvent.click(screen.getByText('plan'));
    expect(onSelect).toHaveBeenCalledWith('plan');
  });

  it('编辑态下选中行标记 aria-current，新建态下不标记', () => {
    const { container, unmount } = renderPanel({
      filteredAgents: [agent({ id: 'build' })],
      selectedAgentId: 'build',
    });
    expect(container.querySelectorAll('[aria-current="true"]').length).toBe(1);
    unmount();

    const creating = renderPanel({
      filteredAgents: [agent({ id: 'build' })],
      selectedAgentId: 'build',
      editorMode: 'create',
    });
    expect(creating.container.querySelectorAll('[aria-current="true"]').length).toBe(0);
  });

  it('保存中禁用所有行，避免重复提交', () => {
    renderPanel({ filteredAgents: [agent({ id: 'build' })], saving: true });
    expect(screen.getByRole('button', { name: /build/i }).hasAttribute('disabled')).toBe(true);
  });
});
