import { describe, expect, it } from 'vitest';
import {
  formatTeamEventSummary,
  teamEventLayerLabel,
  teamEventTypeLabel,
} from './team-event-labels.js';
import type { HandoffEvent } from '../../../../stores/team/team-events.js';

function makeEvent(partial: Partial<HandoffEvent> & { type: string }): HandoffEvent {
  return {
    type: partial.type,
    timestamp: partial.timestamp ?? Date.now(),
    payload: partial.payload ?? {},
    ...(partial.layer ? { layer: partial.layer } : {}),
    ...(partial.sessionId ? { sessionId: partial.sessionId } : {}),
    ...(partial.taskId ? { taskId: partial.taskId } : {}),
  };
}

describe('teamEventTypeLabel', () => {
  it('maps known machine event types to human-readable Chinese labels', () => {
    expect(teamEventTypeLabel('session.substate.changed')).toBe('阶段更新');
    expect(teamEventTypeLabel('session.init.changed')).toBe('初始化进度');
    expect(teamEventTypeLabel('handoff.completed')).toBe('已完成');
  });

  it('never leaks raw dotted machine strings for unknown types', () => {
    const label = teamEventTypeLabel('some.unknown.event');
    expect(label).not.toContain('.');
    expect(label).toBe('some · unknown · event');
  });
});

describe('teamEventLayerLabel', () => {
  it('maps role layers to short Chinese labels', () => {
    expect(teamEventLayerLabel('reception')).toBe('接待');
    expect(teamEventLayerLabel('executor')).toBe('执行');
  });

  it('returns null for missing layer', () => {
    expect(teamEventLayerLabel(undefined)).toBeNull();
    expect(teamEventLayerLabel(null)).toBeNull();
  });
});

describe('formatTeamEventSummary', () => {
  it('prefers an explicit payload summary/message/detail', () => {
    expect(
      formatTeamEventSummary(
        makeEvent({ type: 'session.init.changed', payload: { summary: '正在分析仓库结构' } }),
      ),
    ).toBe('正在分析仓库结构');
  });

  it('expands substate.changed into the concrete stage label', () => {
    expect(
      formatTeamEventSummary(
        makeEvent({ type: 'session.substate.changed', payload: { substate: 'drafting_spec' } }),
      ),
    ).toBe('草拟规格');
  });

  it('falls back to the friendly type label, not the raw machine string', () => {
    const summary = formatTeamEventSummary(makeEvent({ type: 'session.init.changed' }));
    expect(summary).toBe('初始化进度');
    expect(summary).not.toContain('session.init.changed');
  });
});
