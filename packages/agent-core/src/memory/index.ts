export type {
  MemoryType,
  MemorySource,
  MemoryRoleLayer,
  MemoryEntry,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryListFilter,
  MemoryStats,
  MemoryInjectionConfig,
  MemorySettings,
  ExtractedMemoryCandidate,
  MemoryCandidateDecision,
  MemoryCandidateDecisionReason,
  MemoryCandidateDecisionStatus,
  MemoryCandidatePersistencePolicy,
  MemoryExtractionLog,
} from './types.js';

export {
  MEMORY_TYPES,
  MEMORY_SOURCES,
  MEMORY_ROLE_LAYERS,
  memoryTypeSchema,
  memorySourceSchema,
  memoryRoleLayerSchema,
  memoryRoleLayersSchema,
  createMemorySchema,
  updateMemorySchema,
  memoryListQuerySchema,
  memorySettingsSchema,
  DEFAULT_MEMORY_SETTINGS,
  MEMORY_SETTINGS_KEY,
} from './schema.js';

export { estimateTokenCount, parseMemorySettings, normalizeMemoryKey } from './helpers.js';

export type { DeduplicationResult } from './deduplicator.js';
export { deduplicateMemories } from './deduplicator.js';

export { buildMemoryInjectionBlock } from './injector.js';

export { extractMemoriesFromText } from './extractor.js';
export { evaluateMemoryCandidateForPersistence } from './persistence-policy.js';
