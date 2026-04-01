import { describe, expect, it } from 'vitest';
import {
  buildCompanionIntroText,
  createCompanionProfile,
  deriveCompanionReaction,
  type CompanionActivitySnapshot,
} from './companion-display-model.js';

function createSnapshot(
  overrides: Partial<CompanionActivitySnapshot> = {},
): CompanionActivitySnapshot {
  return {
    attachedCount: 0,
    currentUserEmail: 'buddy@example.com',
    input: '',
    pendingPermissionCount: 0,
    queuedCount: 0,
    rightOpen: false,
    sessionBusyState: null,
    sessionId: 'session-1',
    showVoice: false,
    streaming: false,
    todoCount: 0,
    ...overrides,
  };
}

describe('companion-display-model', () => {
  it('creates a stable companion profile for the same seed input', () => {
    const first = createCompanionProfile('buddy@example.com');
    const second = createCompanionProfile('buddy@example.com');

    expect(first).toEqual(second);
    expect(first.traits.length).toBeGreaterThan(0);
    expect(first.rarityStars).toBe(second.rarityStars);
    expect(first.sprite.species).toBe(second.sprite.species);
  });

  it('uses the highest-priority reaction when multiple signals are present', () => {
    const reaction = deriveCompanionReaction(
      createSnapshot({
        attachedCount: 2,
        input: '/buddy 看一下这轮输出',
        pendingPermissionCount: 1,
        queuedCount: 3,
        streaming: true,
      }),
    );

    expect(reaction.badge).toBe('跟随生成');
    expect(reaction.importance).toBe('active');
  });

  it('prefers queued-message guidance before direct buddy mention when not streaming', () => {
    const reaction = deriveCompanionReaction(
      createSnapshot({
        input: '/buddy 先看看下一条',
        queuedCount: 2,
      }),
    );

    expect(reaction.badge).toBe('待发队列');
    expect(reaction.text).toContain('2 条待发消息');
  });

  it('builds a reference-style intro line for session output', () => {
    const intro = buildCompanionIntroText({
      name: '雾灯',
      species: '雨燕',
    });

    expect(intro).toContain('雾灯');
    expect(intro).toContain('雨燕');
    expect(intro).toContain('主助手');
  });
});
