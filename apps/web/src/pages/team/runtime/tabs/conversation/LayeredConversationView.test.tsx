// @vitest-environment jsdom
/**
 * 260517 · LayeredConversationView 双栏 Smoke 测试
 *
 * 验收 chat-conversation-reuse-plan v1.4 §9.2：点击 timeline 行后右栏渲染
 * 对应 to_session 的 TeamSessionView。再次点击同条 handoff 取消选中。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type LayerNode,
} from '../../../../../stores/team-events.js';

vi.mock('../../shell/TeamSessionView.js', () => ({
  TeamSessionView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="team-session-view-mock" data-session-id={sessionId} />
  ),
}));

import { LayeredConversationView } from './LayeredConversationView.js';

function seedHandoff(entry: HandoffEntry) {
  const map = new Map<string, HandoffEntry>([[entry.id, entry]]);
  useHandoffStore.setState({ handoffs: map });
}

function seedLayerNodes(nodes: LayerNode[]) {
  const map = new Map<string, LayerNode>(nodes.map((n) => [n.sessionId, n]));
  useLayerStore.setState({ nodes: map });
}

beforeEach(() => {
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
});

afterEach(() => {
  cleanup();
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
  vi.restoreAllMocks();
});

describe('LayeredConversationView — 双栏交互', () => {
  it('无 handoff / 节点时显示空态', () => {
    render(<LayeredConversationView />);
    expect(screen.getByText('暂无层级对话数据')).toBeTruthy();
  });

  it('有 handoff 时左栏渲染行，右栏默认欢迎面板', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-pm1-001',
        roleLayer: 'pm1',
        parentSessionId: null,
        state: 'running',
      },
    ]);
    seedHandoff({
      id: 'handoff-001',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1-001',
      updatedAt: Date.now(),
    });

    render(<LayeredConversationView />);

    expect(screen.getByText('选择左侧 handoff 查看会话内容')).toBeTruthy();
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
  });

  it('点击 timeline 行后右栏渲染对应 session 的 TeamSessionView', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-pm1-002',
        roleLayer: 'pm1',
        parentSessionId: null,
        state: 'running',
      },
    ]);
    seedHandoff({
      id: 'handoff-002',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1-002',
      updatedAt: Date.now(),
    });

    render(<LayeredConversationView />);

    // timeline 行通过 sessionId 文案找
    const row = screen.getByTitle('查看会话 sess-pm1-002');
    fireEvent.click(row);

    const view = screen.getByTestId('team-session-view-mock');
    expect(view.getAttribute('data-session-id')).toBe('sess-pm1-002');
  });

  it('再次点击同条 handoff 取消选中，回到欢迎面板', () => {
    seedLayerNodes([
      {
        sessionId: 'sess-pm1-003',
        roleLayer: 'pm1',
        parentSessionId: null,
        state: 'running',
      },
    ]);
    seedHandoff({
      id: 'handoff-003',
      state: 'running',
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      sessionId: 'sess-pm1-003',
      updatedAt: Date.now(),
    });

    render(<LayeredConversationView />);

    const row = screen.getByTitle('查看会话 sess-pm1-003');
    fireEvent.click(row);
    expect(screen.queryByTestId('team-session-view-mock')).toBeTruthy();

    fireEvent.click(row);
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
    expect(screen.getByText('选择左侧 handoff 查看会话内容')).toBeTruthy();
  });
});
