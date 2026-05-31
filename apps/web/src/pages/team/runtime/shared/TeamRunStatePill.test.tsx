// @vitest-environment jsdom
/**
 * TeamRunStatePill · 紧凑运行状态胶囊 smoke 测试
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  useHandoffStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
  type HandoffEntry,
} from '../../../../stores/team/team-events.js';
import { TeamRunStatePill } from './TeamRunStatePill.js';

function setHandoffs(entries: HandoffEntry[]): void {
  useHandoffStore.setState({ handoffs: new Map(entries.map((e) => [e.id, e])) });
}

afterEach(() => {
  cleanup();
  setHandoffs([]);
  useTeamEventsConnectionStore.setState({ state: 'connected' as never });
  useTeamNotificationStore.setState({ events: [] });
  vi.restoreAllMocks();
});

describe('TeamRunStatePill', () => {
  it('idle（无 handoff）时不渲染', () => {
    setHandoffs([]);
    const { container } = render(<TeamRunStatePill />);
    expect(container.firstChild).toBeNull();
  });

  it('有活跃 handoff 时显示运行中 + 计数', () => {
    setHandoffs([
      {
        id: 'a',
        state: 'running',
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        updatedAt: Date.now(),
      } as HandoffEntry,
    ]);
    render(<TeamRunStatePill />);
    expect(screen.getByText('运行中')).toBeTruthy();
  });

  it('compact 模式只显示计数不显示文字标签', () => {
    setHandoffs([
      {
        id: 'a',
        state: 'failed',
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        updatedAt: Date.now(),
      } as HandoffEntry,
    ]);
    render(<TeamRunStatePill compact />);
    // compact 下不渲染「出现失败」文字标签
    expect(screen.queryByText('出现失败')).toBeNull();
  });
});
