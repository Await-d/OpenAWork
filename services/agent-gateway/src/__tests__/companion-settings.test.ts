import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  sqliteGet: vi.fn(),
}));

import {
  buildCompanionPrompt,
  createCompanionProfile,
  DEFAULT_COMPANION_PREFERENCES,
  resolveCompanionProfileForAgent,
  type CompanionSettingsRecord,
} from '../companion-settings.js';

function createSettings(
  overrides: Partial<CompanionSettingsRecord['preferences']> = {},
): CompanionSettingsRecord {
  return {
    bindings: {},
    effectiveVoiceOutputMode: DEFAULT_COMPANION_PREFERENCES.voiceOutputMode,
    effectiveVoiceRate: DEFAULT_COMPANION_PREFERENCES.voiceRate,
    effectiveVoiceVariant: DEFAULT_COMPANION_PREFERENCES.voiceVariant,
    preferences: {
      ...DEFAULT_COMPANION_PREFERENCES,
      ...overrides,
    },
    profile: createCompanionProfile('buddy@example.com'),
  };
}

describe('companion settings helpers', () => {
  it('builds a deterministic profile for the same seed', () => {
    expect(createCompanionProfile('buddy@example.com')).toEqual(
      createCompanionProfile('buddy@example.com'),
    );
  });

  it('does not inject companion prompt when the feature is disabled', () => {
    expect(buildCompanionPrompt(createSettings({ enabled: false }), '/buddy 看一下')).toBeNull();
  });

  it('only injects in mention-only mode when /buddy is present', () => {
    expect(buildCompanionPrompt(createSettings(), '普通消息')).toBeNull();
    expect(buildCompanionPrompt(createSettings(), '/buddy 看一下这轮输出')).toContain(
      'OpenAWork companion 上下文：',
    );
  });

  it('injects without /buddy in always mode', () => {
    expect(
      buildCompanionPrompt(createSettings({ injectionMode: 'always' }), '继续这个任务'),
    ).toContain('常驻注入模式');
  });

  it('resolves an agent-bound companion profile with binding overrides', () => {
    const profile = resolveCompanionProfileForAgent({
      agentId: 'hephaestus',
      bindings: {
        hephaestus: {
          behaviorTone: 'focused',
          displayName: 'Heph 小锤',
          injectionMode: 'always',
          species: 'robot',
          themeVariant: 'playful',
          verbosity: 'minimal',
        },
      },
      preferences: DEFAULT_COMPANION_PREFERENCES,
      userEmail: 'buddy@example.com',
    });

    expect(profile.name).toBe('Heph 小锤');
    expect(profile.sprite.species).toBe('robot');
  });

  it('uses the same fallback persona for unbound agents', () => {
    const first = resolveCompanionProfileForAgent({
      agentId: 'hephaestus',
      bindings: {},
      preferences: DEFAULT_COMPANION_PREFERENCES,
      userEmail: 'buddy@example.com',
    });
    const second = resolveCompanionProfileForAgent({
      agentId: 'oracle',
      bindings: {},
      preferences: DEFAULT_COMPANION_PREFERENCES,
      userEmail: 'buddy@example.com',
    });

    expect(first).toEqual(second);
  });

  it('uses binding-level injection and verbosity overrides when building prompt', () => {
    const settings = createSettings();
    settings.activeBinding = {
      behaviorTone: 'supportive',
      displayName: 'Heph 小锤',
      injectionMode: 'always',
      species: 'robot',
      verbosity: 'minimal',
    };
    settings.profile = createCompanionProfile('buddy@example.com:hephaestus', 'playful', {
      behaviorTone: 'supportive',
      displayName: 'Heph 小锤',
      species: 'robot',
    });

    const prompt = buildCompanionPrompt(settings, '继续这个任务');
    expect(prompt).toContain('常驻注入模式');
    expect(prompt).toContain('保持极短、低打扰');
    expect(prompt).toContain('行为语气：更关注稳定情绪和节奏托底');
  });
});
