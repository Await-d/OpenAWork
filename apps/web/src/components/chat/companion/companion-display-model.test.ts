import { describe, expect, it } from 'vitest';
import {
  deriveCompanionFocusTags,
  deriveCompanionReaction,
  deriveCompanionStatus,
  type CompanionActivitySnapshot,
} from './companion-display-model.js';

function makeSnapshot(
  overrides: Partial<CompanionActivitySnapshot> = {},
): CompanionActivitySnapshot {
  return {
    attachedCount: 0,
    currentUserEmail: 'tester@example.com',
    hasStreamError: false,
    idleSeconds: 0,
    input: '',
    lastToolName: null,
    pendingPermissionCount: 0,
    queuedCount: 0,
    rightOpen: false,
    sessionBusyState: null,
    sessionId: 'session-1',
    showVoice: false,
    streamErrorMessage: null,
    streaming: false,
    todoCount: 0,
    toolCallCount: 0,
    ...overrides,
  };
}

describe('companion-display-model · 联动反应推导', () => {
  it('Given 工具正在调用 When 推导反应 Then 优先展示工具执行状态', () => {
    const snapshot = makeSnapshot({
      lastToolName: 'read_file',
      streaming: true,
      toolCallCount: 2,
    });

    const reaction = deriveCompanionReaction(snapshot);

    expect(reaction).toMatchObject({
      badge: '工具执行中',
      importance: 'active',
    });
    expect(reaction.text).toContain('read_file');
    expect(deriveCompanionStatus(snapshot)).toBe('跟随工具执行');
    expect(deriveCompanionFocusTags(snapshot)).toContain('工具');
  });

  it('Given 流式错误 When 推导反应 Then 优先展示错误恢复鼓励', () => {
    const snapshot = makeSnapshot({
      hasStreamError: true,
      streamErrorMessage: '上游模型服务暂时不可用，请稍后重试。',
      toolCallCount: 1,
    });

    const reaction = deriveCompanionReaction(snapshot);

    expect(reaction).toMatchObject({
      badge: '错误恢复',
      importance: 'notice',
    });
    expect(reaction.text).toContain('上游模型服务暂时不可用');
    expect(deriveCompanionStatus(snapshot)).toBe('等待错误恢复');
    expect(deriveCompanionFocusTags(snapshot)).toContain('错误');
  });

  it('Given 用户长时间空闲 When 推导反应 Then 返回低打扰提醒', () => {
    const snapshot = makeSnapshot({ idleSeconds: 240 });

    const reaction = deriveCompanionReaction(snapshot);

    expect(reaction).toMatchObject({
      badge: '空闲提醒',
      importance: 'ambient',
    });
    expect(reaction.text).toContain('4 分钟');
    expect(deriveCompanionStatus(snapshot)).toBe('等待下一步输入');
    expect(deriveCompanionFocusTags(snapshot)).toContain('空闲');
  });
});
