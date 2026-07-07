import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPANION_PREFERENCES,
  buildCompanionPrompt,
  createCompanionProfile,
  type CompanionSettingsRecord,
} from '../workspace/companion-settings.js';

function makeSettings(): CompanionSettingsRecord {
  return {
    bindings: {},
    effectiveVoiceOutputMode: DEFAULT_COMPANION_PREFERENCES.voiceOutputMode,
    effectiveVoiceRate: DEFAULT_COMPANION_PREFERENCES.voiceRate,
    effectiveVoiceVariant: DEFAULT_COMPANION_PREFERENCES.voiceVariant,
    preferences: {
      ...DEFAULT_COMPANION_PREFERENCES,
      injectionMode: 'always',
    },
    profile: createCompanionProfile('tester@example.com'),
  };
}

describe('buildCompanionPrompt · 工作台上下文', () => {
  it('Given 工具与错误上下文 When 构建 prompt Then companion 能感知当前联动状态', () => {
    const prompt = buildCompanionPrompt(makeSettings(), '帮我继续', {
      attachedCount: 2,
      hasStreamError: true,
      idleSeconds: 185,
      lastToolName: 'read_file',
      pendingApprovals: 1,
      queuedCount: 3,
      streamErrorMessage: '上游模型服务暂时不可用，请稍后重试。',
      toolCallCount: 2,
    });

    expect(prompt).toContain('工具调用：2 个工具正在联动，最近工具 read_file');
    expect(prompt).toContain('错误状态：上游模型服务暂时不可用，请稍后重试。');
    expect(prompt).toContain('附件与队列：2 个附件，3 条待发消息');
    expect(prompt).toContain('用户已空闲约 3 分钟');
  });
});
