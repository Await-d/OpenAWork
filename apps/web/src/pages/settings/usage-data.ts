import type { ModelPriceEntry } from '@openAwork/shared-ui';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function inferProviderLabel(modelId: string): string {
  const normalizedId = modelId.toLowerCase();

  if (normalizedId.startsWith('claude')) {
    return 'Anthropic';
  }
  if (
    normalizedId.startsWith('gpt') ||
    normalizedId.startsWith('o1') ||
    normalizedId.startsWith('o3') ||
    normalizedId.startsWith('o4')
  ) {
    return 'OpenAI';
  }
  if (normalizedId.startsWith('deepseek')) {
    return 'DeepSeek';
  }
  if (normalizedId.startsWith('qwen')) {
    return 'Qwen';
  }
  if (normalizedId.startsWith('gemini')) {
    return 'Google';
  }
  if (normalizedId.startsWith('moonshot') || normalizedId.startsWith('kimi')) {
    return 'Moonshot';
  }
  if (normalizedId.startsWith('grok')) {
    return 'xAI';
  }
  if (normalizedId.startsWith('llama')) {
    return 'Meta';
  }
  if (normalizedId.startsWith('mistral')) {
    return 'Mistral';
  }

  return 'Custom';
}

export function normalizeSettingsModelPrices(value: unknown): ModelPriceEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const id = readNonEmptyString(entry, 'id') ?? readNonEmptyString(entry, 'modelName');
    if (!id) {
      return [];
    }

    const displayName =
      readNonEmptyString(entry, 'displayName') ?? readNonEmptyString(entry, 'modelName') ?? id;
    const provider = readNonEmptyString(entry, 'provider') ?? inferProviderLabel(id);

    return [
      {
        id,
        displayName,
        provider,
        inputPricePerMillion:
          readFiniteNumber(entry, 'inputPricePerMillion') ??
          readFiniteNumber(entry, 'inputPer1m') ??
          0,
        outputPricePerMillion:
          readFiniteNumber(entry, 'outputPricePerMillion') ??
          readFiniteNumber(entry, 'outputPer1m') ??
          0,
      },
    ];
  });
}
