import { describe, expect, it } from 'vitest';
import {
  createSessionMetadataSnapshot,
  estimateModelUsageCost,
  resolveModelPriceEntry,
} from './chat-page-utils.js';

describe('estimateModelUsageCost', () => {
  it('按普通输入、输出和缓存读写单价估算聊天费用', () => {
    expect(
      estimateModelUsageCost({
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 2_000,
        price: {
          modelName: 'model',
          inputPer1m: 3,
          outputPer1m: 15,
          cacheReadPer1m: 0.3,
          cacheWritePer1m: 3.75,
        },
      }),
    ).toBeCloseTo(0.0192, 8);
  });

  it('缓存单价缺失时回退普通输入单价', () => {
    expect(
      estimateModelUsageCost({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 2_000,
        price: { modelName: 'model', inputPer1m: 3, outputPer1m: 15 },
      }),
    ).toBeCloseTo(0.006, 8);
  });

  it('优先按 providerId 与 modelId 组合匹配重复模型名', () => {
    const matched = resolveModelPriceEntry(
      [
        { providerId: 'openai', modelName: 'shared-model', inputPer1m: 1, outputPer1m: 2 },
        { providerId: 'anthropic', modelName: 'shared-model', inputPer1m: 3, outputPer1m: 4 },
      ],
      ['anthropic/shared-model', 'shared-model'],
    );
    expect(matched?.providerId).toBe('anthropic');
  });

  it('异常 token 或价格不会产生负数、NaN 或 Infinity', () => {
    expect(
      estimateModelUsageCost({
        inputTokens: -1,
        outputTokens: Number.POSITIVE_INFINITY,
        cacheReadTokens: Number.NaN,
        cacheWriteTokens: 1_000_000_001,
        price: {
          modelName: 'model',
          inputPer1m: -3,
          outputPer1m: Number.NaN,
          cacheReadPer1m: Number.POSITIVE_INFINITY,
          cacheWritePer1m: 2,
        },
      }),
    ).toBe(0);
  });
});

/**
 * 回归：审批方式档位必须进入 session metadata 快照。
 *
 * 旧实现只记录布尔 `yoloMode`，于是 `ask → auto-edit` 会得到完全相同的快照，
 * ChatPage 的 dirty-metadata 副作用短路后中档切换永远不会 PATCH 到服务端。
 */
type ParsedSnapshot = {
  dialogueMode: string | null;
  permissionMode: string;
  yoloMode: boolean;
};

function parseSnapshot(snapshot: string): ParsedSnapshot {
  return JSON.parse(snapshot) as ParsedSnapshot;
}

describe('createSessionMetadataSnapshot — 审批方式档位', () => {
  it('ask 与 auto-edit 产生不同快照', () => {
    const base = { dialogueMode: 'coding' as const };

    const askSnapshot = createSessionMetadataSnapshot({
      ...base,
      permissionMode: 'ask',
      yoloMode: false,
    });
    const autoEditSnapshot = createSessionMetadataSnapshot({
      ...base,
      permissionMode: 'auto-edit',
      yoloMode: false,
    });

    expect(askSnapshot).not.toBe(autoEditSnapshot);
    expect(parseSnapshot(askSnapshot)).toMatchObject({ permissionMode: 'ask', yoloMode: false });
    expect(parseSnapshot(autoEditSnapshot)).toMatchObject({
      permissionMode: 'auto-edit',
      yoloMode: false,
    });
  });

  it('auto-edit 与 yolo 产生不同快照，且布尔投影与档位一致', () => {
    const autoEditSnapshot = createSessionMetadataSnapshot({
      permissionMode: 'auto-edit',
      yoloMode: false,
    });
    const yoloSnapshot = createSessionMetadataSnapshot({ permissionMode: 'yolo', yoloMode: true });

    expect(autoEditSnapshot).not.toBe(yoloSnapshot);
    expect(parseSnapshot(yoloSnapshot)).toMatchObject({ permissionMode: 'yolo', yoloMode: true });
  });

  it('缺少 permissionMode 时按 legacy yoloMode 布尔回退（老数据兼容）', () => {
    const legacyYolo = createSessionMetadataSnapshot({ yoloMode: true });
    const legacyAsk = createSessionMetadataSnapshot({ yoloMode: false });

    expect(parseSnapshot(legacyYolo)).toMatchObject({ permissionMode: 'yolo', yoloMode: true });
    expect(parseSnapshot(legacyAsk)).toMatchObject({ permissionMode: 'ask', yoloMode: false });
    expect(legacyYolo).not.toBe(legacyAsk);
  });

  it('相同档位与设置下快照稳定，不产生误报 dirty', () => {
    const first = createSessionMetadataSnapshot({
      dialogueMode: 'coding',
      permissionMode: 'auto-edit',
      yoloMode: false,
    });
    const second = createSessionMetadataSnapshot({
      dialogueMode: 'coding',
      permissionMode: 'auto-edit',
      yoloMode: false,
    });

    expect(first).toBe(second);
  });
});
