export interface ModelEntry {
  id: string;
  displayName: string;
  provider: string;
  contextWindow: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsThinking: boolean;
  updatedAt: number;
}

export interface CatwalkRegistry {
  getAll(): ModelEntry[];
  getById(id: string): ModelEntry | undefined;
  search(query: string): ModelEntry[];
  configure(options: CatwalkOptions): void;
  sync(): Promise<{ added: number; updated: number; removed: number }>;
  lastSyncedAt(): number | null;
}

export interface CatwalkOptions {
  sourceUrl?: string;
  autoUpdate?: boolean;
  autoUpdateIntervalMs?: number;
}

const BUILTIN_SNAPSHOT: ModelEntry[] = [
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    provider: 'anthropic',
    contextWindow: 200000,
    inputPricePerMillion: 5,
    outputPricePerMillion: 25,
    supportsVision: true,
    supportsTools: true,
    supportsThinking: true,
    updatedAt: 0,
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    contextWindow: 200000,
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    supportsVision: true,
    supportsTools: true,
    supportsThinking: true,
    updatedAt: 0,
  },
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10,
    supportsVision: true,
    supportsTools: true,
    supportsThinking: false,
    updatedAt: 0,
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    supportsVision: true,
    supportsTools: true,
    supportsThinking: false,
    updatedAt: 0,
  },
  {
    id: 'deepseek-chat',
    displayName: 'DeepSeek V3',
    provider: 'deepseek',
    contextWindow: 128000,
    inputPricePerMillion: 0.26,
    outputPricePerMillion: 0.38,
    supportsVision: false,
    supportsTools: true,
    supportsThinking: false,
    updatedAt: 0,
  },
  {
    id: 'deepseek-reasoner',
    displayName: 'DeepSeek R1',
    provider: 'deepseek',
    contextWindow: 128000,
    inputPricePerMillion: 0.7,
    outputPricePerMillion: 2.5,
    supportsVision: false,
    supportsTools: false,
    supportsThinking: true,
    updatedAt: 0,
  },
  {
    id: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    provider: 'google',
    contextWindow: 1000000,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    supportsVision: true,
    supportsTools: true,
    supportsThinking: false,
    updatedAt: 0,
  },
  {
    id: 'llama-3.3-70b',
    displayName: 'Llama 3.3 70B',
    provider: 'meta',
    contextWindow: 128000,
    inputPricePerMillion: 0.59,
    outputPricePerMillion: 0.79,
    supportsVision: false,
    supportsTools: true,
    supportsThinking: false,
    updatedAt: 0,
  },
  {
    id: 'qwen-max',
    displayName: 'Qwen Max',
    provider: 'alibaba',
    contextWindow: 32000,
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.2,
    supportsVision: false,
    supportsTools: true,
    supportsThinking: false,
    updatedAt: 0,
  },
  {
    id: 'mistral-large',
    displayName: 'Mistral Large',
    provider: 'mistral',
    contextWindow: 128000,
    inputPricePerMillion: 2,
    outputPricePerMillion: 6,
    supportsVision: false,
    supportsTools: true,
    supportsThinking: false,
    updatedAt: 0,
  },
];

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

interface OpenRouterResponse {
  data: OpenRouterModel[];
}

export class CatwalkRegistryImpl implements CatwalkRegistry {
  private models = new Map<string, ModelEntry>(
    BUILTIN_SNAPSHOT.map((m) => [m.id, { ...m, updatedAt: Date.now() }]),
  );
  private _lastSyncedAt: number | null = null;
  private options: CatwalkOptions = {
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    autoUpdate: true,
    autoUpdateIntervalMs: 3600000,
  };
  private autoUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.startAutoUpdate();
  }

  getAll(): ModelEntry[] {
    return Array.from(this.models.values());
  }

  getById(id: string): ModelEntry | undefined {
    return this.models.get(id);
  }

  search(query: string): ModelEntry[] {
    const q = query.toLowerCase();
    return this.getAll().filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }

  configure(options: CatwalkOptions): void {
    this.options = { ...this.options, ...options };
    if (this.options.autoUpdate) {
      this.startAutoUpdate();
      return;
    }

    if (this.autoUpdateTimer) {
      clearTimeout(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
  }

  private startAutoUpdate(): void {
    if (!this.options.autoUpdate) {
      return;
    }

    if (this.autoUpdateTimer) {
      clearTimeout(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }

    const schedule = () => {
      this.autoUpdateTimer = setTimeout(() => {
        void this.sync();
        schedule();
      }, this.options.autoUpdateIntervalMs ?? 3600000);
    };

    schedule();
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(this.options.sourceUrl ?? 'https://openrouter.ai/api/v1/models', {
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (!res.ok) return { added: 0, updated: 0, removed: 0 };
      const json = (await res.json()) as OpenRouterResponse;
      let added = 0;
      let updated = 0;
      for (const m of json.data) {
        const entry: ModelEntry = {
          id: m.id,
          displayName: m.name,
          provider: m.id.split('/')[0] ?? m.id,
          contextWindow: m.context_length ?? 0,
          inputPricePerMillion: parseFloat(m.pricing?.prompt ?? '0') * 1e6,
          outputPricePerMillion: parseFloat(m.pricing?.completion ?? '0') * 1e6,
          supportsVision: false,
          supportsTools: true,
          supportsThinking: false,
          updatedAt: Date.now(),
        };
        if (this.models.has(m.id)) {
          updated++;
        } else {
          added++;
        }
        this.models.set(m.id, entry);
      }
      this._lastSyncedAt = Date.now();
      return { added, updated, removed: 0 };
    } catch {
      return { added: 0, updated: 0, removed: 0 };
    }
  }

  lastSyncedAt(): number | null {
    return this._lastSyncedAt;
  }
}
