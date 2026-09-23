// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubagentNotice } from '@openAwork/shared';
import { SubagentNoticeRow } from './SubagentNoticeRow.js';

afterEach(() => {
  cleanup();
});

function buildNotice(overrides: Partial<SubagentNotice> = {}): SubagentNotice {
  return {
    id: 'notice-1',
    agent: 'explore',
    state: 'done',
    description: '审计会话唤醒原语',
    childSessionId: 'child-1',
    text: '子代理已完成 · 审计会话唤醒原语',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('SubagentNoticeRow', () => {
  it('渲染一行通知：代理名 + 状态标签 + 描述', () => {
    const { container } = render(<SubagentNoticeRow notice={buildNotice()} />);
    const row = container.querySelector('[data-component="subagent-notice"]');

    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-state')).toBe('done');
    expect(row?.textContent).toContain('explore');
    expect(row?.textContent).toContain('已完成');
    expect(row?.textContent).toContain('· 审计会话唤醒原语');
  });

  it('三态标签与语义色各自正确', () => {
    const cases = [
      { state: 'done' as const, label: '已完成', token: '--aux' },
      { state: 'failed' as const, label: '已失败', token: '--danger' },
      { state: 'cancelled' as const, label: '已取消', token: '--warning' },
    ];

    for (const testCase of cases) {
      const { container, unmount } = render(
        <SubagentNoticeRow notice={buildNotice({ state: testCase.state })} />,
      );
      const row = container.querySelector('[data-component="subagent-notice"]');
      expect(row?.getAttribute('data-state')).toBe(testCase.state);
      expect(row?.textContent).toContain(testCase.label);
      expect(container.innerHTML).toContain(`var(${testCase.token}`);
      unmount();
    }
  });

  it('有 childID 且传入 onOpenChild 时是原生 button，点击回传子会话 id', () => {
    const onOpenChild = vi.fn();
    render(<SubagentNoticeRow notice={buildNotice()} onOpenChild={onOpenChild} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(onOpenChild).toHaveBeenCalledWith('child-1');
  });

  it('未传 onOpenChild 时不可交互（div 而非 button）', () => {
    const { container } = render(<SubagentNoticeRow notice={buildNotice()} />);

    expect(container.querySelector('button')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('有 onOpenChild 但无 childID 时不可交互', () => {
    const onOpenChild = vi.fn();
    render(
      <SubagentNoticeRow
        notice={buildNotice({ childSessionId: undefined })}
        onOpenChild={onOpenChild}
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('聚焦时套用 accent focus ring（可访问性要求）', () => {
    const { container } = render(
      <SubagentNoticeRow notice={buildNotice()} onOpenChild={() => undefined} />,
    );
    const button = screen.getByRole('button');

    expect(button.style.outline).toBe('');

    fireEvent.focus(button);

    const focused = container.querySelector('[data-component="subagent-notice"]') as HTMLElement;
    expect(focused.style.outline).toContain('var(--accent');
    expect(focused.style.outlineOffset).toBe('2px');
    expect(focused.style.boxShadow).toContain('var(--accent-subtle');

    fireEvent.blur(focused);
    expect(
      (container.querySelector('[data-component="subagent-notice"]') as HTMLElement).style.outline,
    ).toBe('');
  });

  it('failed 且描述为空时仍渲染（强制可见），且不输出多余分隔符', () => {
    const { container } = render(
      <SubagentNoticeRow notice={buildNotice({ state: 'failed', description: '' })} />,
    );
    const row = container.querySelector('[data-component="subagent-notice"]');

    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('已失败');
    expect(row?.textContent).not.toContain('·');
  });

  it('grouped 收紧上下间距，未分组时上下留白对称', () => {
    const { container: groupedContainer, unmount: unmountGrouped } = render(
      <SubagentNoticeRow notice={buildNotice()} grouped />,
    );
    const groupedRow = groupedContainer.querySelector(
      '[data-component="subagent-notice"]',
    ) as HTMLElement;
    expect(groupedRow.style.padding).toBe('4px 0px');
    unmountGrouped();

    const { container: looseContainer } = render(<SubagentNoticeRow notice={buildNotice()} />);
    const looseRow = looseContainer.querySelector(
      '[data-component="subagent-notice"]',
    ) as HTMLElement;
    // 对称 padding：通知行夹在两条消息之间时必须上下居中，不得偏向任一侧。
    expect(looseRow.style.padding).toBe('8px 0px');
  });
});
