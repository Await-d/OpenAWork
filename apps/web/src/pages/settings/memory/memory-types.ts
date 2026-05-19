export type MemoryType =
  | 'preference'
  | 'fact'
  | 'instruction'
  | 'project_context'
  | 'learned_pattern';

export type MemorySource = 'manual' | 'auto_extracted' | 'api';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  key: string;
  value: string;
  source: MemorySource;
  confidence: number;
  priority: number;
  workspaceRoot: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryStats {
  total: number;
  enabled: number;
  disabled: number;
  bySource: Record<MemorySource, number>;
  byType: Record<MemoryType, number>;
}

export interface MemorySettings {
  enabled: boolean;
  autoExtract: boolean;
  maxTokenBudget: number;
  minConfidence: number;
}

export interface MemoryCreateInput {
  type: MemoryType;
  key: string;
  value: string;
  workspaceRoot: string;
}

export type MemoryLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
export type MemoryActionStatus = 'idle' | 'pending' | 'success' | 'error';

export interface MemoryActionFeedback {
  status: MemoryActionStatus;
  message: string | null;
}

export interface UseMemoryManagementResult {
  memories: MemoryEntry[];
  loadStatus: MemoryLoadStatus;
  loadError: string | null;
  stats: MemoryStats | null;
  statsStatus: MemoryLoadStatus;
  settings: MemorySettings;
  settingsStatus: MemoryLoadStatus;
  actionFeedback: MemoryActionFeedback;
  clearActionFeedback: () => void;
  refreshMemories: () => Promise<void>;
  refreshStats: () => Promise<void>;
  createMemory: (input: MemoryCreateInput) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  updateMemory: (id: string, value: string) => Promise<void>;
  extractMemories: () => Promise<void>;
  updateSettings: (patch: Partial<MemorySettings>) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredMemories: MemoryEntry[];
}
