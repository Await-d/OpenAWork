// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionInfoPreview } from './session-info-preview.js';

afterEach(cleanup);

describe('SessionInfoPreview', () => {
  it('展示会话 id、状态与关键字段', () => {
    const { container } = render(
      <SessionInfoPreview
        data={{
          sessionId: 'ses_a',
          status: 'active',
          messageCount: 12,
          dateRange: '2026-10-01 → 2026-10-02',
          todos: 'Yes (3 items)',
          fileDiffs: '2',
          snapshots: '1',
          children: '1',
          extra: [],
        }}
      />,
    );

    expect(container.textContent).toContain('ses_a');
    expect(container.textContent).toContain('active');
    expect(container.textContent).toContain('消息数');
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('待办');
    expect(container.textContent).toContain('Yes (3 items)');
    expect(container.textContent).toContain('子会话');
    // 没有额外字段时不渲染「更多」折叠。
    expect(container.querySelector('details')).toBeNull();
  });

  it('未建模字段收进「更多」折叠，不丢失', () => {
    const { container } = render(
      <SessionInfoPreview
        data={{
          sessionId: 'ses_a',
          extra: [
            ['Weakest Guarantee', 'strong'],
            ['Latest Snapshot', 'snap_1'],
          ],
        }}
      />,
    );

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.querySelector('summary')?.textContent).toContain('更多（2）');
    expect(details?.textContent).toContain('strong');
    expect(details?.textContent).toContain('snap_1');
  });

  it('没有状态时不渲染状态徽标', () => {
    const { container } = render(<SessionInfoPreview data={{ sessionId: 'ses_a', extra: [] }} />);

    expect(container.textContent).not.toContain('active');
    expect(container.textContent).toContain('ses_a');
  });
});
