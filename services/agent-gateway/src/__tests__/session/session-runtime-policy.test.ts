import { describe, expect, it } from 'vitest';
import {
  isChannelManagedSessionMetadata,
  isSourceManagedSessionMetadata,
  resolveInheritedDialogueMode,
  resolveSessionRuntimePolicy,
} from '../../session/session-runtime-policy.js';

describe('session runtime policy', () => {
  it('Given channel session metadata When resolving policy Then it matches the default chat runtime policy', () => {
    const metadata = {
      source: 'channel',
      channelLlmToolsEnabled: true,
      channel: {
        type: 'qq',
        tools: {
          read: true,
          mcp: true,
        },
      },
    };

    expect(isChannelManagedSessionMetadata(metadata)).toBe(true);
    expect(resolveSessionRuntimePolicy(metadata)).toEqual({
      includeCapabilityContext: true,
      includeLspGuidance: true,
      includePinnedSkillsPrompt: true,
      includeDynamicWorkspaceTools: true,
      includeFlatMcpToolDefinitions: true,
    });
  });

  it('Given normal desktop session metadata When resolving policy Then full workbench context remains enabled', () => {
    const metadata = {
      source: 'desktop',
      workingDirectory: '/workspace/demo',
    };

    expect(isChannelManagedSessionMetadata(metadata)).toBe(false);
    expect(resolveSessionRuntimePolicy(metadata)).toEqual({
      includeCapabilityContext: true,
      includeLspGuidance: true,
      includePinnedSkillsPrompt: true,
      includeDynamicWorkspaceTools: true,
      includeFlatMcpToolDefinitions: true,
    });
  });
});

describe('isSourceManagedSessionMetadata', () => {
  it('渠道与定时任务（均不写 dialogueMode）为来源托管，桌面端 / 无来源不是', () => {
    expect(isSourceManagedSessionMetadata({ source: 'channel' })).toBe(true);
    expect(isSourceManagedSessionMetadata({ source: 'cron' })).toBe(true);
    expect(isSourceManagedSessionMetadata({ source: 'desktop' })).toBe(false);
    expect(isSourceManagedSessionMetadata({ dialogueMode: 'coding' })).toBe(false);
    // 子代理 / 团队会话只带 parent 关系，不带 source：不得被误判为来源会话。
    expect(isSourceManagedSessionMetadata({ parentSessionId: 'p-1' })).toBe(false);
  });
});

/**
 * 子会话**不带** `source`，因此来源托管父会话的脏 `dialogueMode` 一旦被继承，子会话就会
 * 落进澄清只读白名单（渠道豁免按自身 `source` 判定）——工具面被收敛成只读。这里锁死继承侧。
 */
describe('resolveInheritedDialogueMode', () => {
  it('普通父会话的对话模式照常继承', () => {
    expect(resolveInheritedDialogueMode({ dialogueMode: 'programmer' })).toBe('programmer');
    expect(resolveInheritedDialogueMode({ dialogueMode: 'clarify' })).toBe('clarify');
  });

  it('来源托管父会话一律不继承（渠道 / 定时任务）', () => {
    expect(
      resolveInheritedDialogueMode({ source: 'channel', dialogueMode: 'clarify' }),
    ).toBeUndefined();
    expect(
      resolveInheritedDialogueMode({ source: 'cron', dialogueMode: 'programmer' }),
    ).toBeUndefined();
  });

  it('父会话未表达模式 / 非字符串脏值时同样不继承', () => {
    expect(resolveInheritedDialogueMode({})).toBeUndefined();
    expect(resolveInheritedDialogueMode({ dialogueMode: null })).toBeUndefined();
    expect(resolveInheritedDialogueMode({ dialogueMode: 42 })).toBeUndefined();
  });
});
