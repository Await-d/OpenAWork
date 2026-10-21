import { describe, expect, it } from 'vitest';
import {
  COMPANION_LONG_INPUT_THRESHOLD_CHARS,
  deriveCompanionFocusTags,
  deriveCompanionInputFlags,
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
    inputHasMention: false,
    inputIsLong: false,
    inputMentionsBuddy: false,
    inputStartsWithSlash: false,
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

describe('deriveCompanionInputFlags · 输入派生标志', () => {
  // 这 4 个布尔量是 Buddy 树能跳过逐键重渲染的全部依据：它们之外，输入框原文
  // 一律不进 snapshot。口径必须与 `deriveCompanionStatus` 的分类保持一致。
  it('普通文本不触发任何标志', () => {
    expect(deriveCompanionInputFlags('帮我看下这个 bug')).toEqual({
      inputHasMention: false,
      inputIsLong: false,
      inputMentionsBuddy: false,
      inputStartsWithSlash: false,
    });
  });

  it('识别 /buddy 点名', () => {
    expect(deriveCompanionInputFlags('/buddy 你在吗').inputMentionsBuddy).toBe(true);
  });

  it('仅以 / 开头才算命令模式，中段出现不算', () => {
    expect(deriveCompanionInputFlags('/compact').inputStartsWithSlash).toBe(true);
    // 前导空白仍算「以 / 开头」，与旧实现 trim().startsWith('/') 一致。
    expect(deriveCompanionInputFlags('  /compact').inputStartsWithSlash).toBe(true);
    expect(deriveCompanionInputFlags('跑一下 npm run / watch').inputStartsWithSlash).toBe(false);
  });

  it('识别 @ 文件引用', () => {
    expect(deriveCompanionInputFlags('看下 @src/index.ts').inputHasMention).toBe(true);
  });

  it('长输入按 trim 后长度判定，边界为严格大于', () => {
    const atThreshold = 'x'.repeat(COMPANION_LONG_INPUT_THRESHOLD_CHARS);
    expect(deriveCompanionInputFlags(atThreshold).inputIsLong).toBe(false);
    expect(deriveCompanionInputFlags(` ${atThreshold} `).inputIsLong).toBe(false);
    expect(deriveCompanionInputFlags(`${atThreshold}y`).inputIsLong).toBe(true);
  });
});

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
