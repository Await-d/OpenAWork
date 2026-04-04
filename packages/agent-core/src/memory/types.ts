export type MemoryType =
  | 'preference'
  | 'fact'
  | 'instruction'
  | 'project_context'
  | 'learned_pattern';

export type MemorySource = 'manual' | 'auto_extracted' | 'api';

export interface MemoryEntry {
  id: string;
  userId: string;
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

export interface CreateMemoryInput {
  type: MemoryType;
  key: string;
  value: string;
  source?: MemorySource;
  confidence?: number;
  priority?: number;
  workspaceRoot?: string | null;
}

export interface UpdateMemoryInput {
  type?: MemoryType;
  key?: string;
  value?: string;
  priority?: number;
  enabled?: boolean;
}

export interface MemoryListFilter {
  type?: MemoryType;
  source?: MemorySource;
  workspaceRoot?: string | null;
  enabled?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryStats {
  total: number;
  enabled: number;
  disabled: number;
  byType: Record<MemoryType, number>;
  bySource: Record<MemorySource, number>;
}

export interface MemoryInjectionConfig {
  enabled: boolean;
  maxTokenBudget: number;
  minConfidence: number;
  workspaceRoot: string | null;
}

export interface MemorySettings {
  enabled: boolean;
  autoExtract: boolean;
  maxTokenBudget: number;
  minConfidence: number;
}

export interface ExtractedMemoryCandidate {
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
}

export interface MemoryExtractionLog {
  id: number;
  userId: string;
  sessionId: string;
  clientRequestId: string;
  extractedCount: number;
  createdAt: string;
}
