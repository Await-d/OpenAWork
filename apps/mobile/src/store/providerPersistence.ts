import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { ProviderPersistenceAdapter } from '@openAwork/agent-core';
import type { AIProvider, ActiveSelection } from '@openAwork/agent-core';
import { DEFAULT_IMAGE_GENERATION_SIZE, normalizeImageGenerationSize } from '@openAwork/shared';

const API_KEY_PREFIX = 'apikey_';
const PROVIDER_CONFIG_KEY = 'provider-config';
const MCP_SERVERS_KEY = 'mcp-servers';
const IMAGE_GENERATION_DEFAULTS_KEY = 'image-generation-defaults';
const DB_NAME = 'openAwork.db';
const DEFAULT_IMAGE_PROVIDER_ID = 'openai';

const DEFAULT_MODEL_ID_BY_PROVIDER: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  deepseek: 'deepseek-chat',
  qwen: 'qwen-max',
  zhipu: 'glm-4',
  custom: 'custom-model',
};

const IMAGE_MODEL_ID_BY_PROVIDER: Record<string, string> = {
  openai: 'gpt-image-2',
};

const MOBILE_PROVIDER_PRESETS = [
  { id: 'openai', type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  {
    id: 'anthropic',
    type: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
  },
  {
    id: 'deepseek',
    type: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    id: 'qwen',
    type: 'qwen',
    name: 'Qwen (阿里云)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    id: 'zhipu',
    type: 'custom',
    name: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  { id: 'custom', type: 'custom', name: '自定义渠道', baseUrl: '' },
] as const;

export interface MobileMcpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface MobileImageGenerationDefaults {
  background: 'auto' | 'opaque';
  outputFormat: 'png' | 'jpeg' | 'webp';
  quality: 'low' | 'medium' | 'high';
  size: string;
}

export const DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS: MobileImageGenerationDefaults = {
  size: DEFAULT_IMAGE_GENERATION_SIZE,
  quality: 'medium',
  outputFormat: 'png',
  background: 'auto',
};

interface ProviderConfigData {
  providers: AIProvider[];
  active: ActiveSelection;
}

interface SettingsRow {
  value: string;
}

let settingsDb: SQLiteDatabase | null = null;

async function getSettingsDb(): Promise<SQLiteDatabase> {
  if (settingsDb) {
    return settingsDb;
  }
  const database = await openDatabaseAsync(DB_NAME);
  await database.execAsync(
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  );
  settingsDb = database;
  return settingsDb;
}

export function buildMobileProviderConfig(input: {
  apiKeysByProvider: Record<string, string>;
  imageProviderId?: string;
  selectedProviderId: string;
}): {
  providers: AIProvider[];
  active: ActiveSelection;
} {
  const {
    apiKeysByProvider,
    imageProviderId = DEFAULT_IMAGE_PROVIDER_ID,
    selectedProviderId,
  } = input;
  const now = new Date().toISOString();
  const providers: AIProvider[] = MOBILE_PROVIDER_PRESETS.map((preset) => {
    const defaultModels = [
      {
        id: DEFAULT_MODEL_ID_BY_PROVIDER[preset.id] ?? 'default-model',
        label: DEFAULT_MODEL_ID_BY_PROVIDER[preset.id] ?? 'Default Model',
        enabled: true,
      },
      ...(IMAGE_MODEL_ID_BY_PROVIDER[preset.id]
        ? [
            {
              id: IMAGE_MODEL_ID_BY_PROVIDER[preset.id]!,
              label: 'GPT Image 2',
              enabled: true,
              supportsImageGeneration: true,
            },
          ]
        : []),
    ];

    return {
      id: preset.id,
      type: preset.type,
      name: preset.name,
      enabled: true,
      baseUrl: preset.baseUrl,
      apiKey: apiKeysByProvider[preset.id]?.trim() || undefined,
      defaultModels,
      createdAt: now,
      updatedAt: now,
    };
  });

  const selectedModelId = DEFAULT_MODEL_ID_BY_PROVIDER[selectedProviderId] ?? 'default-model';
  const selectedImageModelId = IMAGE_MODEL_ID_BY_PROVIDER[imageProviderId];
  return {
    providers,
    active: {
      chat: { providerId: selectedProviderId, modelId: selectedModelId },
      fast: { providerId: selectedProviderId, modelId: selectedModelId },
      ...(selectedImageModelId
        ? { image: { providerId: imageProviderId, modelId: selectedImageModelId } }
        : {}),
    },
  };
}

export function restoreMobileProviderSelection(
  config: { providers: AIProvider[]; active: ActiveSelection } | null,
  apiKey: string | null,
): { selectedProviderId: string; imageProviderId: string; apiKey: string } {
  const selectedProviderId = config?.active.chat.providerId || MOBILE_PROVIDER_PRESETS[0].id;
  return {
    selectedProviderId,
    imageProviderId: config?.active.image?.providerId || DEFAULT_IMAGE_PROVIDER_ID,
    apiKey: apiKey ?? '',
  };
}

export async function saveImageGenerationDefaults(
  defaults: MobileImageGenerationDefaults,
): Promise<void> {
  const db = await getSettingsDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);',
    IMAGE_GENERATION_DEFAULTS_KEY,
    JSON.stringify(defaults),
  );
}

export async function loadImageGenerationDefaults(): Promise<MobileImageGenerationDefaults> {
  const db = await getSettingsDb();
  const row = await db.getFirstAsync<SettingsRow>(
    'SELECT value FROM settings WHERE key = ?;',
    IMAGE_GENERATION_DEFAULTS_KEY,
  );
  if (!row) {
    return { ...DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS };
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<MobileImageGenerationDefaults>;
    return {
      size: normalizeImageGenerationSize(
        parsed.size,
        DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS.size,
      ),
      quality:
        parsed.quality === 'low' || parsed.quality === 'high'
          ? parsed.quality
          : DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS.quality,
      outputFormat:
        parsed.outputFormat === 'jpeg' || parsed.outputFormat === 'webp'
          ? parsed.outputFormat
          : DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS.outputFormat,
      background:
        parsed.background === 'opaque'
          ? 'opaque'
          : DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS.background,
    };
  } catch {
    return { ...DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS };
  }
}

export async function saveMcpServers(servers: MobileMcpServer[]): Promise<void> {
  const db = await getSettingsDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);',
    MCP_SERVERS_KEY,
    JSON.stringify(servers),
  );
}

export async function loadMcpServers(): Promise<MobileMcpServer[]> {
  const db = await getSettingsDb();
  const row = await db.getFirstAsync<SettingsRow>(
    'SELECT value FROM settings WHERE key = ?;',
    MCP_SERVERS_KEY,
  );
  if (!row) {
    return [];
  }
  return JSON.parse(row.value) as MobileMcpServer[];
}

export class ExpoPersistenceAdapter implements ProviderPersistenceAdapter {
  private db: SQLiteDatabase | null = null;

  private async getDb(): Promise<SQLiteDatabase> {
    if (!this.db) {
      this.db = await getSettingsDb();
    }
    return this.db;
  }

  public async saveApiKey(providerId: string, key: string): Promise<void> {
    await SecureStore.setItemAsync(`${API_KEY_PREFIX}${providerId}`, key);
  }

  public async loadApiKey(providerId: string): Promise<string | null> {
    const value = await SecureStore.getItemAsync(`${API_KEY_PREFIX}${providerId}`);
    return value;
  }

  public async saveProviderConfig(providers: AIProvider[], active: ActiveSelection): Promise<void> {
    const db = await this.getDb();
    const sanitizedProviders = providers.map((provider) => {
      const { apiKey: _apiKey, ...rest } = provider;
      return rest;
    });
    const data: ProviderConfigData = { providers: sanitizedProviders, active };
    await db.runAsync(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);',
      PROVIDER_CONFIG_KEY,
      JSON.stringify(data),
    );
  }

  public async loadProviderConfig(): Promise<{
    providers: AIProvider[];
    active: ActiveSelection;
  } | null> {
    const db = await this.getDb();
    const row = await db.getFirstAsync<SettingsRow>(
      'SELECT value FROM settings WHERE key = ?;',
      PROVIDER_CONFIG_KEY,
    );
    if (!row) {
      return null;
    }
    const data = JSON.parse(row.value) as ProviderConfigData;
    return { providers: data.providers, active: data.active };
  }
}

export default ExpoPersistenceAdapter;
