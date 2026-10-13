import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAllDiscoveredContextWindows,
  recordDiscoveredContextWindow,
  resolveEffectiveContextWindow,
} from '../../compaction/context-window-resolver.js';
import {
  hasReachedAutoCompactionThreshold,
  isCompactionThresholdReached,
  normalizeCompactionUsage,
  parsePercentageOverride,
  parsePositiveOverride,
  resolveCompactionThreshold,
  type CompactionTokenUsage,
} from '../../compaction/compaction-parity-contract.js';

afterEach(() => {
  clearAllDiscoveredContextWindows();
});

describe('auto compaction parity contract baseline', () => {
  it('keeps the lower runtime-discovered context window', () => {
    // Given
    recordDiscoveredContextWindow('user-1', 'model-1', 100_000, 128_000);

    // When
    const contextWindow = resolveEffectiveContextWindow('user-1', 'model-1', 128_000);

    // Then
    expect(contextWindow).toBe(100_000);
  });

  it('resolves the user override as the effective window when the preset is missing', () => {
    // Given / When
    const contextWindow = resolveEffectiveContextWindow(
      'user-relay',
      'relay-model',
      undefined,
      272_000,
    );

    // Then
    expect(contextWindow).toBe(272_000);
  });

  it('lets the runtime-discovered limit tighten the override when the preset is missing', () => {
    // Given
    recordDiscoveredContextWindow('user-relay-2', 'relay-model', 100_000, undefined);

    // When
    const contextWindow = resolveEffectiveContextWindow(
      'user-relay-2',
      'relay-model',
      undefined,
      400_000,
    );

    // Then
    expect(contextWindow).toBe(100_000);
  });

  it('counts the normalized cache breakdown once when checking the threshold', () => {
    // Given
    const usage = {
      inputTokens: 60_000,
      outputTokens: 5_000,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 5_000,
    };

    // When
    const normalized = normalizeCompactionUsage(usage);

    // Then
    expect(normalized).toEqual({
      inputTokens: 85_000,
      outputTokens: 5_000,
      totalTokens: 90_000,
    });
  });
});

describe('auto compaction reference threshold', () => {
  it('让 V2 stream gate 在 108K 进入 overflow recovery，而 107,999 保持当前 round', () => {
    // Given
    const input = {
      modelContextWindow: 128_000,
      modelMaxOutputTokens: 32_000,
    };

    // When
    const belowThreshold = isCompactionThresholdReached({ inputTokens: 107_999 }, input);
    const atThreshold = isCompactionThresholdReached({ inputTokens: 108_000 }, input);

    // Then
    expect(belowThreshold).toBe(false);
    expect(atThreshold).toBe(true);
  });

  it('V2 stream gate 不让 legacy reserved 设置改写 108K 阈值', () => {
    // Given
    const usage = { inputTokens: 108_000 };

    // When
    const reached = isCompactionThresholdReached(usage, {
      modelContextWindow: 128_000,
      modelMaxOutputTokens: 32_000,
    });

    // Then
    expect(reached).toBe(true);
  });

  it('triggers at exactly 108K for a 128K context with the 20K buffer cap', () => {
    // Given
    const threshold = resolveCompactionThreshold({
      modelContextWindow: 128_000,
      modelMaxOutputTokens: 32_000,
    });
    const belowThreshold = { inputTokens: 107_999 };
    const atThreshold = { inputTokens: 108_000 };

    // When
    const belowTriggers = hasReachedAutoCompactionThreshold(belowThreshold, threshold);
    const atThresholdTriggers = hasReachedAutoCompactionThreshold(atThreshold, threshold);

    // Then
    expect(threshold).toEqual({
      contextWindow: 128_000,
      effectiveContextWindow: 108_000,
      autoCompactThreshold: 108_000,
    });
    expect(belowTriggers).toBe(false);
    expect(atThresholdTriggers).toBe(true);
  });

  it('honors model threshold ratio and context window override', () => {
    const threshold = resolveCompactionThreshold({
      modelContextWindow: 1_000_000,
      contextWindowOverride: 400_000,
      modelMaxOutputTokens: 20_000,
      autoCompactThresholdRatio: 0.8,
    });
    expect(threshold.contextWindow).toBe(400_000);
    expect(threshold.autoCompactThreshold).toBe(304_000);
  });

  it('uses the user override as the base window when the model preset is unknown', () => {
    // Given：从上游 /models 拉取、本地无同名元数据的模型没有 contextWindow 预设，
    // 此时用户挡位（如 272K/400K/1M）必须直接生效，而不是被 128K 兜底值压回。
    // When
    const threshold = resolveCompactionThreshold({
      contextWindowOverride: 272_000,
      modelMaxOutputTokens: 32_000,
    });

    // Then
    expect(threshold).toEqual({
      contextWindow: 272_000,
      effectiveContextWindow: 252_000,
      autoCompactThreshold: 252_000,
    });
  });

  it('still lets a runtime-discovered limit tighten the override when the preset is unknown', () => {
    // Given / When
    const threshold = resolveCompactionThreshold({
      contextWindowOverride: 400_000,
      discoveredContextWindow: 150_000,
      modelMaxOutputTokens: 32_000,
    });

    // Then
    expect(threshold.contextWindow).toBe(150_000);
  });

  it('does not let the legacy reserved setting rewrite the automatic threshold', () => {
    // Given
    const input = {
      modelContextWindow: 128_000,
      modelMaxOutputTokens: 32_000,
      reservedTokens: 50_000,
    };

    // When
    const threshold = resolveCompactionThreshold(input);

    // Then
    expect(threshold.autoCompactThreshold).toBe(108_000);
  });

  it('user contextWindowOverride replaces the model preset; runtime discovery can still tighten it', () => {
    // Given：挡位是权威值——配置后直接作为有效窗口（可高于模型预设，
    // 预设只是 models.dev / 内置目录的估计）；运行时发现的真实上游
    // 限制仍然只能向下收紧。
    const raiseOverride = {
      modelContextWindow: 128_000,
      discoveredContextWindow: 256_000,
      contextWindowOverride: 200_000,
      modelMaxOutputTokens: 32_000,
      autoCompactPercentOverride: 99,
    };
    const lowerOverride = {
      modelContextWindow: 200_000,
      discoveredContextWindow: 150_000,
      contextWindowOverride: 160_000,
      modelMaxOutputTokens: 32_000,
      autoCompactPercentOverride: 80,
    };

    // When
    const raised = resolveCompactionThreshold(raiseOverride);
    const lowered = resolveCompactionThreshold(lowerOverride);

    // Then
    expect(raised).toEqual({
      contextWindow: 200_000,
      effectiveContextWindow: 180_000,
      autoCompactThreshold: 178_200,
    });
    expect(lowered).toEqual({
      contextWindow: 150_000,
      effectiveContextWindow: 130_000,
      autoCompactThreshold: 104_000,
    });
  });

  it('falls back safely when windows and overrides are missing or malformed', () => {
    // Given
    const input = {
      modelContextWindow: Number.NaN,
      discoveredContextWindow: -1,
      contextWindowOverride: 0,
      modelMaxOutputTokens: Number.POSITIVE_INFINITY,
      autoCompactPercentOverride: 101,
    };

    // When
    const threshold = resolveCompactionThreshold(input);

    // Then
    expect(threshold).toEqual({
      contextWindow: 128_000,
      effectiveContextWindow: 108_000,
      autoCompactThreshold: 108_000,
    });
    expect(parsePositiveOverride('invalid')).toBeUndefined();
    expect(parsePercentageOverride('-10')).toBeUndefined();
  });
});

describe('provider usage normalization parity', () => {
  it.each([
    [
      'anthropic',
      {
        inputTokens: 98_000,
        outputTokens: 10_000,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 5_000,
        cacheTokensAreSeparate: false,
      },
    ],
    [
      'openai',
      {
        inputTokens: 73_000,
        outputTokens: 10_000,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 5_000,
      },
    ],
    ['gemini', { inputTokens: 73_000, outputTokens: 10_000, cacheReadTokens: 25_000 }],
    [
      'bedrock',
      {
        inputTokens: 98_000,
        outputTokens: 10_000,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 5_000,
        cacheTokensAreSeparate: false,
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, CompactionTokenUsage]>)(
    'normalizes %s usage to the same threshold decision',
    (_provider, usage) => {
      // Given
      const threshold = resolveCompactionThreshold({
        modelContextWindow: 128_000,
        modelMaxOutputTokens: 32_000,
      });

      // When
      const normalized = normalizeCompactionUsage(usage);

      // Then
      expect(normalized.totalTokens).toBe(108_000);
      expect(hasReachedAutoCompactionThreshold(usage, threshold)).toBe(true);
    },
  );

  it('treats absent cache fields as zero without fabricating usage', () => {
    // Given
    const usage = { inputTokens: 94_999 };

    // When
    const normalized = normalizeCompactionUsage(usage);

    // Then
    expect(normalized).toEqual({
      inputTokens: 94_999,
      outputTokens: 0,
      totalTokens: 94_999,
    });
  });
});
