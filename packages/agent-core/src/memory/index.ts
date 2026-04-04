export type {
  MemoryType,
  MemorySource,
  MemoryEntry,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryListFilter,
  MemoryStats,
  MemoryInjectionConfig,
  MemorySettings,
  ExtractedMemoryCandidate,
  MemoryExtractionLog,
} from './types.js';

export {
  MEMORY_TYPES,
  MEMORY_SOURCES,
  memoryTypeSchema,
  memorySourceSchema,
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
