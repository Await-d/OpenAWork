import type { ReasoningEffort } from '../pages/chat-page/support.js';

export interface ChatSettingsModel {
  id: string;
  label: string;
  enabled: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  thinking?: { enabled: boolean; budgetTokens?: number; mode?: ReasoningEffort };
}

export interface ChatSettingsProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  defaultModels: ChatSettingsModel[];
}

export interface SavedChatDefaults {
  modelId: string;
  providerId: string;
  reasoningEffort: ReasoningEffort;
  thinkingEnabled: boolean;
  toolSurfaceProfile: 'openawork' | 'claude_code_default' | 'claude_code_simple';
}

interface SettingsProvidersResponse {
  activeSelection?: { chat?: { providerId?: string; modelId?: string } };
  defaultToolSurfaceProfile?: 'openawork' | 'claude_code_default' | 'claude_code_simple';
  defaultThinking?: {
    chat?: { enabled?: boolean; effort?: ReasoningEffort };
  };
  providers?: ChatSettingsProvider[];
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : 'medium';
}

export async function loadSavedChatSessionDefaults(
  gatewayUrl: string,
  token: string,
): Promise<{ defaults: SavedChatDefaults; providers: ChatSettingsProvider[] }> {
  const response = await fetch(`${gatewayUrl}/settings/providers?enabledOnly=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('failed to load saved chat defaults');
  }

  const data = (await response.json()) as SettingsProvidersResponse;
  const providers = (data.providers ?? [])
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      ...provider,
      defaultModels: (provider.defaultModels ?? []).filter((model) => model.enabled),
    }));

  return {
    defaults: {
      providerId: data.activeSelection?.chat?.providerId?.trim() ?? '',
      modelId: data.activeSelection?.chat?.modelId?.trim() ?? '',
      thinkingEnabled: data.defaultThinking?.chat?.enabled === true,
      reasoningEffort: normalizeReasoningEffort(data.defaultThinking?.chat?.effort),
      toolSurfaceProfile:
        data.defaultToolSurfaceProfile === 'claude_code_default' ||
        data.defaultToolSurfaceProfile === 'claude_code_simple'
          ? data.defaultToolSurfaceProfile
          : 'openawork',
    },
    providers,
  };
}

export function buildSavedChatSessionMetadata(
  defaults: SavedChatDefaults,
  options?: {
    parentSessionId?: string | null;
    workingDirectory?: string | null;
  },
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    thinkingEnabled: defaults.thinkingEnabled,
    reasoningEffort: defaults.reasoningEffort,
  };

  if (defaults.providerId) {
    metadata['providerId'] = defaults.providerId;
  }

  if (defaults.modelId) {
    metadata['modelId'] = defaults.modelId;
  }

  if (defaults.toolSurfaceProfile !== 'openawork') {
    metadata['toolSurfaceProfile'] = defaults.toolSurfaceProfile;
  }

  const workingDirectory = options?.workingDirectory?.trim();
  if (workingDirectory) {
    metadata['workingDirectory'] = workingDirectory;
  }

  const parentSessionId = options?.parentSessionId?.trim();
  if (parentSessionId) {
    metadata['parentSessionId'] = parentSessionId;
  }

  return metadata;
}
