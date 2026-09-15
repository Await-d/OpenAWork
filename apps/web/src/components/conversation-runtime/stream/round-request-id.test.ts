import { describe, expect, it } from 'vitest';
import { createRoundAssistantRequestId } from './round-request-id.js';

describe('createRoundAssistantRequestId', () => {
  it('按网关的中间轮次格式拼接请求 ID 与轮次序号', () => {
    expect(createRoundAssistantRequestId('req-1', 2)).toBe('req-1:assistant:2');
  });

  it('轮次序号为 1 时同样保留后缀', () => {
    expect(createRoundAssistantRequestId('req-1', 1)).toBe('req-1:assistant:1');
  });
});
