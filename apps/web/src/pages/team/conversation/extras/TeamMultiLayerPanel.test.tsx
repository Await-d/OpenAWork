// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { TeamMultiLayerPanel, type LayerMessages } from './TeamMultiLayerPanel.js';

afterEach(() => {
  cleanup();
});

function message(id: string, content: string, createdAt: number): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    createdAt,
  };
}

describe('TeamMultiLayerPanel', () => {
  it('时间线视图使用共享滚动容器并保持角色标题单行显示', () => {
    const baseTs = Date.parse('2026-07-17T09:30:00.000Z');
    const layers: LayerMessages[] = [
      {
        layer: 'reception',
        sessionIds: ['session-root'],
        isActive: true,
        messages: [message('root-msg', '接待层已收到需求。', baseTs)],
      },
      {
        layer: 'pm1',
        sessionIds: ['session-pm1'],
        isActive: false,
        messages: [message('pm1-msg', '规划层开始拆解任务。', baseTs + 60_000)],
      },
      {
        layer: 'executor',
        sessionIds: ['session-executor'],
        isActive: false,
        messages: [message('executor-msg', '执行层正在修复旧版时间线布局。', baseTs + 120_000)],
      },
      {
        layer: 'reviewer',
        sessionIds: ['session-reviewer'],
        isActive: false,
        messages: [message('reviewer-msg', '评审层确认标题不再按字折行。', baseTs + 180_000)],
      },
    ];

    render(
      <div style={{ width: 360, height: 480 }}>
        <TeamMultiLayerPanel layers={layers} viewMode="timeline" activeLayer="pm1" />
      </div>,
    );

    const timeline = screen.getByLabelText('团队层级时间线');
    expect(timeline.style.overflow).toBe('auto');

    const receptionHeader = screen.getAllByText('接待')[0];
    expect(receptionHeader).toBeTruthy();
    expect(receptionHeader?.style.whiteSpace).toBe('nowrap');
    expect(receptionHeader?.style.textOverflow).toBe('ellipsis');

    expect(screen.getByText('17:30')).toBeTruthy();
    expect(screen.getByText('规划层开始拆解任务。')).toBeTruthy();
  });
});
