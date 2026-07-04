export type MemoryType =
  | 'preference'
  | 'fact'
  | 'instruction'
  | 'project_context'
  | 'learned_pattern';

export type MemorySource = 'manual' | 'auto_extracted' | 'api';

export type MemoryRoleLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

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
  teamWorkspaceId: string | null;
  /**
   * null 表示全部团队层级可读；数组表示只注入给指定团队层级。
   * 非团队记忆保持 null。
   */
  roleLayers: MemoryRoleLayer[] | null;
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
  teamWorkspaceId?: string | null;
  roleLayers?: MemoryRoleLayer[] | null;
}

export interface UpdateMemoryInput {
  type?: MemoryType;
  key?: string;
  value?: string;
  source?: MemorySource;
  confidence?: number;
  priority?: number;
  workspaceRoot?: string | null;
  teamWorkspaceId?: string | null;
  roleLayers?: MemoryRoleLayer[] | null;
  enabled?: boolean;
}

export interface MemoryListFilter {
  type?: MemoryType;
  source?: MemorySource;
  workspaceRoot?: string | null;
  teamWorkspaceId?: string | null;
  roleLayer?: MemoryRoleLayer;
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
  teamWorkspaceId?: string | null;
  roleLayer?: MemoryRoleLayer | null;
}

export interface MemorySettings {
  enabled: boolean;
  autoExtract: boolean;
  maxTokenBudget: number;
  minConfidence: number;
  autoWriteMinConfidence: number;
  reviewLowConfidence: boolean;
}

export interface ExtractedMemoryCandidate {
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
}

export type MemoryCandidateDecisionStatus = 'persist' | 'review' | 'reject';

export type MemoryCandidateDecisionReason =
  | 'eligible'
  | 'empty_value'
  | 'low_confidence'
  | 'sensitive_information'
  | 'transient_context'
  | 'unsupported_type';

export interface MemoryCandidateDecision {
  candidate: ExtractedMemoryCandidate;
  status: MemoryCandidateDecisionStatus;
  reason: MemoryCandidateDecisionReason;
  detail: string;
}

export interface MemoryCandidatePersistencePolicy {
  autoWriteMinConfidence: number;
  reviewLowConfidence: boolean;
}

export interface MemoryExtractionLog {
  id: number;
  userId: string;
  sessionId: string;
  clientRequestId: string;
  extractedCount: number;
  createdAt: string;
}
