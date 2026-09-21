// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HandoffEntry, TeamRoleLayer } from '../../../../stores/team/team-events.js';
import { ClassicTeamConversationInlineCards } from './ClassicTeamConversationInlineCards.js';

afterEach(() => {
  cleanup();
});

function makeFailedHandoff(input: {
  id: string;
  toRoleLayer: TeamRoleLayer;
  dismissableFailure?: boolean;
  summary?: string;
  failureReason?: string;
}): HandoffEntry {
  return {
    dismissableFailure: input.dismissableFailure,
    failureReason: input.failureReason ?? '执行失败',
    fromRoleLayer: 'pm2',
    id: input.id,
    state: 'failed',
    summary: input.summary ?? '失败任务',
    toRoleLayer: input.toRoleLayer,
    updatedAt: Date.now(),
  };
}

function makeClarification(id: string, question: string) {
  return {
    id,
    nodeId: id,
    sessionId: 's1',
    fromSessionId: 'pm1',
    question,
    context: '',
    createdAt: Date.now(),
    status: 'pending' as const,
  };
}

describe('ClassicTeamConversationInlineCards', () => {
  it('澄清只渲染一张聚合卡：计数 + 打开任务台，不再展开问题正文', () => {
    render(
      <ClassicTeamConversationInlineCards
        pendingClarifications={[
          makeClarification('c1', 'callback 用 localhost 吗？'),
          makeClarification('c2', '导出格式选哪个？'),
          makeClarification('c3', '是否需要鉴权？'),
        ]}
        onFocusWorkbench={vi.fn()}
      />,
    );

    expect(screen.getByText('还有 3 项澄清需要你确认')).toBeTruthy();
    expect(screen.getAllByText('打开任务台')).toHaveLength(1);
    expect(screen.queryByText('需要你确认')).toBeNull();
    expect(screen.queryByText('callback 用 localhost 吗？')).toBeNull();
    expect(screen.queryByText('导出格式选哪个？')).toBeNull();
    expect(screen.queryByRole('button', { name: '填入回复' })).toBeNull();
  });

  it('点击聚合卡跳转按钮会聚焦任务台', () => {
    const onFocusWorkbench = vi.fn();
    render(
      <ClassicTeamConversationInlineCards
        pendingClarifications={[makeClarification('c1', '确认范围？')]}
        onFocusWorkbench={onFocusWorkbench}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开任务台' }));
    expect(onFocusWorkbench).toHaveBeenCalledTimes(1);
  });

  it('失败 handoff 仍逐条渲染，并可重试', () => {
    const onRetryFailed = vi.fn();
    render(
      <ClassicTeamConversationInlineCards
        failedHandoffs={[
          {
            id: 'h-fail',
            state: 'failed',
            fromRoleLayer: 'pm2',
            toRoleLayer: 'executor',
            summary: 'callback 超时',
            failureReason: 'token exchange timeout',
            updatedAt: Date.now(),
          },
        ]}
        pendingClarifications={[makeClarification('c1', '确认范围？')]}
        onRetryFailed={onRetryFailed}
      />,
    );

    expect(screen.getByText('callback 超时')).toBeTruthy();
    expect(screen.getByText('token exchange timeout')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试失败' }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });

  it('returns null when no cards', () => {
    const { container } = render(<ClassicTeamConversationInlineCards />);
    expect(container.querySelector('[data-team-classic-inline-cards]')).toBeNull();
  });

  it('可关闭失败项在 canActOnRuntimeFailures 下渲染「关闭」并回传 handoffId', () => {
    const onDismissFailed = vi.fn();
    render(
      <ClassicTeamConversationInlineCards
        canActOnRuntimeFailures
        failedHandoffs={[makeFailedHandoff({ id: 'h-pm1', toRoleLayer: 'pm1' })]}
        onDismissFailed={onDismissFailed}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭失败项 h-pm1' }));

    expect(onDismissFailed).toHaveBeenCalledTimes(1);
    expect(onDismissFailed).toHaveBeenCalledWith(['h-pm1']);
  });

  it('executor 失败在无服务端标记时不渲染「关闭」（本地禁令回落）', () => {
    render(
      <ClassicTeamConversationInlineCards
        canActOnRuntimeFailures
        failedHandoffs={[makeFailedHandoff({ id: 'h-executor', toRoleLayer: 'executor' })]}
        onDismissFailed={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '关闭失败项 h-executor' })).toBeNull();
  });

  it('服务端 dismissableFailure=true 时 executor 失败渲染「关闭」（orphaned）', () => {
    render(
      <ClassicTeamConversationInlineCards
        canActOnRuntimeFailures
        failedHandoffs={[
          makeFailedHandoff({
            id: 'h-executor-orphaned',
            toRoleLayer: 'executor',
            dismissableFailure: true,
          }),
        ]}
        onDismissFailed={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '关闭失败项 h-executor-orphaned' })).toBeTruthy();
  });

  it('无 canActOnRuntimeFailures 权限时不渲染「关闭」', () => {
    render(
      <ClassicTeamConversationInlineCards
        failedHandoffs={[makeFailedHandoff({ id: 'h-pm1', toRoleLayer: 'pm1' })]}
        onDismissFailed={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '关闭失败项 h-pm1' })).toBeNull();
  });

  it('dismissingHandoffIds 命中时「关闭」禁用并显示「关闭中…」', () => {
    render(
      <ClassicTeamConversationInlineCards
        canActOnRuntimeFailures
        dismissingHandoffIds={['h-pm1']}
        failedHandoffs={[makeFailedHandoff({ id: 'h-pm1', toRoleLayer: 'pm1' })]}
        onDismissFailed={vi.fn()}
      />,
    );

    const dismissButton = screen.getByRole('button', { name: '关闭失败项 h-pm1' });
    expect(dismissButton.hasAttribute('disabled')).toBe(true);
    expect(dismissButton.textContent).toBe('关闭中…');
  });
});
