// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTask } from '@openAwork/web-client';
import { SubSessionFailureBanner } from './SubSessionFailureBanner.js';

const CHILD_SESSION_ID = 'child-session-1234';
const writeTextMock = vi.fn();

function makeTask(overrides: Partial<SessionTask> & { readonly id: string }): SessionTask {
  return {
    blockedBy: [],
    completedSubtaskCount: 0,
    createdAt: 1_700_000_000_000,
    depth: 0,
    priority: 'medium',
    readySubtaskCount: 0,
    status: 'failed',
    subtaskCount: 0,
    tags: [],
    title: `任务 ${overrides.id}`,
    unmetDependencyCount: 0,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

interface RenderBannerOptions {
  readonly childSessionId?: string;
  readonly failedTasks?: readonly SessionTask[];
  readonly onOpenFullSession?: (sessionId: string) => void;
  readonly sessionStateStatus?: string;
}

function renderBanner(options: RenderBannerOptions = {}) {
  return render(
    <SubSessionFailureBanner
      childSessionId={options.childSessionId ?? CHILD_SESSION_ID}
      failedTasks={options.failedTasks ?? []}
      onOpenFullSession={options.onOpenFullSession ?? (() => undefined)}
      sessionStateStatus={options.sessionStateStatus}
    />,
  );
}

function readReport(): string {
  return String(writeTextMock.mock.calls[0]?.[0] ?? '');
}

beforeEach(() => {
  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeTextMock },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SubSessionFailureBanner', () => {
  it('没有失败任务且会话状态正常时不渲染任何内容', () => {
    const { container } = renderBanner({ sessionStateStatus: 'running' });

    expect(container.querySelector('.sub-session-failure-banner')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('单个失败任务展示身份、失败 chip 与完整错误文本', () => {
    renderBanner({
      failedTasks: [
        makeTask({
          errorMessage: 'TypeError: cannot read x\n  at foo.ts:1',
          id: 'task-1',
          title: '修复登录',
        }),
      ],
      sessionStateStatus: 'running',
    });

    const alert = screen.getByRole('alert', { name: '子代理执行失败' });

    expect(alert.textContent).toContain('修复登录');
    expect(alert.textContent).toContain('失败');
    const errorText = screen.getByText(/TypeError: cannot read x/);
    expect(errorText.tagName).toBe('PRE');
    expect(errorText.textContent).toBe('TypeError: cannot read x\n  at foo.ts:1');
  });

  it('身份回退顺序：标题 → 指派 Agent → 短任务 id', () => {
    renderBanner({
      failedTasks: [
        makeTask({ id: 'task-title', assignedAgent: 'explore', title: '  修复登录  ' }),
        makeTask({ id: 'task-agent', assignedAgent: 'explore', title: '   ' }),
        makeTask({ id: 'task-id-only', assignedAgent: '  ', title: '' }),
      ],
    });

    const names = document.querySelectorAll('.sub-session-failure-banner__name');

    expect(names[0]?.textContent).toBe('修复登录');
    expect(names[1]?.textContent).toBe('explore');
    expect(names[2]?.textContent).toBe('task-id-');
  });

  it('缺少 errorMessage 的失败任务展示未记录错误详情', () => {
    renderBanner({ failedTasks: [makeTask({ id: 'task-1', title: '修复登录' })] });

    expect(screen.getByText('未记录错误详情')).not.toBeNull();
  });

  it('会话级错误且无失败任务时展示 fallback 并指向完整会话', () => {
    const onOpenFullSession = vi.fn();

    renderBanner({ onOpenFullSession, sessionStateStatus: 'error' });

    expect(screen.getByRole('alert', { name: '子代理执行失败' })).not.toBeNull();
    expect(screen.getByText(/未记录任务级错误详情/)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '打开完整会话 →' }));

    expect(onOpenFullSession).toHaveBeenCalledTimes(1);
    expect(onOpenFullSession).toHaveBeenCalledWith(CHILD_SESSION_ID);
  });

  it('多个失败任务按最近更新时间倒序紧凑列出并显示数量', () => {
    renderBanner({
      failedTasks: [
        makeTask({ errorMessage: '旧错误', id: 'task-old', title: '旧任务', updatedAt: 100 }),
        makeTask({ errorMessage: '新错误', id: 'task-new', title: '新任务', updatedAt: 300 }),
        makeTask({ errorMessage: '中间错误', id: 'task-mid', title: '中间任务', updatedAt: 200 }),
      ],
    });

    const items = document.querySelectorAll('.sub-session-failure-banner__item');

    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('新任务');
    expect(items[1]?.textContent).toContain('中间任务');
    expect(items[2]?.textContent).toContain('旧任务');
    expect(screen.getByText('3 个失败任务')).not.toBeNull();
  });

  it('仅当 terminalReason 为 timeout 且带 timeoutSource 时展示超时原因', () => {
    renderBanner({
      failedTasks: [
        makeTask({
          errorMessage: '首响应超时',
          id: 'task-timeout',
          terminalReason: 'timeout',
          timeoutSource: 'first_response',
          title: '超时任务',
          updatedAt: 200,
        }),
        makeTask({
          errorMessage: '无来源超时',
          id: 'task-no-source',
          terminalReason: 'timeout',
          title: '无来源任务',
          updatedAt: 100,
        }),
      ],
    });

    expect(screen.getByText('超时原因：首响应未到')).not.toBeNull();
    expect(screen.queryByText('超时原因：执行超时')).toBeNull();
  });

  it('复制错误写入含会话 id、错误全文与终止原因的报告并短暂显示已复制', async () => {
    renderBanner({
      failedTasks: [
        makeTask({
          errorMessage: '构建失败：TypeError: boom',
          id: 'task-1',
          terminalReason: 'timeout',
          timeoutSource: 'first_response',
          title: '修复登录',
        }),
      ],
      sessionStateStatus: 'error',
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制错误' }));
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    const report = readReport();

    expect(report).toContain('子代理执行失败');
    expect(report).toContain(CHILD_SESSION_ID);
    expect(report).toContain('会话状态：error');
    expect(report).toContain('修复登录');
    expect(report).toContain('状态：失败');
    expect(report).toContain('构建失败：TypeError: boom');
    expect(report).toContain('终止原因：timeout');
    expect(report).toContain('超时来源：首响应未到');
    expect(screen.getByRole('button', { name: '已复制' })).not.toBeNull();
  });

  it('复制反馈约 1.5 秒后复位为复制错误', async () => {
    vi.useFakeTimers();
    renderBanner({ failedTasks: [makeTask({ errorMessage: 'boom', id: 'task-1' })] });

    fireEvent.click(screen.getByRole('button', { name: '复制错误' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: '已复制' })).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(screen.getByRole('button', { name: '复制错误' })).not.toBeNull();
  });

  it('剪贴板不可用时提示复制失败', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    renderBanner({ failedTasks: [makeTask({ errorMessage: 'boom', id: 'task-1' })] });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制错误' }));
    });

    expect(writeTextMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '复制失败' })).not.toBeNull();
  });
});
