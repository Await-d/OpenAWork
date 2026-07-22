// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TeamDynamicStrip } from './TeamDynamicStrip.js';
import type { TeamDynamicEntry } from './team-dynamic-events.js';

afterEach(() => cleanup());

function createEntry(index: number, overrides?: Partial<TeamDynamicEntry>): TeamDynamicEntry {
  return {
    id: `entry-${index + 1}`,
    count: 1,
    detail: `细节 ${index + 1}`,
    eventLabel: '澄清',
    layerLabel: 'PM1',
    summary: `摘要 ${index + 1}`,
    timeLabel: `10:0${index}`,
    title: `动态 ${index + 1}`,
    tone: 'info',
    ...overrides,
  };
}

describe('TeamDynamicStrip', () => {
  it('默认只显示前两条，并可展开剩余动态', () => {
    render(
      <TeamDynamicStrip
        entries={[createEntry(0), createEntry(1), createEntry(2), createEntry(3)]}
      />,
    );

    expect(screen.getByText('动态 1')).toBeTruthy();
    expect(screen.getByText('动态 2')).toBeTruthy();
    expect(screen.queryByText('动态 3')).toBeNull();
    expect(screen.queryByText('动态 4')).toBeNull();
    expect(screen.getByRole('button', { name: '展开其余 2 条' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '展开其余 2 条' }));

    expect(screen.getByText('动态 3')).toBeTruthy();
    expect(screen.getByText('动态 4')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起动态' })).toBeTruthy();
  });

  it('动作标签默认压缩为前两个，其余数量折叠为计数', () => {
    render(
      <TeamDynamicStrip
        entries={[
          createEntry(0, {
            actions: ['GitHub', 'Vercel', 'Slack', 'Sentry'],
          }),
        ]}
      />,
    );

    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.getByText('Vercel')).toBeTruthy();
    expect(screen.queryByText('Slack')).toBeNull();
    expect(screen.queryByText('Sentry')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
  });
});
