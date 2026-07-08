// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionStage, type CompanionStageProps } from './companion-stage.js';

vi.mock('@openAwork/web-client', () => ({
  createSettingsClient: vi.fn(() => ({
    getCompanion: vi.fn(),
    putCompanion: vi.fn(),
    putCompanionChat: vi.fn(),
  })),
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector?: (state: { accessToken: string | null; gatewayUrl: string }) => unknown) => {
    const state = {
      accessToken: null,
      gatewayUrl: 'https://gateway.test',
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('./use-buddy-voice-output.js', () => ({
  useBuddyVoiceOutput: () => ({
    isSpeaking: false,
    isVoiceOutputAvailable: false,
    speechStatusLabel: '无播报',
  }),
}));

function makeProps(overrides: Partial<CompanionStageProps> = {}): CompanionStageProps {
  return {
    agentId: 'default',
    attachedCount: 0,
    currentUserEmail: 'tester@example.com',
    editorMode: false,
    hasStreamError: false,
    idleSeconds: 0,
    input: '',
    lastToolName: null,
    pendingPermissionCount: 0,
    prefersReducedMotion: true,
    queuedCount: 0,
    rightOpen: false,
    sessionBusyState: null,
    sessionId: 'session-companion-stage',
    showVoice: false,
    streamErrorMessage: null,
    streaming: false,
    todoCount: 0,
    toolCallCount: 0,
    ...overrides,
  };
}

async function openCompanionPanel(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId('companion-stage'));
  return screen.findByTestId('companion-output-log');
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('CompanionStage · 关键区域状态触发', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Given 工具状态变化 When props 经 hook 链路更新 Then 触发工具启动和完成输出', async () => {
    const view = render(<CompanionStage {...makeProps()} />);
    await openCompanionPanel();

    view.rerender(
      <CompanionStage {...makeProps({ lastToolName: 'read_file', toolCallCount: 1 })} />,
    );

    const outputLog = await screen.findByTestId('companion-output-log');
    await waitFor(() => {
      expect(within(outputLog).getByText('工具启动')).toBeTruthy();
    });
    expect(within(outputLog).getByText(/开始执行 read_file/)).toBeTruthy();

    view.rerender(<CompanionStage {...makeProps({ toolCallCount: 0 })} />);

    await waitFor(() => {
      expect(within(outputLog).getByText('工具完成')).toBeTruthy();
    });
    expect(within(outputLog).getByText('工具调用结束了，我把上下文继续贴回主线。')).toBeTruthy();
  });

  it('Given 错误和空闲状态变化 When props 经 hook 链路更新 Then 触发错误提示与空闲提醒输出', async () => {
    const view = render(<CompanionStage {...makeProps()} />);
    await openCompanionPanel();

    view.rerender(
      <CompanionStage
        {...makeProps({
          hasStreamError: true,
          streamErrorMessage: '上游模型服务暂时不可用，请稍后重试。',
        })}
      />,
    );

    const outputLog = await screen.findByTestId('companion-output-log');
    await waitFor(() => {
      expect(within(outputLog).getByText('错误提示')).toBeTruthy();
    });
    expect(
      within(outputLog).getByText('这轮遇到错误：上游模型服务暂时不可用，请稍后重试。'),
    ).toBeTruthy();

    view.rerender(<CompanionStage {...makeProps({ idleSeconds: 185 })} />);

    await waitFor(() => {
      expect(within(outputLog).getByText('你停了一会儿，我先替你守着这轮上下文。')).toBeTruthy();
    });
  });
});
