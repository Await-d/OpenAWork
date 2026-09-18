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

  it('原始错误原因必须可见：不得被友好模板吞掉', () => {
    render(<AssistantErrorContent content="[错误: INVALID_REQUEST] 请求参数无效。" />);

    const banner = screen.getByTestId('chat-message-error-banner');
    expect(banner.textContent).toContain('INVALID_REQUEST');
    expect(banner.textContent).toContain('请求参数无效。');
    expect(banner.textContent).not.toContain('处理您的请求时遇到了问题');
  });

  it('友好归纳与上游原始英文原因同时可见', () => {
    render(
      <AssistantErrorContent content="[错误: MODEL_ERROR] Failed after 4 attempts. Last error: AI_APICallError: Service Unavailable" />,
    );

    const banner = screen.getByTestId('chat-message-error-banner');
    expect(banner.textContent).toContain('模型服务暂时不可用');
    expect(banner.textContent).toContain('Failed after 4 attempts');
  });
});
