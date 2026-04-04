import type { ActiveSelectionRef, AIProviderRef } from '@openAwork/shared-ui';
import type {
  ReasoningEffortRef,
  ThinkingDefaultsRef,
  ThinkingModeRef,
} from '../settings-types.js';

export const TABS = [
  { id: 'connection', label: '连接与模型' },
  { id: 'channels', label: '消息频道' },
  { id: 'memory', label: '记忆管理' },
  { id: 'usage', label: '用量与账单' },
  { id: 'security', label: '安全与权限' },
  { id: 'workspace', label: '工作区' },
  { id: 'devtools', label: '开发者工具' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export const SETTINGS_TAB_NAV_WIDTH = 192;
export const SETTINGS_TAB_CONTENT_GAP = 28;
export const SETTINGS_LAYOUT_SIDE_GUTTER = SETTINGS_TAB_NAV_WIDTH + SETTINGS_TAB_CONTENT_GAP;
export const SETTINGS_LAYOUT_MAX_WIDTH = `calc(var(--content-max-width) + ${SETTINGS_LAYOUT_SIDE_GUTTER * 2}px)`;

export const DEFAULT_THINKING_DEFAULTS: ThinkingDefaultsRef = {
  chat: { enabled: false, effort: 'medium' },
  fast: { enabled: false, effort: 'medium' },
};

export const BUILTIN_PROVIDER_TYPE_SET = new Set([
  'anthropic',
  'openai',
  'deepseek',
  'gemini',
  'ollama',
  'openrouter',
  'qwen',
  'moonshot',
  'custom',
]);

export function normalizeReasoningEffort(value: unknown): ReasoningEffortRef {
  return value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : 'medium';
}

export function normalizeThinkingMode(value: unknown): ThinkingModeRef {
  if (!value || typeof value !== 'object') {
    return { enabled: false, effort: 'medium' };
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: record['enabled'] === true,
    effort: normalizeReasoningEffort(record['effort']),
  };
}

export function normalizeThinkingDefaults(value: unknown): ThinkingDefaultsRef {
  if (!value || typeof value !== 'object') {
    return {
      chat: { ...DEFAULT_THINKING_DEFAULTS.chat },
      fast: { ...DEFAULT_THINKING_DEFAULTS.fast },
    };
  }

  const record = value as Record<string, unknown>;
  return {
    chat: normalizeThinkingMode(record['chat']),
    fast: normalizeThinkingMode(record['fast']),
  };
}

export function parseStructuredPayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch (_error) {
    return value;
  }
}

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
    if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
      return payload.message;
    }
  } catch (_error) {
    return fallback;
  }

  return fallback;
}

export function normalizeActiveSelectionProviders(
  selection: ActiveSelectionRef,
  providers: AIProviderRef[],
): ActiveSelectionRef {
  const enabledProviders = providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      ...provider,
      defaultModels: provider.defaultModels.filter((model) => model.enabled),
    }))
    .filter((provider) => provider.defaultModels.length > 0);

  const normalizeEntry = (entry: ActiveSelectionRef['chat']): ActiveSelectionRef['chat'] => {
    const provider =
      enabledProviders.find((item) => item.id === entry.providerId) ?? enabledProviders[0];

    if (!provider) {
      return entry;
    }

    const model =
      provider.defaultModels.find((item) => item.id === entry.modelId) ?? provider.defaultModels[0];

    return {
      providerId: provider.id,
      modelId: model?.id ?? entry.modelId,
    };
  };

  return {
    chat: normalizeEntry(selection.chat),
    fast: normalizeEntry(selection.fast),
  };
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = (
    window as Window & {
      __TAURI__?: {
        core: { invoke: (name: string, value?: Record<string, unknown>) => Promise<T> };
      };
    }
  ).__TAURI__;
  if (!tauri) {
    throw new Error('Not running in Tauri');
  }

  return tauri.core.invoke(cmd, args);
}

export const isTauri =
  typeof window !== 'undefined' && !!(window as Window & { __TAURI__?: unknown }).__TAURI__;
