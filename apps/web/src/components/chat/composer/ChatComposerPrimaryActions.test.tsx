// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatComposerPrimaryActions,
  type ChatComposerPrimaryActionsProps,
} from './ChatComposerPrimaryActions.js';

afterEach(() => {
  cleanup();
});

function renderActions(overrides: Partial<ChatComposerPrimaryActionsProps> = {}) {
  const props: ChatComposerPrimaryActionsProps = {
    input: '继续跟进',
    streaming: false,
    imageGenerationMode: false,
    imageGenerationBusy: false,
    canSubmit: true,
    stoppingStream: false,
    submitPending: false,
    sessionBusyState: null,
    effectiveStopCapability: 'none',
    showStopAction: false,
    showQueueAction: false,
    queuedMessageCount: 0,
    optimizeError: null,
    optimizeLoading: false,
    optimizeResult: null,
    onClearOptimizeResult: () => undefined,
    onClearOptimizeError: () => undefined,
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };

  render(<ChatComposerPrimaryActions {...props} />);
  return {
    onSend: props.onSend as ReturnType<typeof vi.fn>,
    onStop: props.onStop as ReturnType<typeof vi.fn>,
  };
}

describe('ChatComposerPrimaryActions · 发送键启用态', () => {
  it('空闲态可点击并发送', () => {
    const { onSend } = renderActions();

    const button = screen.getByRole('button', { name: /发送/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('暂停态（等待审批 / 等待回答）仍可发送，不退化成禁用的「待处理」', () => {
    // paused 只表示存在待用户处理的交互，网关此刻并未持有单飞锁。若继续禁用，
    // 用户就只能等交互解除才能发言——这正是本次要消除的阻塞。
    const { onSend } = renderActions({ sessionBusyState: 'paused' });

    const button = screen.getByRole('button', { name: /发送/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('运行态禁用发送键并显示「运行中」', () => {
    renderActions({ sessionBusyState: 'running' });

    const button = screen.getByRole('button', { name: /运行中/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('提交在途时显示「发送中…」并禁用，避免被误当成没点上而重复点击', () => {
    const { onSend } = renderActions({ submitPending: true });

    const button = screen.getByRole('button', { name: /发送中/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('提交在途优先于运行态文案', () => {
    renderActions({ sessionBusyState: 'running', submitPending: true });

    expect(screen.getByRole('button', { name: /发送中/ })).toBeTruthy();
  });
});
