// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BlockToolCall } from './block-tool-call.js';

// 通用输出预览打桩：本组用例只关心它「在不在」，不关心它渲染了什么内容。
vi.mock('../io/tool-output-preview.js', () => ({
  ToolOutputPreview: () => <div data-testid="generic-output-preview" />,
}));

const WEB_URL = 'https://example.com/';

/** 默认折叠，展开体需要真的点一下标题栏才会出现。 */
function expand(container: HTMLElement): void {
  const header = container.querySelector('.tool-call-block-header');
  if (!header) throw new Error('未渲染折叠行');
  fireEvent.click(header);
}

function renderWebfetch(content: string, status: 'running' | 'completed' | 'failed' = 'completed') {
  return render(
    <BlockToolCall
      toolName="webfetch"
      input={{ url: WEB_URL, format: 'text' }}
      output={{
        url: WEB_URL,
        status: 200,
        contentType: 'text/html',
        format: 'text',
        content,
      }}
      status={status}
      durationMs={120}
    />,
  );
}

afterEach(cleanup);

/**
 * web 卡与通用兜底必须**互补**，否则会出现整块空白。
 *
 * 两个真实触发档（都在修前落到「web 卡不渲染 + 通用兜底被 `!isWebTool` 抑制」）：
 * ① `webSummary` memo 在 `visualState !== 'completed'`（流式进行中）时返回 null；
 *    注意 `extractWebSummary` 本身对对象输入**总会返回对象**，不是它返回 null；
 * ② 即使 `completed`，imageUrl / cleanedContent / searchResults / structuredResults
 *    四个展示分支也可能全为空（`content: ''` 时 `cleanedContent === ''`）。
 */
describe('BlockToolCall · web 工具无可展示内容时不得留空白', () => {
  it('流式进行中（webSummary 为 null）时回落到通用输出预览', () => {
    const { container } = renderWebfetch('', 'running');
    expand(container);

    expect(screen.queryByTestId('generic-output-preview')).not.toBeNull();
  });

  it('已完成但正文为空时回落到通用输出预览，而不是什么都不渲染', () => {
    const { container } = renderWebfetch('');
    expand(container);

    expect(screen.queryByTestId('generic-output-preview')).not.toBeNull();
  });

  it('正文有内容时不回落（由 web 卡渲染，避免同一输出被渲染两次）', () => {
    const { container } = renderWebfetch('<p>hello</p>');
    expand(container);

    expect(screen.queryByTestId('generic-output-preview')).toBeNull();
  });
});
