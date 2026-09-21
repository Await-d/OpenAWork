// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandoffEntry, TeamRoleLayer } from '../../../../../stores/team/team-events.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { ErrorDiagnosticsPanel } from './ErrorDiagnosticsPanel.js';

function makeFailedHandoff(input: {
  id: string;
  toRoleLayer: TeamRoleLayer;
  dismissableFailure?: boolean;
  failureReason?: string;
  recoverableFailure?: boolean;
  reviewDispositionHandled?: boolean;
}): HandoffEntry {
  return {
    dismissableFailure: input.dismissableFailure,
    failureReason: input.failureReason ?? '未知错误',
    fromRoleLayer: 'pm2',
    id: input.id,
    recoverableFailure: input.recoverableFailure,
    reviewDispositionHandled: input.reviewDispositionHandled,
    state: 'failed',
    toRoleLayer: input.toRoleLayer,
    updatedAt: 1_700_000_000_000,
  };
}

const TEAM_WITH_SESSION_LEVEL_FAILURES: AgentTeamsSidebarTeam = {
  id: 'team-1',
  status: 'failed',
  subtitle: '',
  taskFailed: 3,
  title: '测试团队',
};

const PM1_FAILURE = makeFailedHandoff({
  id: 'handoff-pm1-1',
  toRoleLayer: 'pm1',
  failureReason: 'planning-generation-failed: 项目调查返回无效 JSON：{...}；需要用户介入',
});

const TESTER_FAILURE = makeFailedHandoff({
  id: 'handoff-tester-1',
  toRoleLayer: 'tester',
  failureReason: '测试阶段环境不可用，无法继续。',
});

const EXECUTOR_FAILURE = makeFailedHandoff({
  id: 'handoff-executor-1',
  toRoleLayer: 'executor',
  failureReason: '执行阶段产物缺失，无法继续。',
});

const REVIEWER_FAILURE = makeFailedHandoff({
  id: 'handoff-reviewer-1',
  toRoleLayer: 'reviewer',
  failureReason: '评审阶段未通过且不可恢复。',
});

function expandPanel(): void {
  fireEvent.click(screen.getByRole('button', { name: /错误诊断/ }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorDiagnosticsPanel 逐项关闭', () => {
  it('仅对可 dismiss 的 handoff 渲染「关闭」按钮（executor / reviewer 不渲染）', () => {
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[PM1_FAILURE, TESTER_FAILURE, EXECUTOR_FAILURE, REVIEWER_FAILURE]}
        selectedTeam={null}
        onDismissFailed={() => undefined}
      />,
    );
    expandPanel();

    expect(screen.getByRole('button', { name: '关闭失败项 handoff-pm1-1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭失败项 handoff-tester-1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '关闭失败项 handoff-executor-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭失败项 handoff-reviewer-1' })).toBeNull();
  });

  it('点击「关闭」调用 onDismissFailed 且不收起面板', () => {
    const onDismissFailed = vi.fn();
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[PM1_FAILURE]}
        selectedTeam={null}
        onDismissFailed={onDismissFailed}
      />,
    );
    expandPanel();

    fireEvent.click(screen.getByRole('button', { name: '关闭失败项 handoff-pm1-1' }));

    expect(onDismissFailed).toHaveBeenCalledTimes(1);
    expect(onDismissFailed).toHaveBeenCalledWith(['handoff-pm1-1']);
    expect(screen.getByRole('button', { name: /错误诊断/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByText(PM1_FAILURE.failureReason ?? '')).toBeTruthy();
  });

  it('dismissingHandoffIds 命中时按钮禁用并显示「关闭中…」', () => {
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[PM1_FAILURE]}
        selectedTeam={null}
        onDismissFailed={() => undefined}
        dismissingHandoffIds={['handoff-pm1-1']}
      />,
    );
    expandPanel();

    const dismissButton = screen.getByRole('button', { name: '关闭失败项 handoff-pm1-1' });
    expect(dismissButton.hasAttribute('disabled')).toBe(true);
    expect(dismissButton.textContent).toBe('关闭中…');
  });

  it('服务端标记 recoverableFailure 的失败不渲染「关闭」按钮', () => {
    const recoverableFailure = makeFailedHandoff({
      id: 'handoff-pm1-recoverable',
      toRoleLayer: 'pm1',
      failureReason: '网络抖动，等待自动重试。',
      recoverableFailure: true,
    });
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[recoverableFailure]}
        selectedTeam={null}
        onDismissFailed={() => undefined}
      />,
    );
    expandPanel();

    expect(screen.queryByRole('button', { name: '关闭失败项 handoff-pm1-recoverable' })).toBeNull();
  });

  it('超过 5 项时只渲染 5 个逐项按钮，并提供「关闭其余 N 项」批量入口', () => {
    const onDismissFailed = vi.fn();
    const sevenDismissable = Array.from({ length: 7 }, (_, index) =>
      makeFailedHandoff({
        id: `handoff-pm1-${index + 1}`,
        toRoleLayer: 'pm1',
        failureReason: '未知错误',
      }),
    );
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={sevenDismissable}
        selectedTeam={null}
        onDismissFailed={onDismissFailed}
      />,
    );
    expandPanel();

    const itemButtons = screen.getAllByRole('button', { name: /^关闭失败项 / });
    expect(itemButtons).toHaveLength(5);
    expect(screen.queryByRole('button', { name: '关闭失败项 handoff-pm1-6' })).toBeNull();

    const batchButton = screen.getByRole('button', { name: '关闭其余 2 项失败项' });
    fireEvent.click(batchButton);

    expect(onDismissFailed).toHaveBeenCalledTimes(1);
    expect(onDismissFailed).toHaveBeenCalledWith(['handoff-pm1-6', 'handoff-pm1-7']);
  });

  it('被截断的条目全不可关闭时不渲染批量入口，且可关闭项不会被截断吞掉', () => {
    const executorFailures = Array.from({ length: 6 }, (_, index) =>
      makeFailedHandoff({
        id: `handoff-executor-${index + 1}`,
        toRoleLayer: 'executor',
      }),
    );
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[...executorFailures, PM1_FAILURE]}
        selectedTeam={null}
        onDismissFailed={() => undefined}
      />,
    );
    expandPanel();

    expect(screen.getByRole('button', { name: '关闭失败项 handoff-pm1-1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^关闭其余/ })).toBeNull();
  });

  it('零失败项时返回 null', () => {
    const { container } = render(<ErrorDiagnosticsPanel failedHandoffs={[]} selectedTeam={null} />);

    expect(screen.queryByRole('region', { name: '错误诊断简报' })).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('reviewDispositionHandled 的失败项不渲染，且不再单独撑起面板', () => {
    const handled = makeFailedHandoff({
      id: 'handoff-pm2-handled',
      toRoleLayer: 'pm2',
      failureReason: 'PM2 处置已确认的失败',
      reviewDispositionHandled: true,
    });
    const { container } = render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[handled]}
        selectedTeam={null}
        onDismissFailed={() => undefined}
      />,
    );

    expect(screen.queryByRole('region', { name: '错误诊断简报' })).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('reviewDispositionHandled 的失败项不再计入数量，其余未处置失败仍展示', () => {
    const handled = makeFailedHandoff({
      id: 'handoff-pm2-handled',
      toRoleLayer: 'pm2',
      failureReason: 'PM2 处置已确认的失败',
      reviewDispositionHandled: true,
    });
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[handled, PM1_FAILURE]}
        selectedTeam={null}
        onDismissFailed={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: /错误诊断：1 个任务失败/ })).toBeTruthy();
    expandPanel();
    expect(screen.queryByText('PM2 处置已确认的失败')).toBeNull();
    expect(screen.getByText(PM1_FAILURE.failureReason ?? '')).toBeTruthy();
  });

  it('服务端 dismissableFailure=false 时不渲染「关闭」按钮（即使层级本可关闭）', () => {
    const blocked = makeFailedHandoff({
      id: 'handoff-pm1-blocked',
      toRoleLayer: 'pm1',
      dismissableFailure: false,
    });
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[blocked]}
        selectedTeam={null}
        onDismissFailed={() => undefined}
      />,
    );
    expandPanel();

    expect(screen.queryByRole('button', { name: '关闭失败项 handoff-pm1-blocked' })).toBeNull();
  });

  it('服务端 dismissableFailure=true 时 executor 失败也渲染「关闭」按钮（orphaned）', () => {
    const orphaned = makeFailedHandoff({
      id: 'handoff-executor-orphaned',
      toRoleLayer: 'executor',
      dismissableFailure: true,
    });
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[orphaned]}
        selectedTeam={null}
        onDismissFailed={() => undefined}
      />,
    );
    expandPanel();

    expect(
      screen.getByRole('button', { name: '关闭失败项 handoff-executor-orphaned' }),
    ).toBeTruthy();
  });

  it('无 handoff 级失败但 selectedTeam.taskFailed>0 时仍渲染会话级回退项', () => {
    render(
      <ErrorDiagnosticsPanel
        failedHandoffs={[]}
        selectedTeam={TEAM_WITH_SESSION_LEVEL_FAILURES}
        onDismissFailed={() => undefined}
      />,
    );
    expandPanel();

    expect(screen.getByText(/3 个任务执行失败/)).toBeTruthy();
  });
});
