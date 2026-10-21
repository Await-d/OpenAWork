import { describe, expect, it } from 'vitest';
import {
  createRoundAssistantRequestId,
  resolveNextAssistantRoundIndex,
} from './round-request-id.js';

describe('createRoundAssistantRequestId', () => {
  it('按网关的中间轮次格式拼接请求 ID 与轮次序号', () => {
    expect(createRoundAssistantRequestId('req-1', 2)).toBe('req-1:assistant:2');
  });

  it('轮次序号为 1 时同样保留后缀', () => {
    expect(createRoundAssistantRequestId('req-1', 1)).toBe('req-1:assistant:1');
  });
});

describe('resolveNextAssistantRoundIndex', () => {
  const REQUEST = 'req-A';

  it('从已落库的历史反推下一轮，避免沿用偏小的旧快照轮次', () => {
    // 提问暂停：/recovery 的 runEvents 为空，快照仍是若干轮之前，fallback 只到 3；
    // 但历史里已经有 1..11 轮，网关续跑会用 12。
    expect(
      resolveNextAssistantRoundIndex({
        clientRequestId: REQUEST,
        fallbackRound: 3,
        messages: [
          { clientRequestId: `${REQUEST}:assistant:1` },
          { clientRequestId: `${REQUEST}:assistant:9` },
          { clientRequestId: `${REQUEST}:assistant:11` },
        ],
      }),
    ).toBe(12);
  });

  it('历史轮次落后于已推进的本地轮次时取较大者（不回退）', () => {
    expect(
      resolveNextAssistantRoundIndex({
        clientRequestId: REQUEST,
        fallbackRound: 8,
        messages: [{ clientRequestId: `${REQUEST}:assistant:2` }],
      }),
    ).toBe(8);
  });

  it('只认同一请求的中间轮，忽略最终轮与其它请求、缺失字段', () => {
    expect(
      resolveNextAssistantRoundIndex({
        clientRequestId: REQUEST,
        fallbackRound: 2,
        messages: [
          // 最终轮用的是裸请求 id，不带轮次后缀
          { clientRequestId: REQUEST },
          { clientRequestId: 'req-B:assistant:99' },
          { clientRequestId: undefined },
          {},
          { clientRequestId: `${REQUEST}:assistant:4` },
        ],
      }),
    ).toBe(5);
  });

  it('历史里没有可解析轮次时回落到 fallback，且下界为 1', () => {
    expect(
      resolveNextAssistantRoundIndex({
        clientRequestId: REQUEST,
        fallbackRound: 1,
        messages: [{ clientRequestId: REQUEST }],
      }),
    ).toBe(1);
    expect(
      resolveNextAssistantRoundIndex({
        clientRequestId: REQUEST,
        fallbackRound: 0,
        messages: [],
      }),
    ).toBe(1);
  });

  it('忽略非数字后缀，不会被 NaN 污染成回退', () => {
    expect(
      resolveNextAssistantRoundIndex({
        clientRequestId: REQUEST,
        fallbackRound: 5,
        messages: [
          { clientRequestId: `${REQUEST}:assistant:abc` },
          { clientRequestId: `${REQUEST}:assistant:3` },
        ],
      }),
    ).toBe(5);
  });
});
