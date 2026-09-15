/**
 * message-coercion 是任意 JSON / 流式事件进入展示模型前的边界层：
 * - `hasActivePendingPermissionRequest` 决定工具卡片是否显示「等待审批」，
 *   任何终止信号（isError / resumedAfterApproval / completed|failed|error）
 *   都必须立即让该状态失效；
 * - `estimateTokenCount` 是上下文占用估算的唯一来源；
 * - `normalizeProviderUsage` / `normalizeCreatedAt` 读的是未经校验的持久化
 *   数据，任何一种畸形输入都不能抛错。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateTokenCount,
  getComparableCreatedAt,
  hasActivePendingPermissionRequest,
  joinReasoningBlocks,
  normalizeCreatedAt,
  normalizeOptionalString,
  normalizeProviderUsage,
} from './message-coercion.js';

describe('hasActivePendingPermissionRequest', () => {
  it('pendingPermissionRequestId 非空且无终止信号时视为活跃', () => {
    expect(hasActivePendingPermissionRequest({ pendingPermissionRequestId: 'perm-1' })).toBe(true);
    expect(
      hasActivePendingPermissionRequest({
        pendingPermissionRequestId: 'perm-1',
        status: 'running',
      }),
    ).toBe(true);
  });

  it('空字符串 / 纯空白 / 缺省的 pendingPermissionRequestId 一律不活跃', () => {
    expect(hasActivePendingPermissionRequest({ pendingPermissionRequestId: '' })).toBe(false);
    expect(hasActivePendingPermissionRequest({ pendingPermissionRequestId: '   ' })).toBe(false);
    expect(hasActivePendingPermissionRequest({})).toBe(false);
  });

  it('isError 或 resumedAfterApproval 会立即判定为不活跃', () => {
    expect(
      hasActivePendingPermissionRequest({ pendingPermissionRequestId: 'perm-1', isError: true }),
    ).toBe(false);
    expect(
      hasActivePendingPermissionRequest({
        pendingPermissionRequestId: 'perm-1',
        resumedAfterApproval: true,
      }),
    ).toBe(false);
  });

  it.each(['completed', 'failed', 'error'])('终态 status=%s 不再活跃', (status) => {
    expect(
      hasActivePendingPermissionRequest({ pendingPermissionRequestId: 'perm-1', status }),
    ).toBe(false);
  });

  it('非终态 status（如 paused）仍保持活跃', () => {
    expect(
      hasActivePendingPermissionRequest({ pendingPermissionRequestId: 'perm-1', status: 'paused' }),
    ).toBe(true);
  });
});

describe('estimateTokenCount', () => {
  it('空串 / 纯空白返回 0', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('   \n\t')).toBe(0);
  });

  it('按 4 字符 ≈ 1 token 估算，且非空文本至少 1 token', () => {
    expect(estimateTokenCount('a')).toBe(1);
    expect(estimateTokenCount('abcd')).toBe(1);
    // 11 / 4 = 2.75 → 3
    expect(estimateTokenCount('hello world')).toBe(3);
  });

  it('CJK 与多字节字符按 UTF-16 长度计入', () => {
    expect(estimateTokenCount('你好世界')).toBe(1);
    // 6 / 4 = 1.5 → 2
    expect(estimateTokenCount('中文测试内容')).toBe(2);
    // 代理对占 2 个 UTF-16 单元
    expect(estimateTokenCount('😀')).toBe(1);
  });

  it('长文本线性放大且忽略首尾空白', () => {
    expect(estimateTokenCount('a'.repeat(400))).toBe(100);
    expect(estimateTokenCount(`  ${'a'.repeat(400)}  `)).toBe(100);
  });
});

describe('normalizeOptionalString', () => {
  it('非字符串与纯空白返回 undefined，其余 trim 后返回', () => {
    expect(normalizeOptionalString(undefined)).toBeUndefined();
    expect(normalizeOptionalString(42)).toBeUndefined();
    expect(normalizeOptionalString(['x'])).toBeUndefined();
    expect(normalizeOptionalString('   ')).toBeUndefined();
    expect(normalizeOptionalString('  x  ')).toBe('x');
  });
});

describe('normalizeProviderUsage', () => {
  it('非对象 / 数组 / 空值返回 undefined', () => {
    for (const value of [undefined, null, 'usage', 42, [], true]) {
      expect(normalizeProviderUsage(value)).toBeUndefined();
    }
  });

  it('三个必需计数字段缺一即返回 undefined', () => {
    expect(normalizeProviderUsage({ inputTokens: 1, outputTokens: 2 })).toBeUndefined();
    expect(normalizeProviderUsage({ inputTokens: 1, totalTokens: 3 })).toBeUndefined();
    expect(
      normalizeProviderUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 'x' }),
    ).toBeUndefined();
  });

  it('必需字段截断取整、负数钳到 0、非有限数视为缺失', () => {
    expect(normalizeProviderUsage({ inputTokens: -5, outputTokens: 3.7, totalTokens: 0 })).toEqual({
      inputTokens: 0,
      outputTokens: 3,
      totalTokens: 0,
    });
    expect(
      normalizeProviderUsage({ inputTokens: Number.NaN, outputTokens: 1, totalTokens: 2 }),
    ).toBeUndefined();
    expect(
      normalizeProviderUsage({
        inputTokens: Number.POSITIVE_INFINITY,
        outputTokens: 1,
        totalTokens: 2,
      }),
    ).toBeUndefined();
  });

  it('可选字段仅在合法数值时出现，未知字段被忽略', () => {
    expect(
      normalizeProviderUsage({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        reasoningTokens: 4.9,
        cacheReadTokens: -1,
        cacheWriteTokens: 'nope',
        surprise: true,
      }),
    ).toStrictEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      reasoningTokens: 4,
      cacheReadTokens: 0,
    });
  });
});

describe('normalizeCreatedAt', () => {
  const FIXED_NOW = 1_700_000_000_000;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('合法有限数字原样返回', () => {
    expect(normalizeCreatedAt(123)).toBe(123);
    expect(normalizeCreatedAt(0)).toBe(0);
  });

  it('可解析的字符串按 Date.parse 返回', () => {
    expect(normalizeCreatedAt('2024-01-02T03:04:05.000Z')).toBe(
      Date.parse('2024-01-02T03:04:05.000Z'),
    );
  });

  it('无效值与缺省值回退到 Date.now()', () => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    expect(normalizeCreatedAt(undefined)).toBe(FIXED_NOW);
    expect(normalizeCreatedAt('not-a-date')).toBe(FIXED_NOW);
    expect(normalizeCreatedAt(Number.NaN)).toBe(FIXED_NOW);
  });
});

describe('joinReasoningBlocks', () => {
  it('缺省 / 空数组返回空串', () => {
    expect(joinReasoningBlocks(undefined)).toBe('');
    expect(joinReasoningBlocks([])).toBe('');
  });

  it('多块用换行连接并整体 trim，纯空白块被抹平', () => {
    expect(joinReasoningBlocks([' first ', ' second '])).toBe('first \n second');
    expect(joinReasoningBlocks(['  ', '\n\t'])).toBe('');
    expect(joinReasoningBlocks(['a', '', 'b'])).toBe('a\n\nb');
  });
});

describe('getComparableCreatedAt', () => {
  it('数字与可解析字符串返回毫秒时间戳', () => {
    expect(getComparableCreatedAt(1_000)).toBe(1_000);
    expect(getComparableCreatedAt('2024-01-02T03:04:05.000Z')).toBe(
      Date.parse('2024-01-02T03:04:05.000Z'),
    );
  });

  it('缺省 / 非法值返回 null（与 normalizeCreatedAt 的 Date.now 回退不同）', () => {
    expect(getComparableCreatedAt(undefined)).toBeNull();
    expect(getComparableCreatedAt('not-a-date')).toBeNull();
    expect(getComparableCreatedAt(Number.NaN)).toBeNull();
  });
});
