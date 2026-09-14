// @vitest-environment jsdom
/**
 * LayerConversationDrawer 的行为约定：
 *   1. visible=false 不渲染；visible=true 默认是收起的（只露一条头）；
 *   2. 传入 target（卡片墙「完整会话」入口）时自动展开并聚焦该角色实例；
 *   3. target 的 nonce 变化时重新展开 —— 「收起抽屉后再点同一张卡片」必须有效；
 *   4. target 指向 layer store 里还没有节点的实例，也要能渲染出完整会话
 *      （卡片墙的数据来自会话恢复接口，可能早于 layer store 落库）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayerStore } from '../../../../../stores/team/team-events.js';
import { LayerConversationDrawer } from './LayerConversationDrawer.js';

vi.mock('../../../conversation/TeamConversationView.js', () => ({
  TeamConversationView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="full-session">{sessionId}</div>
  ),
}));

function seedNodes(sessionIds: string[]): void {
  useLayerStore.getState().replaceAll(
    sessionIds.map((sessionId, index) => ({
      sessionId,
      roleLayer: 'executor' as const,
      parentSessionId: null,
      state: index === 0 ? ('running' as const) : ('completed' as const),
    })),
  );
}

afterEach(() => {
  cleanup();
  useLayerStore.getState().clear();
});

describe('LayerConversationDrawer', () => {
  it('visible=false 时不渲染', () => {
    seedNodes(['s-1']);
    render(<LayerConversationDrawer visible={false} />);

    expect(screen.queryByText('层级对话')).toBeNull();
  });

  it('默认收起，点头部后展开并渲染第一个实例的会话', () => {
    seedNodes(['s-1']);
    render(<LayerConversationDrawer visible />);

    expect(screen.queryByTestId('full-session')).toBeNull();

    fireEvent.click(screen.getByText(/层级对话/));
    expect(screen.getByTestId('full-session').textContent).toBe('s-1');
  });

  it('传入 target 时自动展开并聚焦该角色实例', () => {
    seedNodes(['s-1', 's-2']);
    render(<LayerConversationDrawer visible target={{ sessionId: 's-2', nonce: 1 }} />);

    expect(screen.getByTestId('full-session').textContent).toBe('s-2');
  });

  it('target 的 nonce 变化时重新展开（收起后能再次打开同一张卡片）', () => {
    seedNodes(['s-1', 's-2']);
    const { rerender } = render(
      <LayerConversationDrawer visible target={{ sessionId: 's-2', nonce: 1 }} />,
    );
    expect(screen.getByTestId('full-session')).toBeTruthy();

    // 用户手动收起
    fireEvent.click(screen.getByText(/层级对话/));
    expect(screen.queryByTestId('full-session')).toBeNull();

    // 再点同一张卡片的「完整会话」：nonce 变化 → 重新展开
    rerender(<LayerConversationDrawer visible target={{ sessionId: 's-2', nonce: 2 }} />);
    expect(screen.getByTestId('full-session').textContent).toBe('s-2');
  });

  it('target 指向 layer store 中不存在的实例也能渲染完整会话', () => {
    seedNodes(['s-1']);
    render(<LayerConversationDrawer visible target={{ sessionId: 's-child', nonce: 1 }} />);

    expect(screen.getByTestId('full-session').textContent).toBe('s-child');
  });

  it('layer store 为空但有 target 时照常渲染', () => {
    render(<LayerConversationDrawer visible target={{ sessionId: 's-child', nonce: 1 }} />);

    expect(screen.getByTestId('full-session').textContent).toBe('s-child');
  });

  it('target 在抽屉不可见时设置，变可见后直接是展开态（不闪收起帧）', () => {
    seedNodes(['s-1', 's-2']);
    const { rerender } = render(
      <LayerConversationDrawer visible={false} target={{ sessionId: 's-2', nonce: 1 }} />,
    );
    rerender(<LayerConversationDrawer visible target={{ sessionId: 's-2', nonce: 1 }} />);

    expect(screen.getByTestId('full-session').textContent).toBe('s-2');
  });

  it('layer store 为空且没有 target 时整体不渲染', () => {
    render(<LayerConversationDrawer visible />);

    expect(screen.queryByText('层级对话')).toBeNull();
  });
});
