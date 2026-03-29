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

export const calculateTokenCost = (
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillion?: number,
  outputPricePerMillion?: number,
): number => {
  const safeInputTokens = Math.max(0, inputTokens);
  const safeOutputTokens = Math.max(0, outputTokens);
  const inPrice = inputPricePerMillion ?? 0;
  const outPrice = outputPricePerMillion ?? 0;

  const totalUsd = (safeInputTokens * inPrice + safeOutputTokens * outPrice) / 1_000_000;
  return Number(totalUsd.toFixed(8));
};
