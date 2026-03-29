import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { ProviderPersistenceAdapter } from '@openAwork/agent-core';
import type { AIProvider, ActiveSelection } from '@openAwork/agent-core';

const API_KEY_PREFIX = 'apikey_';
const PROVIDER_CONFIG_KEY = 'provider-config';
const MCP_SERVERS_KEY = 'mcp-servers';
const DB_NAME = 'openAwork.db';

const DEFAULT_MODEL_ID_BY_PROVIDER: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  deepseek: 'deepseek-chat',
  qwen: 'qwen-max',
  zhipu: 'glm-4',
  custom: 'custom-model',
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
  { id: 'custom', type: 'custom', name: 'Custom', baseUrl: '' },
] as const;

export interface MobileMcpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

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

export function buildMobileProviderConfig(
  selectedProviderId: string,
  apiKey: string,
): {
  providers: AIProvider[];
  active: ActiveSelection;
} {
  const now = new Date().toISOString();
  const providers: AIProvider[] = MOBILE_PROVIDER_PRESETS.map((preset) => ({
    id: preset.id,
    type: preset.type,
    name: preset.name,
    enabled: true,
    baseUrl: preset.baseUrl,
    apiKey: preset.id === selectedProviderId && apiKey ? apiKey : undefined,
    defaultModels: [
      {
        id: DEFAULT_MODEL_ID_BY_PROVIDER[preset.id] ?? 'default-model',
        label: DEFAULT_MODEL_ID_BY_PROVIDER[preset.id] ?? 'Default Model',
        enabled: true,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }));

  const selectedModelId = DEFAULT_MODEL_ID_BY_PROVIDER[selectedProviderId] ?? 'default-model';
  return {
    providers,
    active: {
      chat: { providerId: selectedProviderId, modelId: selectedModelId },
      fast: { providerId: selectedProviderId, modelId: selectedModelId },
    },
  };
}

export function restoreMobileProviderSelection(
  config: { providers: AIProvider[]; active: ActiveSelection } | null,
  apiKey: string | null,
): { selectedProviderId: string; apiKey: string } {
  const selectedProviderId = config?.active.chat.providerId || MOBILE_PROVIDER_PRESETS[0].id;
  return {
    selectedProviderId,
    apiKey: apiKey ?? '',
  };
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
    const data: ProviderConfigData = { providers, active };
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
