/**
 * 传输层失败的可重试口径（对齐上游 packages/ai 的 delivery / recovery 语义）
 *
 * 判据是「上游有没有投递」，不是「是不是网络错」：
 * 连接/响应头阶段（operation='request'）才可重试；读阶段（流已吐一半）、写阶段、
 * 以及阶段未知（websocket 失败、httpStreamError 的流读取失败）一律不重试。
 */

import { describe, it, expect } from 'vitest';
import { LLMError, TransportReason } from '../index.js';

const reason = (operation?: 'request' | 'read' | 'write') =>
  new TransportReason({ message: 'transport failed', operation });

describe('TransportReason.retryable', () => {
  it('连接/响应头阶段失败可重试（上游一个字节都没吐出）', () => {
    expect(reason('request').retryable).toBe(true);
  });

  it('读阶段失败不可重试（流可能已吐了一半，重放会产生重复输出）', () => {
    expect(reason('read').retryable).toBe(false);
  });

  it('写阶段失败不可重试', () => {
    expect(reason('write').retryable).toBe(false);
  });

  it('阶段未知时按「可能已投递」处理，不重试', () => {
    // websocket.ts 的收发失败与 httpStreamError 的流读取失败都不带 operation。
    expect(reason(undefined).retryable).toBe(false);
  });

  it('经 LLMError 外层透传（重试循环读的就是这一层）', () => {
    const error = new LLMError({
      module: 'RequestExecutor',
      method: 'execute',
      reason: reason('request'),
    });

    expect(error.retryable).toBe(true);
  });
});
