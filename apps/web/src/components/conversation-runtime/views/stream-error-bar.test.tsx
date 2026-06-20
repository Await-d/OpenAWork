// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChatStreamErrorBar } from './stream-error-bar.js';

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
});
