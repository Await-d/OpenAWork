// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ChatStreamErrorBar } from './stream-error-bar.js';

afterEach(() => {
  cleanup();
});

describe('ChatStreamErrorBar', () => {
  it('错误提示里附带最近上游流摘要', () => {
    render(
      <ChatStreamErrorBar
        streamError="上游模型服务暂时不可用，请稍后重试。"
        latestUpstreamSummary={{
          stopReason: 'error',
          textDeltaCount: 0,
          reasoningDeltaCount: 1,
          toolCallDeltaCount: 0,
          sawDone: false,
          sawError: true,
          stalled: true,
        }}
        onDismiss={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /上游模型服务暂时不可用，请稍后重试。 · 流摘要 文本 0 \/ 思考 1 \/ 工具 0 \/ stalled/,
      ),
    ).toBeTruthy();
  });

  it('提供重试按钮并在点击时回调', () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ChatStreamErrorBar
        streamError="上游模型服务暂时不可用，请稍后重试。"
        onDismiss={onDismiss}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByTestId('chat-stream-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('自动重试进度可见且无错误文案时不显示知道了', () => {
    render(
      <ChatStreamErrorBar
        streamError={null}
        retryProgress="自动重连中 · 约 1.5s 后重试…"
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByTestId('chat-stream-error-bar').textContent).toContain(
      '自动重连中 · 约 1.5s 后重试…',
    );
    expect(screen.queryByTestId('chat-stream-error-dismiss')).toBeNull();
    expect(screen.queryByTestId('chat-stream-error-retry')).toBeNull();
  });
});
