import { describe, expect, it } from 'vitest';
import type { ExtractedMemoryCandidate, MemoryCandidatePersistencePolicy } from './types.js';
import { evaluateMemoryCandidateForPersistence } from './persistence-policy.js';

const POLICY: MemoryCandidatePersistencePolicy = {
  autoWriteMinConfidence: 0.65,
  reviewLowConfidence: true,
};

function candidate(overrides: Partial<ExtractedMemoryCandidate>): ExtractedMemoryCandidate {
  return {
    type: 'preference',
    key: 'style.language',
    value: '以后回复默认使用中文。',
    confidence: 0.9,
    ...overrides,
  };
}

describe('evaluateMemoryCandidateForPersistence', () => {
  it('高置信且长期有效的候选会允许自动写入', () => {
    const result = evaluateMemoryCandidateForPersistence(candidate({}), POLICY);

    expect(result.status).toBe('persist');
    expect(result.reason).toBe('eligible');
  });

  it('低于自动写入阈值的候选会进入人工审阅', () => {
    const result = evaluateMemoryCandidateForPersistence(candidate({ confidence: 0.6 }), POLICY);

    expect(result.status).toBe('review');
    expect(result.reason).toBe('low_confidence');
  });

  it('一次性会话上下文不会直接写入长期记忆', () => {
    const result = evaluateMemoryCandidateForPersistence(
      candidate({ key: 'debug.current_error', value: '这次报错是 SQLITE_BUSY。' }),
      POLICY,
    );

    expect(result.status).toBe('review');
    expect(result.reason).toBe('transient_context');
  });

  it('疑似密钥或敏感信息会被拒绝', () => {
    const result = evaluateMemoryCandidateForPersistence(
      candidate({ key: 'secret', value: 'api_key = sk-abcdefghijklmnopqrstuvwxyz123456' }),
      POLICY,
    );

    expect(result.status).toBe('reject');
    expect(result.reason).toBe('sensitive_information');
  });
});
