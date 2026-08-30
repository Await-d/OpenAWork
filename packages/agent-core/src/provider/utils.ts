import type { AIModelConfig, RequestOverrides } from './types.js';

export const normalizeProviderBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  return withScheme.replace(/\/+$/, '');
};

export const mergeBuiltinModels = (
  builtinModels: AIModelConfig[],
  userModels: AIModelConfig[],
): AIModelConfig[] => {
  const userModelMap = new Map(userModels.map((model) => [model.id, model]));
  const mergedBuiltin = builtinModels.map((builtin) => {
    const existing = userModelMap.get(builtin.id);
    if (!existing) {
      return { ...builtin };
    }

    return {
      ...builtin,
      ...existing,
      enabled: existing.enabled,
    };
  });

  const customUserModels = userModels
    .filter((model) => !builtinModels.some((builtin) => builtin.id === model.id))
    .map((model) => ({ ...model }));

  return [...mergedBuiltin, ...customUserModels];
};

const mergeStringArray = (left?: string[], right?: string[]): string[] | undefined => {
  if (!left && !right) {
    return undefined;
  }

  const merged = [...(left ?? []), ...(right ?? [])];
  return Array.from(new Set(merged));
};

const isGpt5Family = (modelId: string): boolean => /^gpt-5([-.]|$)/i.test(modelId);

export const buildRequestOverrides = (
  providerOverrides?: RequestOverrides,
  modelOverrides?: RequestOverrides,
  modelId?: string,
): RequestOverrides => {
  const merged: RequestOverrides = {
    ...(providerOverrides ?? {}),
    ...(modelOverrides ?? {}),
  };

  merged.headers = {
    ...(providerOverrides?.headers ?? {}),
    ...(modelOverrides?.headers ?? {}),
  };

  merged.body = {
    ...(providerOverrides?.body ?? {}),
    ...(modelOverrides?.body ?? {}),
  };

  merged.omitBodyKeys = mergeStringArray(
    providerOverrides?.omitBodyKeys,
    modelOverrides?.omitBodyKeys,
  );

  if (modelId && isGpt5Family(modelId)) {
    merged.omitBodyKeys = mergeStringArray(merged.omitBodyKeys, ['temperature']);
  }

  if (Object.keys(merged.headers).length === 0) {
    delete merged.headers;
  }

  if (Object.keys(merged.body).length === 0) {
    delete merged.body;
  }

  return merged;
};

export type TokenUsageCostInput = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly inputPricePerMillion?: number;
  readonly outputPricePerMillion?: number;
  readonly cacheReadPricePerMillion?: number;
  readonly cacheWritePricePerMillion?: number;
};

export const MAX_USAGE_TOKENS = 1_000_000_000;
export const MAX_PRICE_PER_MILLION = 1_000_000;

export const normalizeTokenCount = (value: number | undefined): number => {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_USAGE_TOKENS
    ? value
    : 0;
};

export const normalizeOptionalTokenPrice = (value: number | undefined): number | undefined => {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_PRICE_PER_MILLION
    ? value
    : undefined;
};

function normalizePrice(value: number | undefined, fallback = 0): number {
  return normalizeOptionalTokenPrice(value) ?? fallback;
}

export const calculateTokenUsageCost = (input: TokenUsageCostInput): number => {
  const inputPrice = normalizePrice(input.inputPricePerMillion);
  const cacheReadPrice = normalizePrice(input.cacheReadPricePerMillion, inputPrice);
  const cacheWritePrice = normalizePrice(input.cacheWritePricePerMillion, inputPrice);
  const totalUsd =
    (normalizeTokenCount(input.inputTokens) * inputPrice +
      normalizeTokenCount(input.outputTokens) * normalizePrice(input.outputPricePerMillion) +
      normalizeTokenCount(input.cacheReadTokens) * cacheReadPrice +
      normalizeTokenCount(input.cacheWriteTokens) * cacheWritePrice) /
    1_000_000;
  return Number.isFinite(totalUsd) ? totalUsd : 0;
};

export const calculateTokenCost = (
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillion?: number,
  outputPricePerMillion?: number,
): number => {
  return calculateTokenUsageCost({
    inputTokens,
    outputTokens,
    inputPricePerMillion,
    outputPricePerMillion,
  });
};
