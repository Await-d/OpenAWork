// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubagentNotice } from '@openAwork/shared';
import { SubagentNoticeRow } from './SubagentNoticeRow.js';

afterEach(() => {
  cleanup();
});

const EXPLORE_RESULTS = `<results>
<files>
- /abs/path/to/file1.ts — 状态机核心实现
</files>

<answer>
状态机在 file1.ts 中定义。
</answer>

<next_steps>
- 先读 transition 函数
</next_steps>
</results>`;

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
  it('渲染标题行：代理名 + 状态标签 + 描述', () => {
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

  it('有 childID 且传入 onOpenChild 时标题行是原生 button，点击回传子会话 id', () => {
    const onOpenChild = vi.fn();
    render(<SubagentNoticeRow notice={buildNotice()} onOpenChild={onOpenChild} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(onOpenChild).toHaveBeenCalledWith('child-1');
  });

  it('未传 onOpenChild 时不可交互（无 button）', () => {
    render(<SubagentNoticeRow notice={buildNotice()} />);

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

    const heading = container.querySelector('[data-subagent-notice-heading="true"]') as HTMLElement;
    expect(heading.style.outline).toContain('var(--accent');
    expect(heading.style.outlineOffset).toBe('2px');
    expect(heading.style.boxShadow).toContain('var(--accent-subtle');

    fireEvent.blur(heading);
    expect(
      (container.querySelector('[data-subagent-notice-heading="true"]') as HTMLElement).style
        .outline,
    ).toBe('');
  });

  it('failed 且描述为空时仍渲染（强制可见），且不输出多余分隔符', () => {
    const { container } = render(
      <SubagentNoticeRow notice={buildNotice({ state: 'failed', description: '' })} />,
    );
    const row = container.querySelector('[data-component="subagent-notice"]');

    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('已失败');
  });

  it('无 <results> 块时正文直接展示（无结构化卡片）', () => {
    const { container } = render(
      <SubagentNoticeRow notice={buildNotice({ text: '纯文本总结，无结构化块' })} />,
    );
    const card = container.querySelector('[data-component="subagent-result-card"]');
    // 卡片组件存在但退化为非结构化视图（data-structured 为 "false"）。
    expect(card?.getAttribute('data-structured')).toBe('false');
    expect(container.textContent).toContain('纯文本总结，无结构化块');
    expect(container.textContent).not.toContain('<results>');
  });

  it('结构化结果全展开：渲染 answer / files / next_steps 分节且不泄露原始标签', () => {
    const { container } = render(
      <SubagentNoticeRow notice={buildNotice({ text: EXPLORE_RESULTS })} />,
    );
    const card = container.querySelector('[data-component="subagent-result-card"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-structured')).toBe('true');
    expect(card?.textContent).toContain('相关文件');
    expect(card?.textContent).toContain('状态机在 file1.ts 中定义。');
    expect(card?.textContent).toContain('后续步骤');
    // 原始 XML 标签被解析后不应再作为可见文本出现。
    expect(card?.textContent).not.toContain('<results>');
    expect(card?.textContent).not.toContain('<files>');
  });

  it('卡片内不嵌套可交互按钮（a11y：button 内不允许 button）', () => {
    const { container } = render(
      <SubagentNoticeRow
        notice={buildNotice({ text: EXPLORE_RESULTS })}
        onOpenChild={() => undefined}
      />,
    );
    const heading = container.querySelector('button[data-subagent-notice-heading="true"]');
    expect(heading?.querySelector('button')).toBeNull();
  });
});
