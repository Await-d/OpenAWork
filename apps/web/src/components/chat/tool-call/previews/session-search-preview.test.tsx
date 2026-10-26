// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionSearchPreview } from './session-search-preview.js';

afterEach(cleanup);

describe('SessionSearchPreview', () => {
  it('展示匹配数、角色、会话与片段', () => {
    const { container } = render(
      <SessionSearchPreview
        hits={[
          {
            sessionId: 'ses_a',
            messageId: 'msg_1',
            role: 'user',
            snippet: '包含 build pipeline 的片段',
          },
          {
            sessionId: 'ses_b',
            messageId: 'msg_2',
            role: 'assistant',
            snippet: '另一条片段',
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('找到 2 条匹配');
    expect(container.textContent).toContain('用户');
    expect(container.textContent).toContain('助手');
    expect(container.textContent).toContain('ses_a');
    expect(container.textContent).toContain('包含 build pipeline 的片段');
    expect(container.querySelectorAll('[data-session-search-hit]')).toHaveLength(2);
  });

  it('空匹配给出空态', () => {
    const { container } = render(<SessionSearchPreview hits={[]} />);

    expect(container.textContent).toContain('（没有匹配到消息）');
  });
});
