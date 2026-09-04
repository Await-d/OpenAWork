// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AssistantErrorContent } from './assistant-error-content.js';

afterEach(() => {
  cleanup();
});

describe('AssistantErrorContent', () => {
  it('保留 SSE 原始技术详情，避免友好提示覆盖连接根因', () => {
    render(
      <AssistantErrorContent
        content={
          '[错误: SSE_ERROR] SSE 连接异常。\n\n技术详情：connect ECONNREFUSED 127.0.0.1:3000'
        }
      />,
    );

    expect(screen.getByTestId('chat-message-error-banner').textContent).toContain(
      'connect ECONNREFUSED 127.0.0.1:3000',
    );
  });
});
