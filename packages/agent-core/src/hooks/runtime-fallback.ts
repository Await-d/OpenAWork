export interface FallbackModelConfig {
  primaryModelId: string;
  fallbackModelIds: string[];
  cooldownMs: number;
  triggerStatusCodes: number[];
}

export interface ModelCooldownState {
  modelId: string;
  cooledDownAt: number;
  reason: string;
}

export interface RuntimeFallbackHook {
  onResponseError(statusCode: number, modelId: string): string | null;
  markCooldown(modelId: string, reason: string): void;
  isInCooldown(modelId: string): boolean;
  getAvailableModel(): string;
  clearExpiredCooldowns(): void;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_TRIGGER_STATUS_CODES = [429, 503] as const;

type RuntimeFallbackHookConfigInput = Partial<FallbackModelConfig> &
  Pick<FallbackModelConfig, 'primaryModelId'>;

export class RuntimeFallbackHookImpl implements RuntimeFallbackHook {
  private readonly config: FallbackModelConfig;
  private readonly cooldownByModel = new Map<string, ModelCooldownState>();

  constructor(config: RuntimeFallbackHookConfigInput) {
    this.config = {
      primaryModelId: config.primaryModelId,
      fallbackModelIds: config.fallbackModelIds ?? [],
      cooldownMs: config.cooldownMs ?? DEFAULT_COOLDOWN_MS,
      triggerStatusCodes: config.triggerStatusCodes ?? [...DEFAULT_TRIGGER_STATUS_CODES],
    };
  }

  onResponseError(statusCode: number, modelId: string): string | null {
    this.clearExpiredCooldowns();
    if (!this.config.triggerStatusCodes.includes(statusCode)) {
      return null;
    }

    this.markCooldown(modelId, `status_code_${statusCode}`);
    const nextModelId = this.getFirstAvailableModelId();

    if (!nextModelId || nextModelId === modelId) {
      return null;
    }

    return nextModelId;
  }

  markCooldown(modelId: string, reason: string): void {
    const cooledDownAt = Date.now() + this.config.cooldownMs;
    this.cooldownByModel.set(modelId, {
      modelId,
      cooledDownAt,
      reason,
    });
  }

  isInCooldown(modelId: string): boolean {
    this.clearExpiredCooldowns();
    return this.cooldownByModel.has(modelId);
  }

  getAvailableModel(): string {
    this.clearExpiredCooldowns();
    return this.getFirstAvailableModelId() ?? this.config.primaryModelId;
  }

  clearExpiredCooldowns(): void {
    const now = Date.now();
    for (const [modelId, state] of this.cooldownByModel.entries()) {
      if (state.cooledDownAt <= now) {
        this.cooldownByModel.delete(modelId);
      }
    }
  }

  private getFirstAvailableModelId(): string | null {
    for (const modelId of this.getPrioritizedModelIds()) {
      if (!this.cooldownByModel.has(modelId)) {
        return modelId;
      }
    }
    return null;
  }

  private getPrioritizedModelIds(): string[] {
    const deduplicatedModelIds = new Set<string>();
    const modelIds = [this.config.primaryModelId, ...this.config.fallbackModelIds];

    for (const modelId of modelIds) {
      deduplicatedModelIds.add(modelId);
    }

    return [...deduplicatedModelIds];
  }
}
